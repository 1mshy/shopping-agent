// S§5.5 outlier rule: with ≥4 exact listings in one currency, condition and market, a price under
// 60% of the median (50% with 2-3 listings) is an outlier; it needs a second read within 1%.
import { describe, expect, it } from 'vitest';
import {
  assessOutlier,
  assessOutliers,
  type ConfirmingRead,
  confirmOutlierRead,
  type ExactListingPrice,
  type OutlierDecision,
} from '../../src/index.ts';

const MAX = Number.MAX_SAFE_INTEGER;

let nextId = 1;
function listing(effective: number, overrides: Partial<ExactListingPrice> = {}): ExactListingPrice {
  const id = nextId++;
  return {
    listingId: id,
    observationId: 5000 + id,
    effective,
    currency: 'EUR',
    condition: 'new',
    market: 'DE',
    ...overrides,
  };
}

/** The decision for a candidate at `price` among listings at `others`. */
function decide(price: number, others: readonly number[]): OutlierDecision {
  const candidate = listing(price);
  const result = assessOutlier([...others.map((p) => listing(p)), candidate], candidate.listingId);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result.value;
}

describe('assessOutlier: thresholds by listing count', () => {
  it('judges nothing with one listing', () => {
    const v = decide(1, []);
    expect(v).toMatchObject({ outlier: false, listingCount: 1, rule: null, reason: null });
  });

  it('uses 50% of the median of the others with 2 listings', () => {
    expect(decide(4999, [10000])).toMatchObject({
      outlier: true,
      listingCount: 2,
      reason: 'under_50_percent_of_median',
      rule: {
        thresholdBp: 5000,
        median: { amountMinor: 10000, currency: 'EUR' },
        threshold: { amountMinor: 5000, currency: 'EUR' },
        priceOfMedianBp: 4999,
      },
    });
    expect(decide(5000, [10000])).toMatchObject({ outlier: false, reason: null });
  });

  it('uses 50% with 3 listings', () => {
    // Others 10000 and 12000: median 11000, half is 5500.
    expect(decide(5499, [10000, 12000]).outlier).toBe(true);
    expect(decide(5500, [10000, 12000]).outlier).toBe(false);
  });

  it('uses 60% from 4 listings', () => {
    expect(decide(5999, [10000, 10000, 10000])).toMatchObject({
      outlier: true,
      listingCount: 4,
      reason: 'under_60_percent_of_median',
      rule: { thresholdBp: 6000, threshold: { amountMinor: 6000 } },
    });
    expect(decide(6000, [10000, 10000, 10000]).outlier).toBe(false);
  });

  it('uses 60% with 5 listings, the median of four others being the mean of the middle two', () => {
    // Others 100, 200, 300, 400: median 250, 60% is 150.
    expect(decide(149, [100, 200, 300, 400]).outlier).toBe(true);
    expect(decide(150, [100, 200, 300, 400]).outlier).toBe(false);
  });

  it('compares with the exact median and states the threshold a price must be under', () => {
    // Others' median is 10001.5 (shown 10002); 60% of it is 6000.9: 6000 is under, 6001 is not.
    const under = decide(6000, [10000, 10001, 10002, 10003]);
    expect(under).toMatchObject({
      outlier: true,
      rule: { median: { amountMinor: 10002 }, threshold: { amountMinor: 6001 } },
    });
    expect(decide(6001, [10000, 10001, 10002, 10003]).outlier).toBe(false);
  });

  it('leaves the candidate out of the median it is judged against', () => {
    // With the candidate in, the median of 4000 and 10000 would be 7000 and 4000 would pass.
    expect(decide(4000, [10000])).toMatchObject({
      outlier: true,
      rule: { median: { amountMinor: 10000 } },
    });
  });

  it('rests on the others’ observations and says which ones', () => {
    const a = listing(10000);
    const b = listing(10000);
    const c = listing(5000);
    const result = assessOutlier([a, b, c], c.listingId);
    expect(result.ok && result.value.rule?.medianOf).toEqual([a.observationId, b.observationId]);
    expect(result.ok && result.value.observationId).toBe(c.observationId);
  });

  it('never flags anything against a median of zero', () => {
    expect(decide(0, [0, 0, 0])).toMatchObject({ outlier: false, rule: { priceOfMedianBp: null } });
  });

  it('rounds the price’s share of the median up, so the gap is never overstated', () => {
    // 1 of 3 is 3333.3 bp: shown 3334.
    expect(decide(1, [3]).rule?.priceOfMedianBp).toBe(3334);
  });

  it('stays exact near 2^53', () => {
    expect(decide(MAX, [MAX, MAX, MAX]).outlier).toBe(false);
    // 60% of MAX rounded up is 5404319552844595 (MAX × 6 / 10 = 5404319552844594.6).
    const low = decide(5404319552844594, [MAX, MAX, MAX]);
    expect(low).toMatchObject({
      outlier: true,
      rule: { threshold: { amountMinor: 5404319552844595 } },
    });
    expect(decide(5404319552844595, [MAX, MAX, MAX]).outlier).toBe(false);
  });
});

