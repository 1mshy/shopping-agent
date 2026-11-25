// The scripted Phase 1 exit gates this unit owns (S§2 invariant 12, S§6 sleep/restart): a freeze
// across several due slots of several jobs, a restart mid-run (graceful and a crash), and two
// scheduler instances on one database file. Real SQLite files, a fake clock, fake timers.
import type { Database } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScheduler,
  type JobDefinition,
  type Scheduler,
  type SchedulerOptions,
} from '../../src/scheduler/index.ts';
import {
  abortableHandler,
  advanceBy,
  advanceTo,
  at,
  FakeClock,
  FakeTimers,
  flush,
  heldHandler,
  jobOf,
  ms,
  openRunsOf,
  quickHandler,
  runsOf,
  tempDatabase,
} from './harness.ts';

let temp: ReturnType<typeof tempDatabase>;
let clock: FakeClock;
let errors: unknown[];
const running: { scheduler: Scheduler; timers: FakeTimers }[] = [];

beforeEach(() => {
  temp = tempDatabase();
  clock = new FakeClock(at('09:00:00'));
  errors = [];
});

afterEach(async () => {
  for (const { scheduler, timers } of running.splice(0)) {
    const stopping = scheduler.stop();
    await advanceBy(clock, [timers], 10_000);
    await stopping;
  }
  temp.cleanup();
  expect(errors).toEqual([]);
});

function make(
  db: Database,
  jobs: readonly JobDefinition[],
  extra: Partial<SchedulerOptions> = {},
): { scheduler: Scheduler; timers: FakeTimers } {
  const timers = new FakeTimers(clock);
  const scheduler = createScheduler({
    db,
    now: clock.now,
    timers,
    probe: async () => true,
    onError: (error) => errors.push(error),
    ...extra,
  });
  for (const job of jobs) scheduler.register(job);
  const entry = { scheduler, timers };
  running.push(entry);
  return entry;
}

function forget(entry: { scheduler: Scheduler }): void {
  const i = running.findIndex((r) => r.scheduler === entry.scheduler);
  if (i >= 0) running.splice(i, 1);
}

const cadence = (
  name: string,
  cron: string,
  handler: JobDefinition['handler'],
  deadlineMs = 900_000,
) => ({ name, cron, deadlineMs, networkGate: false, handler }) satisfies JobDefinition;

