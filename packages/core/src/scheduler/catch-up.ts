// The scheduler's run decision (S§5.8 Scheduler, S§2 invariant 12 "Survive sleep"). Pure: the job,
// what woke the scheduler, the job's open run and its pending retry come in, at `now`, and one
// decision goes out. The corpus area `scheduler-catch-up` is its definition of done.
//
// The cadence is a grid of slots. The corpus writes it as a fixed step (`everyMs`); the server's
// runner passes a cron expression's slots through `SlotGrid`, so both share one decision.
import type { Id, JobRunStatus, Timestamp } from '@agentic-dasher/shared';

/** A job as the decision sees it (S§4.4 `job`). */
export interface SchedulerJob {
  readonly name: string;
  /** The cadence: slots are `nextRunAt + k × everyMs` for whole k. */
  readonly everyMs: number;
  /** The earliest slot not yet run (S§4.4 job.next_run_at). */
  readonly nextRunAt: Timestamp;
  /** From the run's start; a run that reaches it ends as timed out, keeping partial results. */
  readonly deadlineMs: number;
  /** The run waits on the DNS gate first (see network-gate.ts). */
  readonly networkGate: boolean;
}

/**
 * What woke the scheduler for this job: its clock (`tick`, possibly late after a freeze), process
 * start (`boot`), someone asking for a run (`caller`), or the one-off retry (`retry`).
 */
export type Wake = 'tick' | 'boot' | 'caller' | 'retry';

/** The job's open run, which holds its overlap lock. */
export interface OpenRun {
  readonly runId: Id;
  readonly startedAt: Timestamp;
}

export interface CatchUpInput {
  readonly now: Timestamp;
  readonly wake: Wake;
  readonly job: SchedulerJob;
  readonly running: OpenRun | null;
  readonly pendingRetryAt: Timestamp | null;
}

export type CatchUpDecision =
  | {
      readonly action: 'run';
      readonly because: Exclude<Wake, 'tick'> | 'slot';
      /** How many slots at or before `now`, from `nextRunAt` on, this one run stands for. */
      readonly coalescedSlots: number;
      /** The first slot strictly after `now` (or `nextRunAt` when none was due). */
      readonly nextRunAt: Timestamp;
      /** True when this run also stands for the pending retry, which is then dropped. */
      readonly retryCleared: boolean;
    }
  | { readonly action: 'join'; readonly runId: Id }
  | { readonly action: 'wait'; readonly nextRunAt: Timestamp }
  | {
      readonly action: 'time_out';
      readonly runId: Id;
      readonly runStatus: Extract<JobRunStatus, 'timed_out'>;
      readonly keepPartialResults: true;
    };

/** The slots of a cadence, in epoch milliseconds. */
export interface SlotGrid {
  /**
   * The slots from `nextRunAtMs` (included, assumed on the grid) up to and including `nowMs`, and
   * the first slot strictly after `nowMs`. With no slot due, `count` is 0 and `nextMs` is
   * `nextRunAtMs`.
   */
  due(nextRunAtMs: number, nowMs: number): { readonly count: number; readonly nextMs: number };
}

/** The decision's input without the cadence step: the grid comes separately. */
export interface PlanRunInput {
  readonly now: Timestamp;
  readonly wake: Wake;
  readonly nextRunAt: Timestamp;
  readonly deadlineMs: number;
  readonly running: OpenRun | null;
  readonly pendingRetryAt: Timestamp | null;
}

/** A fixed step: slots every `everyMs` from any slot on (a cron such as "every 30 minutes"). */
export function everyGrid(everyMs: number): SlotGrid {
  if (!Number.isSafeInteger(everyMs) || everyMs <= 0) {
    throw new RangeError(`everyMs must be a positive integer, got ${everyMs}`);
  }
  return {
    due(nextRunAtMs, nowMs) {
      if (nowMs < nextRunAtMs) return { count: 0, nextMs: nextRunAtMs };
      const count = Math.floor((nowMs - nextRunAtMs) / everyMs) + 1;
      return { count, nextMs: nextRunAtMs + count * everyMs };
    },
  };
}

function ms(at: Timestamp): number {
  const value = Date.parse(at);
  if (Number.isNaN(value)) throw new RangeError(`not a timestamp: ${at}`);
  return value;
}

function iso(value: number): Timestamp {
  return new Date(value).toISOString();
}

/**
 * The run decision on any grid. In order:
 * 1. An open run that has lasted `deadlineMs` or more is timed out (keeping its partial results);
 *    any other open run is joined, so a job never runs twice at once.
 * 2. A due slot (`nextRunAt ≤ now`) runs once, standing for every slot from `nextRunAt` to `now`.
 *    A boot or a caller runs once too, due slots or not; the run's reason is then `boot` or
 *    `caller`, and it stands for the due slots, if any. Else a due retry runs once.
 * 3. Otherwise the job waits for its next slot.
 * A run moves `nextRunAt` to the first slot strictly after `now`, so the cadence never drifts, and
 * stands for the pending retry, if any (the run is the make-up the retry was kept for).
 */
export function planRun(input: PlanRunInput, grid: SlotGrid): CatchUpDecision {
  const now = ms(input.now);
  const { running } = input;
  if (running) {
    if (now - ms(running.startedAt) >= input.deadlineMs) {
      return {
        action: 'time_out',
        runId: running.runId,
        runStatus: 'timed_out',
        keepPartialResults: true,
      };
    }
    return { action: 'join', runId: running.runId };
  }

  const slots = grid.due(ms(input.nextRunAt), now);
  const retryDue = input.pendingRetryAt !== null && ms(input.pendingRetryAt) <= now;
  let because: Exclude<Wake, 'tick'> | 'slot' | null = null;
  if (input.wake === 'boot' || input.wake === 'caller') because = input.wake;
  else if (slots.count > 0) because = 'slot';
  else if (retryDue) because = 'retry';

  if (because === null) return { action: 'wait', nextRunAt: input.nextRunAt };
  return {
    action: 'run',
    because,
    coalescedSlots: slots.count,
    nextRunAt: slots.count > 0 ? iso(slots.nextMs) : input.nextRunAt,
    retryCleared: input.pendingRetryAt !== null,
  };
}

/** The run decision on the job's fixed step (the corpus contract `PlanJobRun`). */
export function planJobRun(input: CatchUpInput): CatchUpDecision {
  const { job } = input;
  return planRun(
    {
      now: input.now,
      wake: input.wake,
      nextRunAt: job.nextRunAt,
      deadlineMs: job.deadlineMs,
      running: input.running,
      pendingRetryAt: input.pendingRetryAt,
    },
    everyGrid(job.everyMs),
  );
}
