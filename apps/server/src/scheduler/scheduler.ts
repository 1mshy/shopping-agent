// The scheduler (S§5.8 Scheduler, S§2 invariant 12 "Survive sleep", S§4.4 job and job_run): jobs
// registered in code, their state in SQLite, and the decisions of packages/core (planRun,
// networkGate) applied to it.
//
// Exactly once per slot window rests on the database, not on this process's memory: every
// read-decide-write step runs in a BEGIN IMMEDIATE transaction, and the job's open job_run row is
// its overlap lock (job_run_open_idx allows one per job). A run moves next_run_at to the first
// slot after its start in the same transaction that takes the lock, so a freeze, a late timer, a
// second wake or a second process finds the slot already taken.
//
// An open run carries its owner's instance id and a heartbeat in detail_json. A run whose owner's
// heartbeat has lapsed for `leaseMs` belongs to a process that died, and is ended `failed`; a run
// that has reached its deadline is ended `timed_out` by whoever sees it first.
import { randomUUID } from 'node:crypto';
import {
  type CatchUpDecision,
  NETWORK_PROBE_TIMEOUT_MS,
  networkGate,
  type Probe,
  planRun,
  type SlotGrid,
  type Wake,
} from '@agentic-dasher/core';
import type { Database } from '@agentic-dasher/db';
import type { JobRunReason, JobRunStatus } from '@agentic-dasher/shared';
import { type CronGrid, cronGrid, oneOffGrid } from './cron.ts';
import { type DnsProbe, dnsLookupProbe } from './probe.ts';
import {
  type Detail,
  endRun,
  heartbeat,
  immediate,
  insertJob,
  insertRun,
  type JobRow,
  jobById,
  jobByName,
  lastRunOf,
  oneOffSpent,
  openRunOf,
  openRuns,
  type RunRow,
  runById,
  setOpenRunDetail,
  skippedRunsOf,
  updateJob,
} from './store.ts';
import { iso, ms, type Now, nodeTimers, sleepUntil, type Timers } from './time.ts';

/** What a job's handler receives. */
export interface JobContext {
  /** Fired when the run reaches its deadline or the scheduler stops. */
  readonly signal: AbortSignal;
  readonly runId: number;
  readonly reason: JobRunReason;
  /** How many slots of the cadence this run stands for. */
  readonly coalescedSlots: number;
  readonly startedAt: string;
  /**
   * Records the partial results so far (cumulative: each call replaces the last) in the run's
   * detail_json. A run that times out or is interrupted keeps the last one reported.
   */
  report(partial: Detail): void;
}

/** Resolves to the run's detail (a JSON object, for Diagnostics) or nothing; a throw fails it. */
export type JobHandler = (context: JobContext) => Promise<unknown>;

export interface JobDefinition {
  /** S§4.4 job.name, unique. */
  readonly name: string;
  /** The cadence in croner syntax, evaluated in UTC. Exactly one of `cron` and `at`. */
  readonly cron?: string;
  /** A one-off time (UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`). */
  readonly at?: string;
  /** From the run's start (the DNS gate's wait included). */
  readonly deadlineMs: number;
  /** Wait for DNS to answer before running (S§5.8). */
  readonly networkGate: boolean;
  readonly handler: JobHandler;
}

export interface SchedulerOptions {
  readonly db: Database;
  readonly now?: Now;
  readonly timers?: Timers;
  /** The DNS gate's probe; default: a `node:dns` lookup of `probeHost`. */
  readonly probe?: DnsProbe;
  readonly probeHost?: string;
  readonly probeTimeoutMs?: number;
  /** The longest the loop sleeps before reading the wall clock again. */
  readonly maxSleepMs?: number;
  /** How often an open run's heartbeat is stamped. */
  readonly heartbeatMs?: number;
  /** A run whose heartbeat is this old, and is not this instance's, belongs to a dead process. */
  readonly leaseMs?: number;
  /** How often a run held by another instance is looked at again. */
  readonly foreignPollMs?: number;
  /** How long stop() waits for aborted handlers to settle. */
  readonly stopGraceMs?: number;
  readonly instanceId?: string;
  readonly onError?: (error: unknown, where: string) => void;
}

/** How a run ended. `running` only when stop() came while another instance still held it. */
export interface RunOutcome {
  readonly runId: number;
  readonly job: string;
  readonly status: JobRunStatus;
  readonly reason: JobRunReason | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly detail: Detail | null;
}