describe('gate: freeze', () => {
  it('a clock jump across several due slots of several jobs gives exactly one catch-up per job, on the grid', async () => {
    const db = temp.open();
    const halfHourly = heldHandler();
    const hourly = heldHandler();
    const fiveMinutes = heldHandler();
    const { scheduler, timers } = make(db, [
      cadence('half_hourly', '*/30 * * * *', halfHourly.handler),
      cadence('hourly', '0 * * * *', hourly.handler),
      cadence('five_minutes', '*/5 * * * *', fiveMinutes.handler),
    ]);
    scheduler.start();
    await flush();
    halfHourly.resolve(0);
    hourly.resolve(0);
    fiveMinutes.resolve(0);
    await flush();
    expect(jobOf(db, 'half_hourly').nextRunAt).toBe(at('09:30:00'));
    expect(jobOf(db, 'hourly').nextRunAt).toBe(at('10:00:00'));
    expect(jobOf(db, 'five_minutes').nextRunAt).toBe(at('09:05:00'));

    // The host freezes at 09:00 and thaws at 11:47: no timer fired in between, then all fire at
    // once, and a resume hook and two more late timers wake the scheduler again.
    clock.set(at('11:47:00'));
    timers.fireAll();
    scheduler.wake();
    timers.fireAll();
    scheduler.wake();
    await flush();

    const catchUp = (name: string) => runsOf(db, name).slice(1);
    expect(catchUp('half_hourly').map((r) => [r.reason, r.coalescedSlots, r.startedAt])).toEqual([
      ['slot', 5, at('11:47:00')],
    ]);
    expect(catchUp('hourly').map((r) => [r.reason, r.coalescedSlots, r.startedAt])).toEqual([
      ['slot', 2, at('11:47:00')],
    ]);
    // 09:05 to 11:45 every five minutes: 33 slots.
    expect(catchUp('five_minutes').map((r) => [r.reason, r.coalescedSlots, r.startedAt])).toEqual([
      ['slot', 33, at('11:47:00')],
    ]);
    expect(jobOf(db, 'half_hourly').nextRunAt).toBe(at('12:00:00'));
    expect(jobOf(db, 'hourly').nextRunAt).toBe(at('12:00:00'));
    expect(jobOf(db, 'five_minutes').nextRunAt).toBe(at('11:50:00'));

    // More late wakes while the catch-ups run, and after they end: still one each.
    timers.fireAll();
    scheduler.wake();
    await flush();
    halfHourly.resolve(1);
    hourly.resolve(1);
    fiveMinutes.resolve(1);
    await flush();
    scheduler.wake();
    timers.fireAll();
    await flush();
    for (const name of ['half_hourly', 'hourly', 'five_minutes']) {
      expect(runsOf(db, name)).toHaveLength(2);
      expect(runsOf(db, name).every((r) => r.status === 'completed')).toBe(true);
    }

    // Then the cadence goes on from the grid: 11:50 for the five-minute job, 12:00 for the others.
    // The 11:50 run is held open past 11:55, so 11:55 waits for it and joins the 12:00 slot.
    await advanceTo(clock, [timers], ms(at('12:00:00')));
    fiveMinutes.resolve(2);
    await flush();
    await advanceTo(clock, [timers], ms(at('12:00:00')));
    expect(
      runsOf(db, 'five_minutes')
        .slice(2)
        .map((r) => [r.coalescedSlots, r.startedAt]),
    ).toEqual([
      [1, at('11:50:00')],
      [2, at('12:00:00')],
    ]);
    expect(jobOf(db, 'five_minutes').nextRunAt).toBe(at('12:05:00'));
    expect(
      runsOf(db, 'half_hourly')
        .slice(2)
        .map((r) => [r.coalescedSlots, r.startedAt]),
    ).toEqual([[1, at('12:00:00')]]);
    expect(
      runsOf(db, 'hourly')
        .slice(2)
        .map((r) => [r.coalescedSlots, r.startedAt]),
    ).toEqual([[1, at('12:00:00')]]);
  });

  it('a run caught by the freeze past its deadline times out, then the job catches up once', async () => {
    const db = temp.open();
    const sweep = heldHandler();
    const { scheduler, timers } = make(db, [cadence('sweep', '*/30 * * * *', sweep.handler)]);
    scheduler.start();
    await flush();
    sweep.calls[0]?.report({ checked: 7 });

    clock.set(at('11:47:00'));
    timers.fireAll();
    await flush();
    expect(
      runsOf(db, 'sweep').map((r) => [r.status, r.reason, r.coalescedSlots, r.endedAt]),
    ).toEqual([
      ['timed_out', 'boot', 0, at('11:47:00')],
      ['running', 'slot', 5, null],
    ]);
    expect(runsOf(db, 'sweep')[0]?.detail).toEqual({
      error: 'deadline of 900000 ms reached',
      partial: { checked: 7 },
    });
    expect(sweep.calls[0]?.signal.aborted).toBe(true);
    expect(jobOf(db, 'sweep').nextRunAt).toBe(at('12:00:00'));
  });
});

