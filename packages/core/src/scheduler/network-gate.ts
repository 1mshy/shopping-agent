// The DNS gate and the 60 s retry (S§5.8 Scheduler: network-dependent jobs wait on a DNS gate,
// then retry in 60 s without moving the cadence; S§2 invariant 12 "work waits for the network, and
// nothing is silently dropped"). Pure: the probes so far come in, the next step goes out. The
// corpus area `scheduler-network-gate` is its definition of done.
import type { JobRunStatus, Timestamp } from '@agentic-dasher/shared';

/**
 * The delays slept before each probe, ported as delays between probes (settled by the orchestrator
 * 2026-11-23): with answers arriving at once the probes fall at 0, 3, 8, 18, 38 and 68 s.
 */
export const NETWORK_PROBE_DELAYS_MS: readonly number[] = [0, 3_000, 5_000, 10_000, 20_000, 30_000];

/** How long one DNS probe may take before it counts as not resolved (predecessor: 5 s). */
export const NETWORK_PROBE_TIMEOUT_MS = 5_000;

/** The one-off retry after a postponed or failed run, from the moment it was decided. */
export const RETRY_DELAY_MS = 60_000;

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
      /** The job's pending one-off retry, if any. */
      readonly pendingRetryAt: Timestamp | null;
    }
  | {
      readonly kind: 'run_ended';
      readonly now: Timestamp;
      readonly status: Extract<JobRunStatus, 'completed' | 'failed'>;
      readonly pendingRetryAt: Timestamp | null;
    };

export type GateDecision =
  /** Make the next probe at `at` (at once when `at` has passed). */
  | { readonly action: 'probe'; readonly at: Timestamp }
  /** The network is back: run the job now. */
  | { readonly action: 'run' }
  /** No network: record the run as skipped and keep one retry at `retryAt`, replacing any other. */
  | { readonly action: 'postpone'; readonly runStatus: 'skipped'; readonly retryAt: Timestamp }
  /** A failed run: keep one retry at `retryAt`, replacing any other. */
  | { readonly action: 'retry_later'; readonly retryAt: Timestamp }
  /** A completed run: drop the pending retry, if any. */
  | { readonly action: 'done'; readonly retryCleared: boolean };

function ms(at: Timestamp): number {
  const value = Date.parse(at);
  if (Number.isNaN(value)) throw new RangeError(`not a timestamp: ${at}`);
  return value;
}

function iso(value: number): Timestamp {
  return new Date(value).toISOString();
}

/**
 * Probe k is made `NETWORK_PROBE_DELAYS_MS[k]` after probe k − 1's answer (the first at the gate's
 * start); a resolved probe runs the job; after the last unresolved probe the run is postponed, with
 * a retry `RETRY_DELAY_MS` after `now`. When a run ends, a failure keeps a retry `RETRY_DELAY_MS`
 * after `now` and a completion drops the pending one.
 */
export function networkGate(input: GateInput): GateDecision {
  if (input.kind === 'run_ended') {
    if (input.status === 'failed') {
      return { action: 'retry_later', retryAt: iso(ms(input.now) + RETRY_DELAY_MS) };
    }
    return { action: 'done', retryCleared: input.pendingRetryAt !== null };
  }
  const last = input.probes[input.probes.length - 1];
  if (last?.resolved) return { action: 'run' };
  const delay = NETWORK_PROBE_DELAYS_MS[input.probes.length];
  if (delay === undefined) {
    return {
      action: 'postpone',
      runStatus: 'skipped',
      retryAt: iso(ms(input.now) + RETRY_DELAY_MS),
    };
  }
  const from = last ? ms(last.at) : ms(input.gateStartedAt);
  return { action: 'probe', at: iso(from + delay) };
}
