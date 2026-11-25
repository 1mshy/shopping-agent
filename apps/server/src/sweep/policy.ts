// The sweep's numbers and the small pure mappings it applies (S§5.8 "Per-listing scheduling",
// S§2.10, S§4.1 listing_check). Every number the spec leaves open is named here, once.

import {
  MinorUnitCurrency,
  type Money,
  READ_FAILURE_CAUSES,
  type ReadFailureCause,
} from '@agentic-dasher/shared';
import type { ListingReadResult } from '@agentic-dasher/sources';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** S§5.8: a tracked listing is read every 30 minutes unless the setting says otherwise. */
export const DEFAULT_CHECK_INTERVAL_MS = 30 * MINUTE;
/** S§5.8: the floor of the interval, whatever the setting says. */
export const MIN_CHECK_INTERVAL_MS = 5 * MINUTE;

/**
 * Consecutive failed reads back off on this schedule (the delay after the n-th failure in a row is
 * entry n − 1, the last entry for every further one), never sooner than the check interval. Named
 * ERROR_BACKOFF_MS; the spec leaves the numbers open (S§5.8 "per-host back-off"). The fetcher's
 * own playbook back-off (5 min … 6 h per rung, S§5.1) and Retry-After come on top: a host that is
 * closed is not asked again before it opens.
 */
export const ERROR_BACKOFF_MS = [30 * MINUTE, 1 * HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR] as const;

/** "After 3+ consecutive errors over a day, re-discovery is queued (at most daily)" (S§5.8). */
export const REDISCOVERY_AFTER_ERRORS = 3;
export const REDISCOVERY_ERROR_SPAN_MS = DAY;
/** A watch's lookup is re-queued only when `lookup_queued_at` is at least this old. */
export const REDISCOVERY_MIN_GAP_MS = DAY;

/**
 * The history an alert evaluation reads: a listing's observations of the last 30 days, at most the
 * 500 most recent (about 10 days at the default interval). It is the MAD window of
 * evaluatePriceAlert (the pure function leaves the window to its caller) and the "recent prices"
 * of the reference (S§5.8).
 */
export const HISTORY_WINDOW_MS = 30 * DAY;
export const HISTORY_MAX_READS = 500;

/** One listing's check: the read and all its requests end by then. */
export const CHECK_DEADLINE_MS = 45_000;
/** Requests one check may make (a Shopify read takes up to three, the page one more). */
export const CHECK_REQUEST_BUDGET = 8;
/**
 * A listing being checked is claimed by moving its next_check_at this far ahead, so another sweep
 * (another process) does not read it at the same time; a check that dies leaves it due again then.
 */
export const CLAIM_LEASE_MS = CHECK_DEADLINE_MS + MINUTE;
/** A read refused before it reached the store (host closed with no known reopening, budget). */
export const DEFERRED_RETRY_MS = MIN_CHECK_INTERVAL_MS;

/** S§5.8 "The default rule is a 5% drop." */
export const DEFAULT_DROP_BASIS_POINTS = 500;

/** The check interval from the setting, floored (S§5.8). */
export function checkInterval(setting: number | null | undefined): number {
  if (setting === null || setting === undefined || !Number.isFinite(setting)) {
    return DEFAULT_CHECK_INTERVAL_MS;
  }
  return Math.max(MIN_CHECK_INTERVAL_MS, Math.floor(setting));
}

/** The delay before the next check after `errors` failed reads in a row (errors ≥ 1). */
export function errorBackoff(errors: number, intervalMs: number): number {
  const i = Math.min(Math.max(errors, 1), ERROR_BACKOFF_MS.length) - 1;
  return Math.max(intervalMs, ERROR_BACKOFF_MS[i] as number);
}

/**
 * Why a failed ladder read failed, as a `READ_FAILURE_CAUSES` value (listing_check.last_error,
 * store.last_error):
 * - `fetch_failed`: the page fetch's outcome kind (not_found, wall, rate_limited, …); a fetch that
 *   ended `ok` without a response is `empty`.
 * - `multiple_prices`: `multiple_prices`.
 * - `no_price`, `unreadable_price`, `variant_not_found`, `converted_currency`,
 *   `no_structured_data`: `no_price` — the page was there and gave no usable price for the listing
 *   asked. The exact reason and detail stay in the failed read's log record.
 */
export function failureCause(
  result: Extract<ListingReadResult, { kind: 'failed' }>,
): ReadFailureCause {
  switch (result.reason) {
    case 'fetch_failed': {
      const kind = result.fetch?.kind;
      if (kind === undefined) return 'network_error';
      return kind === 'ok' ? 'empty' : kind;
    }
    case 'multiple_prices':
      return 'multiple_prices';
    case 'no_price':
    case 'unreadable_price':
    case 'variant_not_found':
    case 'converted_currency':
    case 'no_structured_data':
      return 'no_price';
  }
}

export function isReadFailureCause(value: unknown): value is ReadFailureCause {
  return typeof value === 'string' && (READ_FAILURE_CAUSES as readonly string[]).includes(value);
}

/** The alert rules of one watch, read from `watch.rules_json`. */
export interface WatchRules {
  /** Null: no drop rule. */
  readonly dropBasisPoints: number | null;
  /** Null: no target. Only ever compared in its own currency. */
  readonly targetPrice: Money | null;
}

/**
 * Reads `watch.rules_json` (S§4.2: target_price, drop_pct, restock). Accepted keys:
 * - `dropBasisPoints` (integer, 1-9999) or `dropPct` (a percentage, 0 < p < 100, kept to two
 *   decimals: 5 → 500 bp). A key set to null means "no drop rule"; neither key means the default
 *   5% rule (S§5.8).
 * - `targetPrice`: Money (`{ amountMinor, currency }`); anything else is no target.
 * The restock rule is `watch.restock_enabled_at`, not a key here. A malformed value is no rule,
 * never a guess.
 */
export function readWatchRules(rules: unknown): WatchRules {
  const r = (typeof rules === 'object' && rules !== null ? rules : {}) as Record<string, unknown>;
  let dropBasisPoints: number | null = DEFAULT_DROP_BASIS_POINTS;
  if ('dropBasisPoints' in r) {
    const bp = r.dropBasisPoints;
    dropBasisPoints =
      typeof bp === 'number' && Number.isSafeInteger(bp) && bp > 0 && bp < 10_000 ? bp : null;
  } else if ('dropPct' in r) {
    const pct = r.dropPct;
    const bp = typeof pct === 'number' && Number.isFinite(pct) ? Math.round(pct * 100) : null;
    dropBasisPoints = bp !== null && bp > 0 && bp < 10_000 ? bp : null;
  }
  return { dropBasisPoints, targetPrice: moneyOf(r.targetPrice) };
}

function moneyOf(value: unknown): Money | null {
  if (typeof value !== 'object' || value === null) return null;
  const { amountMinor, currency } = value as Record<string, unknown>;
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    return null;
  }
  const parsed = MinorUnitCurrency.safeParse(currency);
  return parsed.success ? { amountMinor, currency: parsed.data } : null;
}

/** The S§4 timestamp form: UTC, exactly three fractional digits. */
export function iso(ms: number): string {
  return new Date(Math.floor(ms)).toISOString();
}