describe('gate: restart', () => {
  it('stop mid-run, reopen the same file with a new scheduler: one boot catch-up per job, nothing lost, no double run', async () => {
    const db1 = temp.open();
    const sweep1 = abortableHandler();
    const daily1 = abortableHandler();
    const first = make(db1, [
      cadence('sweep', '*/30 * * * *', sweep1.handler),
      cadence('daily', '40 7 * * *', daily1.handler),
    ]);
    first.scheduler.start();
    await advanceTo(clock, [first.timers], ms(at('09:10:00')));
    expect(openRunsOf(db1, 'sweep')).toHaveLength(1);
    const stopping = first.scheduler.stop();
    await flush();
    await stopping;
    forget(first);
    db1.close();

    // Down for 2 h 37 min: the sweep missed 09:30 to 11:30.
    clock.set(at('11:47:00'));
    const db2 = temp.open();
    expect(runsOf(db2, 'sweep')).toEqual([
      expect.objectContaining({
        status: 'failed',
        endedAt: at('09:10:00'),
        detail: { error: 'stopped: the scheduler shut down before the run ended' },
      }),
    ]);
    const sweep2 = quickHandler();
    const daily2 = quickHandler();
    const second = make(db2, [
      cadence('sweep', '*/30 * * * *', sweep2.handler),
      cadence('daily', '40 7 * * *', daily2.handler),
    ]);
    second.scheduler.start();
    await flush();

    expect(
      runsOf(db2, 'sweep').map((r) => [r.status, r.reason, r.coalescedSlots, r.startedAt]),
    ).toEqual([
      ['failed', 'boot', 0, at('09:00:00')],
      ['completed', 'boot', 5, at('11:47:00')],
    ]);
    expect(runsOf(db2, 'daily').map((r) => [r.status, r.reason, r.coalescedSlots])).toEqual([
      ['failed', 'boot', 0],
      ['completed', 'boot', 0],
    ]);
    // The failed run's retry is covered by the boot catch-up; the grid is kept.
    expect(jobOf(db2, 'sweep')).toMatchObject({ nextRunAt: at('12:00:00'), retryAt: null });
    expect(jobOf(db2, 'daily')).toMatchObject({ nextRunAt: at('07:40:00', '18'), retryAt: null });
    expect(sweep2.calls.map((c) => c.reason)).toEqual(['boot']);

    await advanceTo(clock, [second.timers], ms(at('12:00:00')));
    expect(runsOf(db2, 'sweep').at(-1)).toMatchObject({ reason: 'slot', coalescedSlots: 1 });
  });

  it('a crash leaves an open run: the next process ends it (failed, or timed out past its deadline), keeps its partial results and catches up once', async () => {
    const db1 = temp.open();
    const long1 = heldHandler();
    const short1 = heldHandler();
    const dead = make(db1, [
      cadence('long', '*/30 * * * *', long1.handler, 7_200_000),
      cadence('short', '*/30 * * * *', short1.handler, 900_000),
    ]);
    dead.scheduler.start();
    await flush();
    long1.calls[0]?.report({ checked: 4 });
    short1.calls[0]?.report({ checked: 2 });
    // The process dies: no stop(), its timers never fire again, its connection goes away.
    forget(dead);
    db1.close();

    clock.set(at('10:01:00'));
    const db2 = temp.open();
    const long2 = quickHandler();
    const short2 = quickHandler();
    const next = make(db2, [
      cadence('long', '*/30 * * * *', long2.handler, 7_200_000),
      cadence('short', '*/30 * * * *', short2.handler, 900_000),
    ]);
    next.scheduler.start();
    await flush();

    expect(runsOf(db2, 'long')).toEqual([
      expect.objectContaining({
        status: 'failed',
        endedAt: at('10:01:00'),
        detail: {
          error: 'interrupted: the process running it stopped before it ended',
          partial: { checked: 4 },
        },
      }),
      expect.objectContaining({ status: 'completed', reason: 'boot', coalescedSlots: 2 }),
    ]);
    expect(runsOf(db2, 'short')).toEqual([
      expect.objectContaining({
        status: 'timed_out',
        endedAt: at('10:01:00'),
        detail: { error: 'deadline of 900000 ms reached', partial: { checked: 2 } },
      }),
      expect.objectContaining({ status: 'completed', reason: 'boot', coalescedSlots: 2 }),
    ]);
    for (const name of ['long', 'short']) {
      expect(jobOf(db2, name)).toMatchObject({ nextRunAt: at('10:30:00'), retryAt: null });
    }
  });

  it('a restart within the lease defers the boot catch-up until the dead run lapses, then runs it once', async () => {
    const db1 = temp.open();
    const held = heldHandler();
    const dead = make(db1, [cadence('sweep', '*/30 * * * *', held.handler)], { leaseMs: 20_000 });
    dead.scheduler.start();
    await flush();
    forget(dead);
    db1.close();

    clock.set(at('09:00:05'));
    const db2 = temp.open();
    const sweep = quickHandler();
    const next = make(db2, [cadence('sweep', '*/30 * * * *', sweep.handler)], { leaseMs: 20_000 });
    next.scheduler.start();
    await flush();
    // The open run might still be alive: nothing started yet.
    expect(runsOf(db2, 'sweep')).toHaveLength(1);
    expect(next.scheduler.trigger('sweep').joined).toBe(true);

    await advanceTo(clock, [next.timers], ms(at('09:00:19')));
    expect(runsOf(db2, 'sweep')).toHaveLength(1);
    await advanceTo(clock, [next.timers], ms(at('09:00:21')));
    expect(runsOf(db2, 'sweep').map((r) => [r.status, r.reason, r.startedAt])).toEqual([
      ['failed', 'boot', at('09:00:00')],
      ['completed', 'boot', at('09:00:20')],
    ]);
    expect(sweep.calls).toHaveLength(1);
    expect(jobOf(db2, 'sweep')).toMatchObject({ nextRunAt: at('09:30:00'), retryAt: null });
  });
});

