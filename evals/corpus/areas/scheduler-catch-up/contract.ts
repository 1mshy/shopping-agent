// Contract of the scheduler's run decision (S§5.8 Scheduler: "every job has an overlap lock, a
// deadline and a run row; missed slots coalesce into one catch-up on resume, and boot schedules a
// catch-up; … a second caller of a running job joins it"; S§2 invariant 12; predecessor
// scheduler.py `_CATCH_UP`, `start`, `retry_sweep`, service.py `refresh_offers`). A pure decision:
// given a job, what woke the scheduler, the job's run in progress and any pending retry, at `now`.
import type { Id, JobRunStatus, Timestamp } from '@agentic-dasher/shared';

export interface SchedulerJob {
  /** S§4.4 job.name (unique). */
  readonly name: string;
  /**
   * The cadence in milliseconds. Slots are `nextRunAt + k × everyMs` for whole k, as a fixed cron
   * does ("every 30 minutes" on the hour and the half hour; "daily at 07:40"), so a run at any
   * time never shifts later slots.
   */
  readonly everyMs: number;
  /** The earliest slot not yet run (S§4.4 job.next_run_at). */
  readonly nextRunAt: Timestamp;
  /**
   * S§4.4 job deadline, from the run's start. A run that reaches it ends as timed out, keeping its
   * partial results (settled by the orchestrator 2026-11-23, the owner may overrule).
   */
  readonly deadlineMs: number;
  /** S§4.4 job network gate: the run waits on the DNS gate (scheduler-network-gate). */
  readonly networkGate: boolean;
}

/**
 * What woke the scheduler for this job: `tick` (its clock, possibly late after a freeze), `boot`
 * (process start), `caller` (someone asked for a run: POST /api/refresh, a wake hook), `retry`
 * (the one-off retry the network gate or a failed run left).
 */
export type Wake = 'tick' | 'boot' | 'caller' | 'retry';

export interface CatchUpInput {
  readonly now: Timestamp;
  readonly wake: Wake;
  readonly job: SchedulerJob;
  /** The job's run in progress, which holds its overlap lock; null when none. */
  readonly running: { readonly runId: Id; readonly startedAt: Timestamp } | null;
  /** When the pending one-off retry is due; null when there is none. */
  readonly pendingRetryAt: Timestamp | null;
}

export type CatchUpDecision =
  | {
      readonly action: 'run';
      readonly because: Exclude<Wake, 'tick'> | 'slot';
      /** How many slots at or before `now`, from `nextRunAt` on, this one run stands for. */
      readonly coalescedSlots: number;
      /** The first slot after `now`: the cadence is never moved. */
      readonly nextRunAt: Timestamp;
      /** True when this run also stands for the pending retry, which is then dropped. */
      readonly retryCleared: boolean;
    }
  | { readonly action: 'join'; readonly runId: Id }
  | { readonly action: 'wait'; readonly nextRunAt: Timestamp }
  /**
   * The run in progress has reached the job's deadline: end it with job_run status `timed_out`,
   * keeping what it has written (its partial results), and release the overlap lock.
   */
  | {
      readonly action: 'time_out';
      readonly runId: Id;
      readonly runStatus: Extract<JobRunStatus, 'timed_out'>;
      readonly keepPartialResults: true;
    };

/**
 * The subject (Phase 1, apps/server scheduler). A running job whose run has lasted `deadlineMs` or
 * more (`now − startedAt ≥ deadlineMs`) is timed out; otherwise a running job is joined, never run
 * twice. Else a
 * tick runs once when `nextRunAt ≤ now`, standing for every slot from `nextRunAt` to `now`; boot
 * always runs once (a catch-up), standing for the overdue slots if any; a due retry runs once. The
 * next slot is the first slot strictly after `now` on the job's grid (when `now` is exactly on a
 * slot, that slot is one of those coalesced).
 */
export type PlanJobRun = (input: CatchUpInput) => CatchUpDecision;

/** `ruling`: the owner's rulings of 2026-11-23 or a detail the orchestrator settled that day. */
export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec' | 'ruling';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface CatchUpCase {
  readonly id: string;
  readonly what: string;
  readonly input: CatchUpInput;
  readonly expected: CatchUpDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
