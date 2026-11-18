// Contract of the DNS gate and the 60 s retry (S§5.8 Scheduler: "network-dependent jobs wait on a
// DNS gate (probes at 0/3/5/10/20/30 s), then retry in 60 s without moving the cadence"; S§2
// invariant 12 "work waits for the network, and nothing is silently dropped"; predecessor
// scheduler.py `network_ready`, `NETWORK_PROBE_DELAYS`, `sweep`, `retry_sweep`). Pure decisions:
// what the gate does next given the probes so far, and what a finished run leaves behind.
import type { JobRunStatus, Timestamp } from '@agentic-dasher/shared';

/** One DNS probe: when its answer came (or it timed out), and whether the name resolved. */
export interface Probe {
  readonly at: Timestamp;
  readonly resolved: boolean;
}

export type GateInput =
  | {
      readonly kind: 'gate';
      readonly now: Timestamp;
      /** When the job's run reached the gate. */
      readonly gateStartedAt: Timestamp;
      /** The probes made so far in this gate, oldest first. */
      readonly probes: readonly Probe[];
      /** The job's pending one-off retry, if any (this run may be it). */
      readonly pendingRetryAt: Timestamp | null;
    }
  | {
      readonly kind: 'run_ended';
      readonly now: Timestamp;
      readonly status: Extract<JobRunStatus, 'completed' | 'failed'>;
      readonly pendingRetryAt: Timestamp | null;
    };

export type GateDecision =
  /** Make the next probe at `at`. */
  | { readonly action: 'probe'; readonly at: Timestamp }
  /** The network is back: run the job now. */
  | { readonly action: 'run' }
  /**
   * The network did not come back: record the run as `skipped` (health reports skipped runs) and
   * keep one retry at `retryAt`, replacing any pending one. The job's regular slots do not move.
   */
  | { readonly action: 'postpone'; readonly runStatus: 'skipped'; readonly retryAt: Timestamp }
  /** A failed run: keep one retry at `retryAt`, replacing any pending one. */
  | { readonly action: 'retry_later'; readonly retryAt: Timestamp }
  /** A completed run: drop the pending retry, if any. */
  | { readonly action: 'done'; readonly retryCleared: boolean };

/**
 * The subject (Phase 1, apps/server scheduler). Probe delays, ported from NETWORK_PROBE_DELAYS:
 * 0, 3000, 5000, 10000, 20000, 30000 ms. Probe k is made delay[k] after probe k − 1's answer (the
 * first, delay 0, at the gate's start); a probe that times out counts as not resolved. Any
 * resolved probe runs the job. After six unresolved probes the run is postponed with a retry
 * 60000 ms after `now`. A failed run also retries 60000 ms after `now`. Whether S§5.8's "probes at
 * 0/3/5/10/20/30 s" are delays (as ported) or offsets from the start is open (report).
 */
export type NetworkGate = (input: GateInput) => GateDecision;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface GateCase {
  readonly id: string;
  readonly what: string;
  readonly input: GateInput;
  readonly expected: GateDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
