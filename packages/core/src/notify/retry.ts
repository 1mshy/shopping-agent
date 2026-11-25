// The notification retry policy (S§5.11 "transport errors and 408/425/429/5xx retry at 2/5/15 s
// and honour Retry-After; a delay over 30 s defers to the next outbox pass; auth and payload errors
// fail at once"). Pure decisions for one delivery (one event through one channel): what to do
// after an attempt, and whether a deferred delivery is due. The corpus area `notify-retry` is its
// definition of done. Channels are independent by construction: no input names another channel.
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

/** The base waits before the first, second and third retry within one pass (predecessor). */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

/** A wait longer than this is not slept inside the pass: the delivery waits for a later pass. */
export const MAX_IN_PASS_WAIT_MS = 30_000;

/** Attempts one pass makes for one delivery: the first and one per base delay. */
export const MAX_ATTEMPTS_PER_PASS = RETRY_DELAYS_MS.length + 1;

/** Transport errors and 408, 425, 429 and every 5xx are temporary (S§5.11). */
export function isRetryable(result: AttemptResult): boolean {
  if (result.kind === 'transport_error') return true;
  if (result.kind !== 'http_status') return false;
  const s = result.status;
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
}

const DELAY_SECONDS = /^\s*\d+(?:\.\d+)?\s*$/;

/**
 * The longest Retry-After that is honoured: one day. A provider's limit that resets later than
 * that is asked again after a day (and answers with its header again); a header that is absurd
 * (10^14 seconds) can neither park a delivery for years nor name a time that is not a date.
 */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Retry-After as milliseconds from `now`: delay seconds, or an HTTP date (RFC 9110 §10.2.3).
 * Unparsable or in the past counts as 0, as the predecessor did. Rounded up, so a retry is never
 * earlier than the provider asked, and never more than `MAX_RETRY_AFTER_MS`.
 */
export function retryAfterMs(header: string | null, now: Timestamp): number {
  if (header === null) return 0;
  const text = header.trim();
  if (text === '') return 0;
  if (DELAY_SECONDS.test(text)) return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(Number(text) * 1000));
  // An HTTP date names its weekday and a GMT time; Date.parse reads the IMF-fixdate form and the
  // two obsolete forms. A bare number or other text that Date.parse would guess at is refused.
  if (!/[A-Za-z]{3}/.test(text)) return 0;
  const until = Date.parse(text);
  if (Number.isNaN(until)) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(until - Date.parse(now))));
}

function iso(ms: number): Timestamp {
  return new Date(ms).toISOString();
}

/**
 * Base delays 2000, 5000, 15000 ms after the first, second and third failed attempt; a retryable
 * failure after the fourth attempt ends the pass (the delivery stays pending). A Retry-After makes
 * the wait max(base, Retry-After); a wait over 30000 ms defers instead, not before the provider's
 * deadline. Any other status, and an unclassified error, fails at once. A due check attempts when
 * `now ≥ nextAttemptAt`.
 */
export function decideDeliveryRetry(input: NotifyRetryInput): NotifyRetryDecision {
  if (input.kind === 'due') {
    return Date.parse(input.now) >= Date.parse(input.nextAttemptAt)
      ? { action: 'attempt' }
      : { action: 'not_due' };
  }
  const last = input.attempts.at(-1);
  if (last === undefined) throw new RangeError('after_attempt needs at least one attempt');
  if (last.kind === 'accepted') return { action: 'accepted', outcome: 'accepted' };
  if (!isRetryable(last)) return { action: 'fail', outcome: 'failed' };

  const providerMs = last.kind === 'http_status' ? retryAfterMs(last.retryAfter, input.now) : 0;
  const providerDeadline = providerMs > 0 ? iso(Date.parse(input.now) + providerMs) : null;
  const base = RETRY_DELAYS_MS[input.attempts.length - 1];
  if (base === undefined) {
    // The retry budget of this pass is spent: a later pass tries again, not before the provider's
    // deadline when it gave one.
    return { action: 'defer', outcome: 'retry', notBefore: providerDeadline };
  }
  const waitMs = Math.max(base, providerMs);
  if (waitMs > MAX_IN_PASS_WAIT_MS) {
    return { action: 'defer', outcome: 'retry', notBefore: providerDeadline };
  }
  return { action: 'wait_and_retry', outcome: 'retry', waitMs };
}
