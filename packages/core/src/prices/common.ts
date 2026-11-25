// Shared pieces of the S§5.5 price functions: the refusal type, input checks, exact medians and
// exact ratios. No float touches an amount: comparisons are cross-multiplied in BigInt, so every
// amount up to 2^53 - 1 is safe, and a displayed ratio is integer basis points with a stated
// rounding direction.
import {
  hasMinorUnits,
  ISO_MINOR_UNITS,
  type IsoCurrencyCode,
  type ListingCurrency,
  type MinorUnitCurrency,
} from '@agentic-dasher/shared';

export const PRICES_REFUSAL_CODES = [
  'invalid_amount', // An amount that is not a non-negative safe integer.
  'invalid_id', // An id that is not a positive safe integer.
  'invalid_timestamp', // Not `YYYY-MM-DDTHH:MM:SS.sssZ`, or not a real instant.
  'invalid_input', // A field outside its vocabulary (a shipping status, a market key, ...).
  'amount_without_currency', // An amount beside currency `unknown` (S§2.2: every amount is null).
  'shipping_status_mismatch', // An amount with conditional or unknown shipping, or none with known/estimated.
  'discount_without_sticker', // An automatic discount with no sticker to come off.
  'discount_exceeds_sticker', // An automatic discount larger than the sticker: a misread.
  'out_of_range', // A total beyond 2^53 - 1 minor units.
  'not_a_record', // The record the read makes is refused by the shared PriceObservation schema.
  'unknown_currency', // A comparison asked of prices whose currency is `unknown`.
  'unknown_condition', // A comparison across listings whose condition is `unknown`.
  'mixed_currency', // Prices in different currencies: never compared (S§2.2).
  'mixed_condition', // Prices of different conditions: never compared (S§5.5).
  'mixed_market', // Prices of different markets: never compared (S§5.5).
  'duplicate_id', // The same observation or listing twice.
  'observation_after_now', // An observation later than the `now` the caller passed.
  'not_in_group', // The listing asked about is not among the listings given.
  'different_listing', // A confirming read of another listing.
] as const;
export type PricesRefusalCode = (typeof PRICES_REFUSAL_CODES)[number];

export type PricesRefusal = { readonly code: PricesRefusalCode; readonly detail: string };
export type PricesResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: PricesRefusal };

export function ok<T>(value: T): PricesResult<T> {
  return { ok: true, value };
}

export function refuse(
  code: PricesRefusalCode,
  detail: string,
): { readonly ok: false; readonly refusal: PricesRefusal } {
  return { ok: false, refusal: { code, detail } };
}

/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

export function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Epoch milliseconds of a S§4 timestamp (UTC, exactly three fractional digits), or null when the
 * text is not one or names no real instant ("2026-02-30T…"). Reads no clock.
 */
export function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return null;
  return ms;
}

/** The currency as a minor-unit ISO code, or null for `unknown` and anything else. */
export function minorUnitCurrency(currency: ListingCurrency): MinorUnitCurrency | null {
  if (typeof currency !== 'string' || !Object.hasOwn(ISO_MINOR_UNITS, currency)) return null;
  const code = currency as IsoCurrencyCode;
  return hasMinorUnits(code) ? code : null;
}

/** A market key as the caller groups prices (the user's market country, "CA"). */
export function isMarket(value: unknown): value is string {
  return typeof value === 'string' && /^\S{1,64}$/.test(value);
}

/**
 * The exact median of a non-empty list of amounts, as twice its value so that it stays an
 * integer: the middle value doubled for an odd count, the sum of the two middle values for an even
 * count. Every comparison against a median uses this exact value, so no rounding can turn a price
 * into a deal or out of one.
 */
export function twiceMedian(values: readonly number[]): bigint {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new RangeError('the median of no prices');
  const upper = BigInt(sorted[Math.floor(n / 2)] as number);
  return n % 2 === 1 ? 2n * upper : BigInt(sorted[n / 2 - 1] as number) + upper;
}

/**
 * A median for display, in minor units: with an even count the mean of the two middle values
 * rounded half up to the minor unit (settled by the orchestrator, 2026-11-23). Takes the doubled
 * exact median of `twiceMedian` or `timeWeightedMedian`.
 */
export function medianHalfUp(twice: bigint): number {
  return Number((twice + 1n) / 2n);
}

/** The median of a non-empty list of amounts, shown as `medianHalfUp` rounds it. */
export function priceMedian(values: readonly number[]): number {
  return medianHalfUp(twiceMedian(values));
}

/**
 * `part / whole` in integer basis points, rounded down or up as asked. `whole` must be positive and
 * `part` non-negative; the result is at most 10,000 when `part` is at most `whole`.
 */
export function basisPoints(part: bigint, whole: bigint, rounding: 'down' | 'up'): number {
  const scaled = part * 10_000n;
  const bp = rounding === 'down' ? scaled / whole : (scaled + whole - 1n) / whole;
  return Number(bp);
}
