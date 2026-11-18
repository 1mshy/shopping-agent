// Contract of the notification retry policy (S§5.11 "transport errors and 408/425/429/5xx retry at
// 2/5/15 s and honour Retry-After; a delay over 30 s defers to the next outbox pass; auth and
// payload errors fail at once. Each channel returns a per-channel outcome, which gates the
// cooldown."; predecessor notify/__init__.py `dispatch`, `transient`, notify/base.py
// `DeliveryError`). Pure decisions for one delivery (one event through one channel): what to do
// after an attempt, and whether a deferred delivery is due. Channels are independent by
// construction: no input names another channel.
import type { DeliveryOutcome, Timestamp } from '@agentic-dasher/shared';

/** What one send attempt came back with, as the channel adapter classifies it. */
export type AttemptResult =
  | { readonly kind: 'accepted' }
  /** No HTTP answer: name resolution, connection or a timeout. */
  | { readonly kind: 'transport_error'; readonly cause: 'dns' | 'connect' | 'timeout' }
  /** The provider answered with a non-2xx status; `retryAfter` is the header text as received. */
  | { readonly kind: 'http_status'; readonly status: number; readonly retryAfter: string | null }
  /** An error the adapter could not classify as transport or as a status (no status attached). */
  | { readonly kind: 'unclassified_error' };

export type NotifyRetryInput =
  | {
      readonly kind: 'after_attempt';
      /** When the last attempt's result came back. */
      readonly now: Timestamp;
      /** The attempts of this outbox pass, oldest first; the last one just finished. */
      readonly attempts: readonly AttemptResult[];
    }
  | {
      readonly kind: 'due';
      readonly now: Timestamp;
      /** The pending delivery's next_attempt_at (S§4.4). */
      readonly nextAttemptAt: Timestamp;
    };

export type NotifyRetryDecision =
  | { readonly action: 'accepted'; readonly outcome: Extract<DeliveryOutcome, 'accepted'> }
  /** Retry within this pass after `waitMs`. */
  | {
      readonly action: 'wait_and_retry';
      readonly outcome: Extract<DeliveryOutcome, 'retry'>;
      readonly waitMs: number;
    }
  /**
   * Stop this pass and leave the delivery pending for a later outbox pass, not before `notBefore`
   * (the provider's Retry-After deadline), or at the next pass when null.
   */
  | {
      readonly action: 'defer';
      readonly outcome: Extract<DeliveryOutcome, 'retry'>;
      readonly notBefore: Timestamp | null;
    }
  | { readonly action: 'fail'; readonly outcome: Extract<DeliveryOutcome, 'failed'> }
  /** For `due`: attempt now. */
  | { readonly action: 'attempt' }
  /** For `due`: the provider's deadline has not come. */
  | { readonly action: 'not_due' };

/**
 * The subject (Phase 1, the outbox). Ported from `dispatch`: base delays 2000, 5000, 15000 ms after
 * the first, second and third failed attempt; a retryable failure after the fourth attempt ends the
 * pass. Retryable: transport errors and statuses 408, 425, 429 and 500-599. A Retry-After (delay
 * seconds, or an HTTP date relative to `now`; unparsable or negative counts as 0) makes the wait
 * max(base, Retry-After); a wait over 30000 ms defers instead. Any other status, and an
 * unclassified error, fails at once. A due check attempts when `now ≥ nextAttemptAt`.
 */
export type DecideDeliveryRetry = (input: NotifyRetryInput) => NotifyRetryDecision;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface NotifyRetryCase {
  readonly id: string;
  readonly what: string;
  readonly input: NotifyRetryInput;
  readonly expected: NotifyRetryDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
