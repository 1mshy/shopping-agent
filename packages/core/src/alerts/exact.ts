// Exact arithmetic and input checks shared by the alert decisions. Money is integer minor units;
// every product that could leave the safe-integer range is taken in BigInt, and nothing is ever a
// float or a rounded intermediate.
import type { Money, Timestamp } from '@agentic-dasher/shared';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Checks the fixed timestamp form (UTC, exactly three fractional digits, S§4) and returns its
 * epoch milliseconds. With one width, text order is time order.
 */
export function timestampMs(value: Timestamp, what: string): number {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    throw new RangeError(`${what}: ${String(value)} is not a UTC timestamp with milliseconds`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`${what}: ${value} is not a real instant`);
  return ms;
}

/** A price or other amount in minor units: a non-negative safe integer. */
export function assertMinor(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what}: ${String(value)} is not a non-negative safe integer`);
  }
}

/** A Money that stands for a price: a non-negative safe integer amount with a currency. */
export function assertPriceMoney(money: Money, what: string): void {
  if (money === null || typeof money !== 'object' || typeof money.currency !== 'string') {
    throw new TypeError(`${what}: not Money`);
  }
  assertMinor(money.amountMinor, `${what}.amountMinor`);
}

/** An integer count or duration: a non-negative safe integer. */
export function assertCount(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what}: ${String(value)} is not a non-negative safe integer`);
  }
}

const byValue = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The median of non-negative integers. With an even count it is the mean of the two middle values
 * rounded half up to the minor unit (settled by the orchestrator 2026-11-23): floor((a + b + 1) / 2),
 * exact in BigInt, so two amounts near 2^53 do not overflow when added.
 */
export function medianHalfUp(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError('the median of no values is undefined');
  const sorted = [...values].sort(byValue);
  for (const v of sorted) {
    if (v < 0n) throw new RangeError(`medianHalfUp: ${v} is negative`);
  }
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as bigint;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[mid - 1] as bigint;
  return (lower + upper + 1n) / 2n;
}

/**
 * The raw (unscaled) median absolute deviation around the median, both medians taken with
 * `medianHalfUp`. A constant series has a MAD of zero.
 */
export function medianAbsoluteDeviation(values: readonly bigint[]): bigint {
  const centre = medianHalfUp(values);
  return medianHalfUp(values.map((v) => (v >= centre ? v - centre : centre - v)));
}