describe('assessOutlier and assessOutliers: refusals', () => {
  const code = (listings: ExactListingPrice[], id: number) => {
    const r = assessOutlier(listings, id);
    return r.ok ? 'ok' : r.refusal.code;
  };

  it('refuses a set mixing currencies, conditions or markets', () => {
    const a = listing(100);
    expect(code([a, listing(100, { currency: 'USD' })], a.listingId)).toBe('mixed_currency');
    expect(code([a, listing(100, { condition: 'used_good' })], a.listingId)).toBe(
      'mixed_condition',
    );
    expect(code([a, listing(100, { market: 'AT' })], a.listingId)).toBe('mixed_market');
  });

  it('refuses unknown currency and unknown condition', () => {
    const u = listing(100, { currency: 'unknown' });
    expect(code([u], u.listingId)).toBe('unknown_currency');
    const c = listing(100, { condition: 'unknown' });
    expect(code([c, listing(100, { condition: 'unknown' })], c.listingId)).toBe(
      'unknown_condition',
    );
  });

  it('refuses duplicates, a candidate not in the set and bad amounts', () => {
    const a = listing(100);
    expect(code([a, a], a.listingId)).toBe('duplicate_id');
    expect(code([a], 999_999)).toBe('not_in_group');
    expect(code([listing(-1)], nextId - 1)).toBe('invalid_amount');
  });

  it('decides every listing of a set against the others', () => {
    const set = [listing(10000), listing(10000), listing(10000), listing(5999), listing(9000)];
    const result = assessOutliers(set);
    expect(result.ok && result.value.map((d) => d.outlier)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(assessOutliers([...set, listing(1, { currency: 'USD' })])).toMatchObject({
      ok: false,
      refusal: { code: 'mixed_currency' },
    });
  });
});

describe('confirmOutlierRead: a second read within 1%', () => {
  function read(id: number, effective: number | null, overrides: Partial<ConfirmingRead> = {}) {
    return {
      id,
      listingId: 7,
      observedAt: `2026-11-25T10:0${id}:00.000Z`,
      effective,
      currency: 'EUR',
      availability: 'in',
      readPath: 'json_ld',
      rung: 'http',
      ...overrides,
    } satisfies ConfirmingRead;
  }
  const confirm = (first: ConfirmingRead, second: ConfirmingRead) => {
    const r = confirmOutlierRead(first, second);
    if (!r.ok) throw new Error(r.refusal.code);
    return r.value;
  };

  it('confirms within 1% of the first read, inclusive, either way', () => {
    expect(confirm(read(1, 10000), read(2, 10100))).toEqual({
      confirmed: true,
      reason: 'within_1_percent',
      differenceMinor: 100,
      differenceBp: 100,
    });
    expect(confirm(read(1, 10000), read(2, 9900)).confirmed).toBe(true);
    expect(confirm(read(1, 10000), read(2, 10101))).toMatchObject({
      confirmed: false,
      reason: 'differs_by_more_than_1_percent',
      differenceMinor: 101,
      differenceBp: 101,
    });
    expect(confirm(read(1, 10000), read(2, 9899)).confirmed).toBe(false);
  });

  it('works in zero- and three-decimal currencies and near 2^53', () => {
    expect(
      confirm(read(1, 100, { currency: 'JPY' }), read(2, 101, { currency: 'JPY' })).confirmed,
    ).toBe(true);
    expect(
      confirm(read(1, 100, { currency: 'JPY' }), read(2, 102, { currency: 'JPY' })).confirmed,
    ).toBe(false);
    expect(
      confirm(read(1, 12345, { currency: 'KWD' }), read(2, 12468, { currency: 'KWD' })).confirmed,
    ).toBe(true);
    expect(
      confirm(read(1, 12345, { currency: 'KWD' }), read(2, 12469, { currency: 'KWD' })).confirmed,
    ).toBe(false);
    // 1% of MAX is 90071992547409.91: a difference of 90071992547409 is within, ...410 is not.
    expect(confirm(read(1, MAX), read(2, MAX - 90071992547409)).confirmed).toBe(true);
    expect(confirm(read(1, MAX), read(2, MAX - 90071992547410)).confirmed).toBe(false);
  });

  it('does not confirm a read that is not later, on another path, unpriced or out of stock', () => {
    expect(confirm(read(2, 100), read(1, 100)).reason).toBe('not_after_first');
    expect(confirm(read(1, 100), read(2, 100, { readPath: 'microdata' })).reason).toBe(
      'different_read_path',
    );
    expect(confirm(read(1, 100), read(2, 100, { rung: 'browser' })).reason).toBe(
      'different_read_path',
    );
    expect(confirm(read(1, 100), read(2, null, { availability: 'out' })).reason).toBe('no_price');
    expect(confirm(read(1, 100), read(2, 100, { availability: 'out' })).reason).toBe(
      'not_in_stock',
    );
  });

  it('confirms a zero price only by another zero', () => {
    expect(confirm(read(1, 0), read(2, 0))).toMatchObject({ confirmed: true, differenceBp: null });
    expect(confirm(read(1, 0), read(2, 1)).confirmed).toBe(false);
  });

  it('refuses reads of different listings or currencies', () => {
    expect(confirmOutlierRead(read(1, 100), read(2, 100, { listingId: 8 }))).toMatchObject({
      ok: false,
      refusal: { code: 'different_listing' },
    });
    expect(confirmOutlierRead(read(1, 100), read(2, 100, { currency: 'USD' }))).toMatchObject({
      ok: false,
      refusal: { code: 'mixed_currency' },
    });
    expect(
      confirmOutlierRead(
        read(1, 100, { currency: 'unknown' }),
        read(2, null, { currency: 'unknown' }),
      ),
    ).toMatchObject({ ok: false, refusal: { code: 'unknown_currency' } });
  });
});