describe('gate: two instances on one database', () => {
  it('the second instance cannot start a run of a job the first holds; it joins it, and slots run once across both', async () => {
    const db1 = temp.open();
    const db2 = temp.open();
    const held = heldHandler();
    const other = quickHandler();
    const first = make(db1, [cadence('sweep', '*/30 * * * *', held.handler)], {
      instanceId: 'first',
    });
    const second = make(db2, [cadence('sweep', '*/30 * * * *', other.handler)], {
      instanceId: 'second',
    });
    first.scheduler.start();
    await flush();
    const holder = openRunsOf(db1, 'sweep')[0];
    expect(holder).toMatchObject({ reason: 'boot', detail: { instance: 'first' } });

    second.scheduler.start();
    await flush();
    const joined = second.scheduler.trigger('sweep');
    expect(joined).toMatchObject({ runId: holder?.id, joined: true });
    expect(other.calls).toHaveLength(0);
    expect(runsOf(db2, 'sweep')).toHaveLength(1);

    // The database itself refuses a second open run of the job.
    expect(() =>
      db2.exec(
        `insert into job_run (job_id, status, started_at, reason, coalesced_slots)
         values (${holder?.jobId}, 'running', '2026-11-17T09:00:01.000Z', 'caller', 0)`,
      ),
    ).toThrow(/UNIQUE constraint failed: job_run.job_id/);

    // A minute on (three leases): the first instance's heartbeat keeps its run alive.
    await advanceTo(clock, [first.timers, second.timers], ms(at('09:01:00')));
    expect(openRunsOf(db2, 'sweep').map((r) => r.id)).toEqual([holder?.id]);
    expect(other.calls).toHaveLength(0);

    held.resolve(0, { checked: 5 });
    await advanceBy(clock, [first.timers, second.timers], 1_000);
    expect(await joined.outcome).toMatchObject({
      runId: holder?.id,
      status: 'completed',
      detail: { checked: 5 },
    });
    // The second instance's boot catch-up was the run it joined: nothing more ran.
    expect(runsOf(db1, 'sweep')).toHaveLength(1);

    // Both instances wake for the 09:30 slot; one runs it.
    await advanceTo(clock, [first.timers, second.timers], ms(at('09:30:30')));
    held.resolve(1);
    await advanceBy(clock, [first.timers, second.timers], 1_000);
    const slotRuns = runsOf(db1, 'sweep').filter((r) => r.reason === 'slot');
    expect(slotRuns.map((r) => [r.coalescedSlots, r.startedAt])).toEqual([[1, at('09:30:00')]]);
    expect(held.calls.length + other.calls.length).toBe(2);
    expect(jobOf(db1, 'sweep').nextRunAt).toBe(at('10:00:00'));
  });
});
