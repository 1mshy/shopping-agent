// Test harness for the scheduler: a fake wall clock, fake timers that fire only when a test says
// so (on time, late or all at once), a temporary SQLite file migrated by the real migrations, and
// readers for the job and job_run rows. Nothing here sleeps: `flush` yields to the event loop.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Database, migrate, openDatabase, schema } from '@agentic-dasher/db';
import { asc, eq } from 'drizzle-orm';
import type { JobContext, Timers } from '../../src/scheduler/index.ts';

export const at = (hhmmss: string, day = '17') => `2026-11-${day}T${hhmmss}.000Z`;
export const ms = (iso: string) => Date.parse(iso);

export class FakeClock {
  ms: number;
  constructor(start: string) {
    this.ms = Date.parse(start);
  }
  readonly now = (): number => this.ms;
  get iso(): string {
    return new Date(this.ms).toISOString();
  }
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
}

interface PendingTimer {
  readonly id: number;
  readonly at: number;
  readonly fn: () => void;
}

/** Timers on the fake clock. They fire only from fireDue/fireAll (or advanceTo). */
export class FakeTimers implements Timers {
  readonly #clock: FakeClock;
  #pending: PendingTimer[] = [];
  #seq = 0;
  /** Every delay asked for, in order. */
  readonly delays: number[] = [];

  constructor(clock: FakeClock) {
    this.#clock = clock;
  }

  setTimeout(fn: () => void, delay: number): unknown {
    const timer = { id: ++this.#seq, at: this.#clock.ms + delay, fn };
    this.#pending.push(timer);
    this.delays.push(delay);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.#pending = this.#pending.filter((t) => t.id !== handle);
  }

  get size(): number {
    return this.#pending.length;
  }

  nextAt(): number | undefined {
    let next: number | undefined;
    for (const t of this.#pending) if (next === undefined || t.at < next) next = t.at;
    return next;
  }

  /** Fires the earliest timer that is due on the clock; false when none is. */
  fireDue(): boolean {
    let pick: PendingTimer | undefined;
    for (const t of this.#pending) {
      if (
        t.at <= this.#clock.ms &&
        (!pick || t.at < pick.at || (t.at === pick.at && t.id < pick.id))
      ) {
        pick = t;
      }
    }
    if (!pick) return false;
    const chosen = pick;
    this.#pending = this.#pending.filter((t) => t !== chosen);
    chosen.fn();
    return true;
  }

  /** Fires every pending timer now, due or not: what a host does when it thaws. */
  fireAll(): void {
    const all = this.#pending;
    this.#pending = [];
    for (const t of all) t.fn();
  }
}

/** Lets pending promise chains and handlers run; no time passes on the fake clock. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Moves the clock to `target`, firing every timer when it comes due, as a host that never sleeps. */
export async function advanceTo(
  clock: FakeClock,
  timers: readonly FakeTimers[],
  target: number,
): Promise<void> {
  for (;;) {
    await flush();
    let next = Number.POSITIVE_INFINITY;
    for (const t of timers) {
      const due = t.nextAt();
      if (due !== undefined && due < next) next = due;
    }
    if (next > target) break;
    clock.ms = Math.max(clock.ms, next);
    for (const t of timers) while (t.fireDue()) {}
  }
  clock.ms = target;
  await flush();
}

export function advanceBy(clock: FakeClock, timers: readonly FakeTimers[], by: number) {
  return advanceTo(clock, timers, clock.ms + by);
}

/** A temporary database file, migrated; `open` gives another connection to the same file. */
export function tempDatabase(): { file: string; open: () => Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-dasher-scheduler-'));
  const file = join(dir, 'test.db');
  const connections: Database[] = [];
  const open = () => {
    const db = openDatabase(file);
    migrate(db);
    connections.push(db);
    return db;
  };
  return {
    file,
    open,
    cleanup: () => {
      for (const db of connections) {
        try {
          db.close();
        } catch {
          // Already closed by the test.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type RunRow = typeof schema.jobRun.$inferSelect;

/** The job's runs, oldest first. */
export function runsOf(db: Database, name: string): RunRow[] {
  const job = jobOf(db, name);
  return db.orm
    .select()
    .from(schema.jobRun)
    .where(eq(schema.jobRun.jobId, job.id))
    .orderBy(asc(schema.jobRun.id))
    .all();
}

export function openRunsOf(db: Database, name: string): RunRow[] {
  return runsOf(db, name).filter((r) => r.endedAt === null);
}

export function jobOf(db: Database, name: string) {
  const row = db.orm.select().from(schema.job).where(eq(schema.job.name, name)).get();
  if (!row) throw new Error(`no job ${name}`);
  return row;
}

/** A handler whose runs stay open until the test settles them. */
export function heldHandler() {
  const calls: JobContext[] = [];
  const settles: { resolve: (value?: unknown) => void; reject: (error: unknown) => void }[] = [];
  return {
    calls,
    handler: (context: JobContext) => {
      calls.push(context);
      return new Promise<unknown>((resolve, reject) => {
        settles.push({ resolve, reject });
      });
    },
    resolve(index: number, value?: unknown) {
      settles[index]?.resolve(value);
    },
    reject(index: number, error: unknown) {
      settles[index]?.reject(error);
    },
  };
}

/** A handler that rejects as soon as its signal fires (a well-behaved job), else stays open. */
export function abortableHandler() {
  const calls: JobContext[] = [];
  return {
    calls,
    handler: (context: JobContext) => {
      calls.push(context);
      return new Promise<unknown>((_, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        });
      });
    },
  };
}

/** A handler that completes at once with a detail naming what it stood for. */
export function quickHandler() {
  const calls: JobContext[] = [];
  return {
    calls,
    handler: async (context: JobContext) => {
      calls.push(context);
      return { reason: context.reason, slots: context.coalescedSlots };
    },
  };
}
