// The exact arithmetic under the alert decisions: medians rounded half up, the MAD, timestamps.
import { describe, expect, it } from 'vitest';
import { medianAbsoluteDeviation, medianHalfUp, timestampMs } from '../../src/alerts/exact.ts';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

describe('medianHalfUp', () => {
  it('takes the middle value of an odd count, whatever the order', () => {
    expect(medianHalfUp([13900n, 11900n, 12500n])).toBe(12500n);
    expect(medianHalfUp([7n])).toBe(7n);
  });

  it('takes the exact mean of the two middle values of an even count', () => {
    expect(medianHalfUp([12999n, 13999n])).toBe(13499n);
    expect(medianHalfUp([1n, 2n, 4n, 100n])).toBe(3n);
  });

  it('rounds a half minor unit up, never down', () => {
    expect(medianHalfUp([12999n, 14000n])).toBe(13500n);
    expect(medianHalfUp([0n, 1n])).toBe(1n);
    expect(medianHalfUp([2n, 5n])).toBe(4n); // 3.5 → 4
    expect(medianHalfUp([2n, 4n])).toBe(3n); // 3 exactly
  });

  it('does not overflow on two amounts near 2^53', () => {
    expect(medianHalfUp([MAX, MAX - 1n])).toBe(MAX); // (2^54 − 3) / 2 = MAX − 0.5 → MAX
    expect(medianHalfUp([MAX, MAX])).toBe(MAX);
    expect(medianHalfUp([0n, MAX])).toBe((MAX + 1n) / 2n);
  });

  it('refuses no values and negative values', () => {
    expect(() => medianHalfUp([])).toThrow(RangeError);
    expect(() => medianHalfUp([1n, -1n])).toThrow(RangeError);
  });
});

describe('medianAbsoluteDeviation', () => {
  it('is zero for a constant series and for one value', () => {
    expect(medianAbsoluteDeviation([10000n, 10000n, 10000n])).toBe(0n);
    expect(medianAbsoluteDeviation([42n])).toBe(0n);
  });

  it('is the raw median of absolute deviations around the median', () => {
    // The corpus's noisy history: median 10000, deviations 0, 0, 0, 600, 600, 700, 700.
    const noisy = [10000n, 10600n, 9400n, 10000n, 10700n, 9300n, 10000n];
    expect(medianAbsoluteDeviation(noisy)).toBe(600n);
    // Even count: median (100 + 103 + 1) / 2 = 102; deviations 2, 1, 1, 98 → (1 + 2 + 1) / 2 = 2.
    expect(medianAbsoluteDeviation([100n, 103n, 101n, 200n])).toBe(2n);
  });
});

describe('timestampMs', () => {
  it('reads the fixed UTC form with milliseconds', () => {
    expect(timestampMs('2026-11-17T09:00:00.001Z', 'at')).toBe(Date.UTC(2026, 10, 17, 9, 0, 0, 1));
  });

  it('refuses other forms', () => {
    expect(() => timestampMs('2026-11-17T09:00:00Z', 'at')).toThrow(RangeError);
    expect(() => timestampMs('2026-11-17T09:00:00.000+01:00', 'at')).toThrow(RangeError);
    expect(() => timestampMs('2026-13-45T09:00:00.000Z', 'at')).toThrow(RangeError);
  });
});