export interface TriggerResult {
  readonly runId: number;
  /** True when the job was already running and this caller joined that run. */
  readonly joined: boolean;
  /** Settles when the run ends; every caller of one run gets the same promise. Never rejects. */
  readonly outcome: Promise<RunOutcome>;
}

/** Per job, for /api/health and Diagnostics (S§5.8). */
export interface JobHealth {
  readonly name: string;
  readonly cron: string | null;
  /** The earliest slot not yet run; null for a one-off that has run. */
  readonly nextRunAt: string | null;
  /** The pending one-off retry. */
  readonly retryAt: string | null;
  readonly running: boolean;
  readonly lastRun: {
    readonly id: number;
    readonly status: JobRunStatus;
    readonly reason: JobRunReason | null;
    readonly startedAt: string;
    readonly endedAt: string | null;
  } | null;
  readonly skippedRuns: number;
}

export interface Scheduler {
  /** Adds a job; only before start(). */
  register(job: JobDefinition): void;
  /** Upserts the jobs, ends runs left by a dead process, and gives every job its boot decision. */
  start(): void;
  /** Stops the loop, aborts running handlers, waits for them up to the grace and ends the rest. */
  stop(): Promise<void>;
  /** Runs the job now, or joins its run in progress (POST /api/refresh). */
  trigger(name: string): TriggerResult;
  /** Reads the wall clock and decides again now (a resume hook may call it). */
  wake(): void;
  health(): JobHealth[];
  readonly instanceId: string;
}

const DEFAULTS = {
  probeHost: 'example.com',
  maxSleepMs: 30_000,
  heartbeatMs: 5_000,
  leaseMs: 20_000,
  foreignPollMs: 1_000,
  stopGraceMs: 5_000,
  errorBackoffMs: 1_000,
} as const;

const STOPPED = 'stopped: the scheduler shut down before the run ended';
const INTERRUPTED = 'interrupted: the process running it stopped before it ended';

class SchedulerStopped extends Error {
  override name = 'SchedulerStopped';
}
class DeadlineReached extends Error {
  override name = 'DeadlineReached';
}

interface Registered {
  readonly def: JobDefinition;
  /** Null for a one-off job. */
  readonly cron: CronGrid | null;
  id: number;
}

interface OwnRun {
  readonly runId: number;
  readonly job: Registered;
  readonly startedAt: string;
  readonly reason: JobRunReason;
  readonly coalescedSlots: number;
  readonly controller: AbortController;
  partial: Detail | null;
  ended: boolean;
  readonly outcome: Promise<RunOutcome>;
  readonly settle: (outcome: RunOutcome) => void;
  done: Promise<void>;
}

interface Deferred {
  readonly promise: Promise<RunOutcome>;
  readonly resolve: (outcome: RunOutcome) => void;
}

/** A run end whose write failed; retried on the next wake so the lock is never left behind. */
interface UnfinishedEnd {
  readonly own: OwnRun;
  readonly status: Exclude<JobRunStatus, 'running'>;
  readonly detail: Detail | null;
  readonly retryAt: string | undefined;
}

function deferred(): Deferred {
  let resolve!: (outcome: RunOutcome) => void;
  const promise = new Promise<RunOutcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** A handler's value as a detail_json object (the column holds JSON objects only). */
function toDetail(value: unknown): Detail | null {
  if (value === undefined || value === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(value) ?? 'null');
  } catch {
    return { unserialisable: true };
  }
  if (json === null) return null;
  if (typeof json === 'object' && !Array.isArray(json)) return json as Detail;
  return { value: json };
}

function partialOf(detail: Detail | null): Detail | null {
  const partial = detail?.partial;
  return partial !== null && typeof partial === 'object' && !Array.isArray(partial)
    ? (partial as Detail)
    : null;
}

/** An ended run's detail: why it did not complete, and the partial results it reported. */
function endedDetail(error: string, partial: Detail | null): Detail {
  return partial ? { error, partial } : { error };
}

function positive(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  return new SqliteScheduler(options);
}

class SqliteScheduler implements Scheduler {
  readonly instanceId: string;
  readonly #db: Database;
  readonly #now: Now;
  readonly #timers: Timers;
  readonly #probe: DnsProbe;
  readonly #probeTimeoutMs: number;
  readonly #maxSleepMs: number;
  readonly #heartbeatMs: number;
  readonly #leaseMs: number;
  readonly #foreignPollMs: number;
  readonly #stopGraceMs: number;
  readonly #onError: (error: unknown, where: string) => void;

