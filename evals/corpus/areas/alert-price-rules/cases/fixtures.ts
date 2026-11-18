// Builders for case data. Every value they return is plain data; nothing reads a clock.
import type { Money, ReadMethod, Rung } from '@agentic-dasher/shared';
import type { ObservedRead, PriceAlertWatch } from '../contract.ts';

export const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });

/** The evaluation instant of the drop cases: right after the second (confirming) read. */
export const NOW = '2026-11-17T09:05:00.000Z';
export const FIRST_READ_AT = '2026-11-17T09:00:00.000Z';
export const SECOND_READ_AT = '2026-11-17T09:05:00.000Z';

export function observed(
  observationId: number,
  observedAt: string,
  price: number,
  more: Partial<Omit<ObservedRead, 'kind' | 'observationId' | 'observedAt' | 'price'>> = {},
): ObservedRead {
  return {
    kind: 'observation',
    observationId,
    observedAt,
    currency: 'CAD',
    price,
    availability: 'in',
    readPath: 'platform_json',
    rung: 'api',
    ...more,
  };
}

/**
 * One in-stock CAD observation a day at 09:00 from 2026-11-10 (ids from `firstId`), on one read
 * path. `minute` separates two histories read on the same days.
 */
export function daily(
  prices: readonly number[],
  firstId: number,
  readPath: ReadMethod = 'platform_json',
  rung: Rung = 'api',
  minute = '00',
): ObservedRead[] {
  return prices.map((price, i) =>
    observed(firstId + i, `2026-11-${String(10 + i)}T09:${minute}:00.000Z`, price, {
      readPath,
      rung,
    }),
  );
}

/** Reads ordered oldest first (timestamps have one fixed width, so text order is time order). */
export function chronological(reads: readonly ObservedRead[]): ObservedRead[] {
  return [...reads].sort((a, b) => (a.observedAt < b.observedAt ? -1 : 1));
}

/** Seven flat reads at CA$100.00: MAD 0, so only the 1% floor (100 minor units) applies. */
export const FLAT_100 = daily([10000, 10000, 10000, 10000, 10000, 10000, 10000], 101);

/**
 * Seven noisy reads around CA$100.00. Median 10000; absolute deviations 0, 600, 600, 0, 700, 700,
 * 0, sorted 0, 0, 0, 600, 600, 700, 700: MAD 600, so 3 MAD = 1800.
 */
export const NOISY_100 = daily([10000, 10600, 9400, 10000, 10700, 9300, 10000], 101);

/** Two reads at the same price on the history's read path: the first and its confirmation. */
export function confirmedPair(
  price: number,
  readPath: ReadMethod = 'platform_json',
): ObservedRead[] {
  const rung: Rung = readPath === 'platform_json' ? 'api' : 'http';
  return [
    observed(201, FIRST_READ_AT, price, { readPath, rung }),
    observed(202, SECOND_READ_AT, price, { readPath, rung }),
  ];
}

export function watch(more: Partial<PriceAlertWatch>): PriceAlertWatch {
  return {
    currency: 'CAD',
    referencePrice: null,
    targetPrice: null,
    dropBasisPoints: null,
    cooldownSeconds: 43200,
    ...more,
  };
}