  readonly #jobs = new Map<string, Registered>();
  readonly #byId = new Map<number, Registered>();
  /** This instance's open runs, by run id. */
  readonly #own = new Map<number, OwnRun>();
  /** Callers waiting on a run another instance holds, by run id. */
  readonly #foreign = new Map<number, Deferred>();
  /** Jobs whose boot catch-up has not run yet (deferred while another instance's run is open). */
  readonly #bootPending = new Set<number>();
  /** The other instance's run a deferred boot catch-up joined, by job id. */
  readonly #bootJoined = new Map<number, number>();
  #unfinished: UnfinishedEnd[] = [];

  #started = false;
  #stopping = false;
  #stopped: Promise<void> | null = null;
  #timer: unknown;
  #ticking = false;
  #again = false;

  constructor(options: SchedulerOptions) {
    this.#db = options.db;
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? nodeTimers;
    this.#probe = options.probe ?? dnsLookupProbe(options.probeHost ?? DEFAULTS.probeHost);
    this.#probeTimeoutMs = positive(
      'probeTimeoutMs',
      options.probeTimeoutMs ?? NETWORK_PROBE_TIMEOUT_MS,
    );
    this.#maxSleepMs = positive('maxSleepMs', options.maxSleepMs ?? DEFAULTS.maxSleepMs);
    this.#heartbeatMs = positive('heartbeatMs', options.heartbeatMs ?? DEFAULTS.heartbeatMs);
    this.#leaseMs = positive('leaseMs', options.leaseMs ?? DEFAULTS.leaseMs);
    if (this.#leaseMs <= this.#heartbeatMs) {
      throw new RangeError('leaseMs must be longer than heartbeatMs');
    }
    this.#foreignPollMs = positive(
      'foreignPollMs',
      options.foreignPollMs ?? DEFAULTS.foreignPollMs,
    );
    this.#stopGraceMs = positive('stopGraceMs', options.stopGraceMs ?? DEFAULTS.stopGraceMs);
    this.instanceId = options.instanceId ?? randomUUID();
    this.#onError =
      options.onError ??
      ((error, where) => {
        console.error(`scheduler: ${where}:`, error);
      });
  }

  register(def: JobDefinition): void {
    if (this.#started) throw new Error('jobs are registered before start()');
    if (!def.name) throw new Error('a job needs a name');
    if (this.#jobs.has(def.name)) throw new Error(`job ${def.name} is registered twice`);
    positive(`${def.name}: deadlineMs`, def.deadlineMs);
    if ((def.cron === undefined) === (def.at === undefined)) {
      throw new Error(`job ${def.name}: give exactly one of cron and at`);
    }
    let cron: CronGrid | null = null;
    if (def.cron !== undefined) cron = cronGrid(def.cron, this.#now());
    else {
      const at = ms(def.at ?? '');
      if (Number.isNaN(at) || iso(at) !== def.at) {
        throw new Error(`job ${def.name}: at must be a UTC timestamp with milliseconds`);
      }
    }
    this.#jobs.set(def.name, { def, cron, id: 0 });
  }

  start(): void {
    if (this.#started) throw new Error('the scheduler has already been started');
    this.#started = true;
    const nowMs = this.#now();
    for (const reg of this.#jobs.values()) {
      reg.id = this.#upsert(reg, nowMs);
      this.#byId.set(reg.id, reg);
    }
    this.#recoverAtBoot(nowMs);
    // Boot schedules a catch-up of every cadence. A one-off job runs at its time, not at every
    // start, so its boot is an ordinary tick.
    for (const reg of this.#jobs.values()) if (reg.cron) this.#bootPending.add(reg.id);
    this.#tick();
  }

  stop(): Promise<void> {
    if (!this.#stopped) this.#stopped = this.#stop();
    return this.#stopped;
  }

  trigger(name: string): TriggerResult {
    if (!this.#started || this.#stopping) throw new Error('the scheduler is not running');
    const reg = this.#jobs.get(name);
    if (!reg) throw new Error(`no job named ${name}`);
    for (const own of this.#own.values()) {
      if (own.job === reg) return { runId: own.runId, joined: true, outcome: own.outcome };
    }
    const result = this.#plan(reg, 'caller', this.#now());
    this.#arm(false);
    if (!result) throw new Error(`job ${name}: a caller was neither run nor joined`);
    return result;
  }

  wake(): void {
    this.#tick();
  }

  health(): JobHealth[] {
    const out: JobHealth[] = [];
    for (const reg of this.#jobs.values()) {
      const row = jobByName(this.#db, reg.def.name);
      if (!row) continue;
      const last = lastRunOf(this.#db, row.id);
      const spent =
        row.cron === null && row.nextRunAt !== null && oneOffSpent(this.#db, row.id, row.nextRunAt);
      out.push({
        name: row.name,
        cron: row.cron,
        nextRunAt: spent ? null : row.nextRunAt,
        retryAt: row.retryAt,
        running: last?.endedAt === null,
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              reason: last.reason,
              startedAt: last.startedAt,
              endedAt: last.endedAt,
            }
          : null,
        skippedRuns: skippedRunsOf(this.#db, row.id),
      });
    }
    return out;
  }

  // --- start-up -------------------------------------------------------------------------------

  /** Writes the job as registered; next_run_at keeps the earliest slot not yet run. */
  #upsert(reg: Registered, nowMs: number): number {
    const { def, cron } = reg;
    return immediate(this.#db, () => {
      const row = jobByName(this.#db, def.name);
      const fixed = { deadlineMs: def.deadlineMs, networkGate: def.networkGate };
      if (!row) {
        const nextRunAt = cron ? iso(cron.firstAfter(nowMs)) : (def.at as string);
        return insertJob(this.#db, {
          name: def.name,
          cron: def.cron ?? null,
          nextRunAt,
          retryAt: null,
          ...fixed,
        });
      }
      let nextRunAt = row.nextRunAt;
      if (cron) {
        // Same cron: keep next_run_at, overdue or not (the boot catch-up counts it). A changed
        // cron starts at its first slot at or after the old next slot, so overdue stays overdue.
        if (row.cron !== def.cron || nextRunAt === null) {
          nextRunAt =
            row.cron !== null && nextRunAt !== null
              ? iso(cron.firstAtOrAfter(ms(nextRunAt)))
              : iso(cron.firstAfter(nowMs));
        }
      } else if (row.cron !== null || nextRunAt !== def.at) {
        nextRunAt = def.at as string;
      }
      updateJob(this.#db, row.id, { cron: def.cron ?? null, nextRunAt, ...fixed });
      return row.id;
    });
  }

  /**
   * Ends the open runs a dead process left (every job's, registered or not): `timed_out` when
   * the run has reached its deadline, else `failed`, keeping the partial results it reported. A
   * run whose owner is still alive (heartbeat within the lease) is left to it.
   */
  #recoverAtBoot(nowMs: number): void {
    const settled: number[] = [];
    immediate(this.#db, () => {
      for (const open of openRuns(this.#db)) {
        const row = jobById(this.#db, open.jobId);
        if (!row) continue;
        const reached = nowMs - ms(open.startedAt) >= row.deadlineMs;
        if (!reached && !this.#staleForeign(open, nowMs)) continue;
        this.#endOther(open, row, nowMs, reached ? 'timed_out' : 'failed');
        settled.push(open.id);
      }
    });
    for (const id of settled) this.#settleForeign(id);
  }

  // --- the loop -------------------------------------------------------------------------------

  #tick(): void {
    if (!this.#started || this.#stopping) return;
    if (this.#ticking) {
      this.#again = true;
      return;
    }
    this.#ticking = true;
    let hadError = false;
    try {
      do {
        this.#again = false;
        const nowMs = this.#now();
        if (!this.#retryUnfinished()) hadError = true;
        if (this.#own.size > 0) {
          try {
            heartbeat(this.#db, this.instanceId, iso(nowMs));
          } catch (error) {
            this.#onError(error, 'heartbeat');
            hadError = true;
          }
        }
        for (const reg of this.#jobs.values()) {
          try {
            this.#plan(reg, this.#bootPending.has(reg.id) ? 'boot' : 'tick', nowMs);
          } catch (error) {
            this.#onError(error, `job ${reg.def.name}`);
            hadError = true;
          }
        }
        for (const runId of [...this.#foreign.keys()]) {
          try {
            this.#settleForeign(runId);
          } catch (error) {
            this.#onError(error, `run ${runId}`);
            hadError = true;
          }
        }
      } while (this.#again);
    } finally {
      this.#ticking = false;
    }
    this.#arm(hadError);
  }

  /** Sets the one loop timer: the earliest due time, never longer than maxSleepMs. */
  #arm(hadError: boolean): void {
    if (!this.#started || this.#stopping) return;
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    const nowMs = this.#now();
    let wakeAt = nowMs + this.#maxSleepMs;
    const consider = (at: number) => {
      if (at < wakeAt) wakeAt = at;
    };
    if (this.#own.size > 0 || this.#unfinished.length > 0) consider(nowMs + this.#heartbeatMs);
    if (this.#foreign.size > 0) consider(nowMs + this.#foreignPollMs);
    try {
      for (const reg of this.#jobs.values()) {
        const row = jobById(this.#db, reg.id);
        if (!row) continue;
        const open = openRunOf(this.#db, reg.id);
        if (open) {
          // Its slot and retry wait for the run to end (which wakes the loop); its deadline and,
          // for another instance's run, its lease do not.
          consider(ms(open.startedAt) + row.deadlineMs);
          if (!this.#own.has(open.id) && open.detail?.instance !== this.instanceId) {
            // Looked at again when its lease would lapse, but never more often than the poll.
            const lease = this.#leaseEnd(open);
            consider(Math.max(Number.isNaN(lease) ? nowMs : lease, nowMs + this.#foreignPollMs));
          }
          continue;
        }
        if (row.retryAt !== null) consider(ms(row.retryAt));
        if (row.nextRunAt !== null) {
          const spent = reg.cron === null && oneOffSpent(this.#db, reg.id, row.nextRunAt);
          if (!spent) consider(ms(row.nextRunAt));
        }
      }
    } catch (error) {
      this.#onError(error, 'arm');
      hadError = true;
    }
    let delay = Math.min(Math.max(0, wakeAt - nowMs), this.#maxSleepMs);
    if (hadError) delay = Math.max(delay, DEFAULTS.errorBackoffMs);
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = undefined;
      this.#tick();
    }, delay);
  }

  /**
   * One job's decision at `nowMs`, read and written in one IMMEDIATE transaction. Returns what a
   * caller gets (the run started or joined), or null when the job waits.
   */
  #plan(reg: Registered, wake: Wake, nowMs: number): TriggerResult | null {
    const now = iso(nowMs);
    // What to do once the transaction has committed.
    const after = {
      settle: [] as number[],
      abandon: [] as { own: OwnRun; outcome: RunOutcome }[],
      bootSatisfied: false,
    };

    const result = immediate(this.#db, () => {
      const row = jobById(this.#db, reg.id);
      if (!row || row.nextRunAt === null) throw new Error(`job ${reg.def.name} has no row`);
      const nextRunAt = row.nextRunAt;
      let open: RunRow | null = openRunOf(this.#db, reg.id) ?? null;
      let effective: Wake = wake;
      if (wake === 'boot') {
        // A boot catch-up deferred behind another instance's run: if that run has ended at its
        // owner's hands, it stood for the catch-up (a join), so this is an ordinary tick.
        const joined = this.#bootJoined.get(reg.id);
        if (joined !== undefined && open?.id !== joined) {
          effective = 'tick';
          after.bootSatisfied = true;
        }
      }

      let retryAt = row.retryAt;
      if (open && !this.#own.has(open.id) && this.#staleForeign(open, nowMs)) {
        if (nowMs - ms(open.startedAt) < row.deadlineMs) {
          retryAt = this.#endOther(open, row, nowMs, 'failed');
          after.settle.push(open.id);
          open = null;
        }
      }

      const grid: SlotGrid = reg.cron ?? oneOffGrid(oneOffSpent(this.#db, reg.id, nextRunAt));
      const decide = (running: RunRow | null): CatchUpDecision =>
        planRun(
          {
            now,
            wake: effective,
            nextRunAt,
            deadlineMs: row.deadlineMs,
            running: running ? { runId: running.id, startedAt: running.startedAt } : null,
            pendingRetryAt: retryAt,
          },
          grid,
        );

      let decision = decide(open);
      if (decision.action === 'time_out' && open) {
        const own = this.#own.get(open.id);
        if (own) {
          const detail = endedDetail(
            `deadline of ${row.deadlineMs} ms reached`,
            own.partial ?? partialOf(open.detail),
          );
          const endedAt = iso(Math.max(nowMs, ms(open.startedAt)));
          endRun(this.#db, open.id, 'timed_out', endedAt, detail);
          after.abandon.push({ own, outcome: this.#outcome(own, 'timed_out', endedAt, detail) });
        } else {
          this.#endOther(open, row, nowMs, 'timed_out');
          after.settle.push(open.id);
        }
        open = null;
        decision = decide(null);
      }

      if (decision.action === 'run') {
        const runId = insertRun(this.#db, {
          jobId: reg.id,
          startedAt: now,
          reason: decision.because,
          coalescedSlots: decision.coalescedSlots,
          detail: { instance: this.instanceId, heartbeatAt: now },
        });
        updateJob(this.#db, reg.id, {
          nextRunAt: decision.nextRunAt,
          ...(decision.retryCleared ? { retryAt: null } : {}),
        });
        return { kind: 'run' as const, runId, decision };
      }
      if (decision.action === 'join') return { kind: 'join' as const, runId: decision.runId };
      return null;
    });

    for (const timedOut of after.abandon) this.#abandon(timedOut);
    for (const id of after.settle) this.#settleForeign(id);
    if (after.bootSatisfied || (result && wake === 'boot' && result.kind === 'run')) {
      this.#bootPending.delete(reg.id);
      this.#bootJoined.delete(reg.id);
    }

    if (!result) return null;
    if (result.kind === 'run') {
      const { decision } = result;
      if (decision.action !== 'run') return null;
      const own = this.#startRun(reg, result.runId, now, decision.because, decision.coalescedSlots);
      return { runId: own.runId, joined: false, outcome: own.outcome };
    }
    const own = this.#own.get(result.runId);
    if (own) {
      if (wake === 'boot') this.#bootPending.delete(reg.id);
      return { runId: own.runId, joined: true, outcome: own.outcome };
    }
    if (wake === 'boot') this.#bootJoined.set(reg.id, result.runId);
    return { runId: result.runId, joined: true, outcome: this.#foreignOutcome(result.runId) };
  }

  // --- runs -----------------------------------------------------------------------------------

  #startRun(
    reg: Registered,
    runId: number,
    startedAt: string,
    reason: JobRunReason,
    coalescedSlots: number,
  ): OwnRun {
    const { promise, resolve } = deferred();
    const own: OwnRun = {
      runId,
      job: reg,
      startedAt,
      reason,
      coalescedSlots,
      controller: new AbortController(),
      partial: null,
      ended: false,
      outcome: promise,
      settle: resolve,
      done: Promise.resolve(),
    };
    this.#own.set(runId, own);
    own.done = this.#execute(own).catch((error: unknown) => {
      this.#onError(error, `run ${runId}`);
    });
    return own;
  }

  async #execute(own: OwnRun): Promise<void> {
    const { signal } = own.controller;
    try {
      if (own.job.def.networkGate) {
        const gate = await this.#gate(own);
        if (own.ended) return;
        if (gate.action === 'postpone') {
          const detail: Detail = {
            error: `no network: DNS did not resolve after ${gate.probes.length} probes`,
            probes: gate.probes,
            retryAt: gate.retryAt,
          };
          this.#finish(own, 'skipped', detail, gate.retryAt);
          return;
        }
      }
      const context: JobContext = {
        signal,
        runId: own.runId,
        reason: own.reason,
        coalescedSlots: own.coalescedSlots,
        startedAt: own.startedAt,
        report: (partial) => this.#report(own, partial),
      };
      // Not raced against the signal: on stop() a handler may still finish within the grace; at
      // the deadline the run has already been ended and whatever the handler does is ignored.
      const value = await own.job.def.handler(context);
      if (own.ended) return;
      this.#finish(own, 'completed', toDetail(value));
    } catch (error) {
      if (own.ended) return;
      const stopped = signal.aborted && signal.reason instanceof SchedulerStopped;
      this.#finish(own, 'failed', endedDetail(stopped ? STOPPED : errorText(error), own.partial));
    }
  }

  /** The DNS gate: probes with the delays of networkGate, then runs or postpones. */
  async #gate(
    own: OwnRun,
  ): Promise<{ action: 'run' } | { action: 'postpone'; retryAt: string; probes: Probe[] }> {
    const { signal } = own.controller;
    const gateStartedAt = iso(this.#now());
    const probes: Probe[] = [];
    for (;;) {
      // pendingRetryAt does not enter the gate's probing steps.
      const decision = networkGate({
        kind: 'gate',
        now: iso(this.#now()),
        gateStartedAt,
        probes,
        pendingRetryAt: null,
      });
      if (decision.action === 'run') return decision;
      if (decision.action === 'postpone') {
        return { action: 'postpone', retryAt: decision.retryAt, probes };
      }
      if (decision.action !== 'probe') throw new Error(`unexpected gate step ${decision.action}`);
      await sleepUntil(this.#now, this.#timers, ms(decision.at), this.#maxSleepMs, signal);
      const resolved = await this.#probeOnce(signal);
      probes.push({ at: iso(this.#now()), resolved });
    }
  }

  /** One probe; one that has not answered within the probe timeout counts as unresolved. */
  #probeOnce(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let handle: unknown;
      const done = (resolved: boolean) => {
        if (settled) return;
        settled = true;
        this.#timers.clearTimeout(handle);
        signal.removeEventListener('abort', onAbort);
        resolve(resolved);
      };
      const onAbort = () => done(false);
      handle = this.#timers.setTimeout(() => done(false), this.#probeTimeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      let answer: Promise<boolean>;
      try {
        answer = this.#probe(signal);
      } catch {
        done(false);
        return;
      }
      answer.then(
        (value) => done(value === true),
        () => done(false),
      );
    });
  }

  #report(own: OwnRun, partial: Detail): void {
    if (own.ended) return;
    const value = toDetail(partial);
    own.partial = value;
    try {
      setOpenRunDetail(this.#db, own.runId, {
        instance: this.instanceId,
        heartbeatAt: iso(this.#now()),
        ...(value ? { partial: value } : {}),
      });
    } catch (error) {
      this.#onError(error, `run ${own.runId}: report`);
    }
  }

  /**
   * Ends this instance's run and applies what it leaves behind: a skipped run keeps its retry, a
   * failed one gets a retry in 60 s, a completed one drops the pending retry (networkGate's
   * run_ended rule). Then decides again, since a slot may have come due during the run.
   */
  #finish(
    own: OwnRun,
    status: Exclude<JobRunStatus, 'running'>,
    detail: Detail | null,
    retryAt?: string,
  ): void {
    if (own.ended) return;
    own.ended = true;
    if (!this.#writeEnd({ own, status, detail, retryAt })) {
      this.#unfinished.push({ own, status, detail, retryAt });
    }
    this.#tick();
  }

  /** Writes an end; false when the write failed (it is retried). Settles the run's callers. */
  #writeEnd(end: UnfinishedEnd): boolean {
    const { own, status, detail, retryAt } = end;
    const nowMs = this.#now();
    const endedAt = iso(Math.max(nowMs, ms(own.startedAt)));
    let ended: boolean;
    try {
      ended = immediate(this.#db, () => {
        if (!endRun(this.#db, own.runId, status, endedAt, detail)) return false;
        const row = jobById(this.#db, own.job.id);
        if (status === 'skipped' && retryAt !== undefined) {
          updateJob(this.#db, own.job.id, { retryAt });
        } else if (row && (status === 'completed' || status === 'failed')) {
          const next = networkGate({
            kind: 'run_ended',
            now: endedAt,
            status,
            pendingRetryAt: row.retryAt,
          });
          if (next.action === 'retry_later') {
            updateJob(this.#db, own.job.id, { retryAt: next.retryAt });
          } else if (next.action === 'done' && next.retryCleared) {
            updateJob(this.#db, own.job.id, { retryAt: null });
          }
        }
        return true;
      });
    } catch (error) {
      this.#onError(error, `run ${own.runId}: end`);
      return false;
    }
    this.#own.delete(own.runId);
    if (ended) {
      own.settle(this.#outcome(own, status, endedAt, detail));
    } else {
      // Another instance ended it first (its deadline, or it took the run for a dead one's).
      const row = runById(this.#db, own.runId);
      own.settle(row ? this.#rowOutcome(row) : this.#outcome(own, status, endedAt, detail));
    }
    return true;
  }

  /** True when every pending end has now been written. */
  #retryUnfinished(): boolean {
    if (this.#unfinished.length === 0) return true;
    this.#unfinished = this.#unfinished.filter((end) => !this.#writeEnd(end));
    return this.#unfinished.length === 0;
  }

  /** A run of this instance timed out (its row is already ended): fire its signal, settle it. */
  #abandon({ own, outcome }: { own: OwnRun; outcome: RunOutcome }): void {
    own.ended = true;
    this.#own.delete(own.runId);
    own.controller.abort(new DeadlineReached(`deadline of ${own.job.def.deadlineMs} ms reached`));
    own.settle(outcome);
  }

  /**
   * Ends a run this instance does not own (a dead process's, or one past its deadline), inside
   * the caller's transaction. A failed end gets the failed-run retry. Returns the job's retry_at.
   */
  #endOther(
    open: RunRow,
    row: JobRow,
    nowMs: number,
    status: 'failed' | 'timed_out',
  ): string | null {
    const partial = partialOf(open.detail);
    const endedAt = iso(Math.max(nowMs, ms(open.startedAt)));
    const error = status === 'timed_out' ? `deadline of ${row.deadlineMs} ms reached` : INTERRUPTED;
    endRun(this.#db, open.id, status, endedAt, endedDetail(error, partial));
    if (status !== 'failed') return row.retryAt;
    const next = networkGate({
      kind: 'run_ended',
      now: endedAt,
      status: 'failed',
      pendingRetryAt: row.retryAt,
    });
    if (next.action !== 'retry_later') return row.retryAt;
    updateJob(this.#db, row.id, { retryAt: next.retryAt });
    return next.retryAt;
  }

  #staleForeign(open: RunRow, nowMs: number): boolean {
    if (open.detail?.instance === this.instanceId) return false;
    return !(this.#leaseEnd(open) > nowMs);
  }

  /** When another instance's run counts as abandoned; NaN (at once) without a heartbeat. */
  #leaseEnd(open: RunRow): number {
    const beat = open.detail?.heartbeatAt;
    return (typeof beat === 'string' ? ms(beat) : Number.NaN) + this.#leaseMs;
  }

  #foreignOutcome(runId: number): Promise<RunOutcome> {
    let wait = this.#foreign.get(runId);
    if (!wait) {
      wait = deferred();
      this.#foreign.set(runId, wait);
    }
    return wait.promise;
  }

  #settleForeign(runId: number, force = false): void {
    const wait = this.#foreign.get(runId);
    if (!wait) return;
    const row = runById(this.#db, runId);
    if (!row || (row.endedAt === null && !force)) return;
    this.#foreign.delete(runId);
    wait.resolve(this.#rowOutcome(row));
  }

  #outcome(
    own: OwnRun,
    status: JobRunStatus,
    endedAt: string | null,
    detail: Detail | null,
  ): RunOutcome {
    return {
      runId: own.runId,
      job: own.job.def.name,
      status,
      reason: own.reason,
      startedAt: own.startedAt,
      endedAt,
      detail,
    };
  }

  #rowOutcome(row: RunRow): RunOutcome {
    return {
      runId: row.id,
      job: this.#byId.get(row.jobId)?.def.name ?? String(row.jobId),
      status: row.status,
      reason: row.reason,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      detail: row.detail,
    };
  }

  // --- stop -----------------------------------------------------------------------------------

  async #stop(): Promise<void> {
    if (!this.#started) return;
    this.#stopping = true;
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    const runs = [...this.#own.values()];
    for (const own of runs) own.controller.abort(new SchedulerStopped(STOPPED));
    if (runs.length > 0) {
      let handle: unknown;
      const grace = new Promise<void>((resolve) => {
        handle = this.#timers.setTimeout(resolve, this.#stopGraceMs);
      });
      await Promise.race([Promise.allSettled(runs.map((own) => own.done)), grace]);
      this.#timers.clearTimeout(handle);
    }
    for (const own of runs) {
      if (own.ended) continue;
      own.ended = true;
      const end: UnfinishedEnd = {
        own,
        status: 'failed',
        detail: endedDetail(STOPPED, own.partial),
        retryAt: undefined,
      };
      if (!this.#writeEnd(end)) this.#unfinished.push(end);
    }
    // Ends whose write failed get one more try; a run left open is ended at the next boot.
    this.#retryUnfinished();
    for (const runId of [...this.#foreign.keys()]) this.#settleForeign(runId, true);
  }
}
