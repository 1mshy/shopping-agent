// S§5.5 deal verdicts: tiers at their boundaries, the time-weighted median, the 14-, 35- and
// 90-day edges, price levels, staleness, stock, the cross-store form and the stream block.
import {
  type Availability,
  DEAL_VERDICTS,
  type ListingCurrency,
  StreamBlock,
} from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  type DealInput,
  type DealJudgement,
  type HistoryPoint,
  judgeDeal,
  type PeerPrice,
  STALE_AFTER_MS,
  toStreamVerdict,
} from '../../src/index.ts';

const NOW = '2026-11-25T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const MAX = Number.MAX_SAFE_INTEGER;

/** The instant `days` days (plus `ms`) before NOW. */
const ago = (days: number, ms = 0) => new Date(NOW_MS - days * DAY - ms).toISOString();

let nextId = 1;
function point(
  observedAt: string,
  effective: number | null,
  availability: Availability = 'in',
  currency: ListingCurrency = 'CAD',
): HistoryPoint {
  return { id: nextId++, observedAt, effective, currency, availability };
}

/** One read a day at `price`, on days `from`, from - 1, ..., to + 1 before NOW. */
function daily(from: number, to: number, price: number, currency: ListingCurrency = 'CAD') {
  const points: HistoryPoint[] = [];
  for (let d = from; d > to; d--) points.push(point(ago(d), price, 'in', currency));
  return points;
}

const LISTING = {
  listingId: 1,
  storeId: 10,
  currency: 'CAD',
  condition: 'new',
  market: 'CA',
} as const;

function judge(
  history: readonly HistoryPoint[],
  peers: readonly PeerPrice[] = [],
  listing: DealInput['listing'] = LISTING,
): DealJudgement {
  const result = judgeDeal({ now: NOW, listing, history, peers });
  if (!result.ok) throw new Error(`refused: ${result.refusal.code} ${result.refusal.detail}`);
  return result.value;
}

/**
 * Ninety days of daily reads in three 30-day steps, A then B then C, and today's read at NOW
 * (zero weight, so today's price moves without moving the median). With A = 12000, B = 10000,
 * C = 11000 each price holds 30 days: the time-weighted median is 11000, the lowest 10000.
 */
function threeSteps(
  today: number,
  a = 12000,
  b = 10000,
  c = 11000,
  currency: ListingCurrency = 'CAD',
) {
  const history = [
    ...daily(90, 60, a, currency),
    ...daily(60, 30, b, currency),
    ...daily(30, 0, c, currency),
  ];
  const current = point(NOW, today, 'in', currency);
  return { history: [...history, current], current, firstB: history[30] as HistoryPoint };
}

function peer(
  storeId: number,
  effective: number | null,
  overrides: Partial<PeerPrice> = {},
): PeerPrice {
  const id = nextId++;
  return {
    listingId: 1000 + id,
    storeId,
    observationId: id,
    observedAt: ago(0, 3_600_000),
    effective,
    currency: 'CAD',
    condition: 'new',
    market: 'CA',
    availability: 'in',
    ...overrides,
  };
}

describe('history tiers at their boundaries (90 days, median 11000, lowest 10000)', () => {
  it('Lowest seen: at or under the lowest recorded price, with ≥35 days of history', () => {
    for (const today of [10000, 9999, 0]) {
      const { history, current, firstB } = threeSteps(today);
      const v = judge(history);
      expect(v.label).toBe('lowest_seen');
      expect(v.lowestRecorded).toEqual({
        observationId: firstB.id,
        price: { amountMinor: 10000, currency: 'CAD' },
      });
      expect(v.restsOn).toEqual([firstB.id, current.id]);
    }
    expect(judge(threeSteps(10001).history).label).toBe('good_price');
  });

  it('Good price: within 5% of the lowest recorded (inclusive)', () => {
    expect(judge(threeSteps(10500).history).label).toBe('good_price');
    expect(judge(threeSteps(10501).history).label).toBe('typical');
  });

  it('Good price: ≥10% under the 90-day time-weighted median (inclusive)', () => {
    // A lowest of 5000 long ago puts the 5% arm out of reach; the median stays 11000.
    const old = point(ago(200), 5000);
    const at = (today: number) => judge([old, ...threeSteps(today).history]);
    expect(at(9900).label).toBe('good_price');
    expect(at(9900).median90d).toEqual({ amountMinor: 11000, currency: 'CAD' });
    expect(at(9901).label).toBe('typical');
  });

  it('High: at least 10% over the 90-day time-weighted median; Typical below that', () => {
    expect(judge(threeSteps(12100).history).label).toBe('high');
    expect(judge(threeSteps(12099).history).label).toBe('typical');
    expect(judge(threeSteps(11000).history).label).toBe('typical');
  });

  it('rests a median-based tier on today and every observation with weight in the window', () => {
    const { history, current } = threeSteps(12100);
    const v = judge(history);
    expect(v.restsOn).toContain(current.id);
    expect(v.restsOn).toHaveLength(90 + 1);
    expect(v.unjudged).toEqual([]);
  });

  it('carries integers only: minor units with their currency, basis points, counts, ids', () => {
    const v = judge(threeSteps(10500).history);
    expect(v).toMatchObject({
      listingId: 1,
      today: { price: { amountMinor: 10500, currency: 'CAD' }, observedAt: NOW },
      daysOfHistory: 90,
      priceLevels90d: 4,
      median90d: { amountMinor: 11000, currency: 'CAD' },
      // 10000 held 30 of 90 days; nothing else is at or below 10500.
      shareAtOrBelow90dBp: 3334,
    });
  });
});

describe('the time-weighted median', () => {
  it('weights each price by how long it held, not by how often it was read', () => {
    // 200 read weekly for 50 days (8 reads), 100 read daily for 40 days (40 reads): by count the
    // median would be 100; by time 200 held 50 of 90 days.
    const weekly: HistoryPoint[] = [];
    for (let d = 90; d > 40; d -= 7) weekly.push(point(ago(d), 200));
    const v = judge([...weekly, ...daily(40, 0, 100), point(NOW, 100)]);
    expect(v.median90d).toEqual({ amountMinor: 200, currency: 'CAD' });
  });

  it('is the mean of the two prices that split the time exactly in half, rounded half up', () => {
    expect(judge([...daily(90, 45, 100), ...daily(45, 0, 200), point(NOW, 200)]).median90d).toEqual(
      { amountMinor: 150, currency: 'CAD' },
    );
    expect(judge([...daily(90, 45, 101), ...daily(45, 0, 200), point(NOW, 200)]).median90d).toEqual(
      { amountMinor: 151, currency: 'CAD' },
    );
  });

  it('compares with the exact median, never the rounded one', () => {
    // 10001 and 10000 split the window: the exact median is 10000.5 (shown 10001). 90% of it is
    // 9000.45, so 9000 is ≥10% under and 9001 is not. With the rounded 10001 it would be 9000.9.
    const old = point(ago(300), 1000);
    const steps = [...daily(90, 45, 10001), ...daily(45, 0, 10000)];
    const v = (today: number) => judge([old, ...steps, point(NOW, today)]);
    expect(v(9000).median90d).toEqual({ amountMinor: 10001, currency: 'CAD' });
    expect(v(9000).label).toBe('good_price');
    expect(v(9001).label).toBe('typical');
  });

  it('runs the last observation to now', () => {
    const only = point(ago(3), 4200);
    const v = judge([only]);
    expect(v.today).toMatchObject({ observationId: only.id, price: { amountMinor: 4200 } });
    expect(v.median90d).toEqual({ amountMinor: 4200, currency: 'CAD' });
    expect(v.shareAtOrBelow90dBp).toBe(10_000);
    expect(v.daysOfHistory).toBe(3);
  });

  it('counts a gap as time under the previous price up to 7 days, and no further', () => {
    expect(STALE_AFTER_MS).toBe(7 * DAY);
    // 100 read 30 days ago, nothing until 200 ten days ago: 100 counts 7 days, 200 counts 10.
    const gap = judge([point(ago(30), 100), ...daily(10, 0, 200), point(NOW, 200)]);
    expect(gap.median90d).toEqual({ amountMinor: 200, currency: 'CAD' });
    expect(gap.daysOfHistory).toBe(17);
    // A gap of exactly 7 days counts in full: 100 and 200 then hold 7 days each.
    const full = judge([point(ago(14), 100), ...daily(7, 0, 200), point(NOW, 200)]);
    expect(full.daysOfHistory).toBe(14);
    expect(full.median90d).toEqual({ amountMinor: 150, currency: 'CAD' });
    // One millisecond more and 100 still counts 7 days, not 7 days and 1 ms: the halves stay equal.
    const over = judge([point(ago(14, 1), 100), ...daily(7, 0, 200), point(NOW, 200)]);
    expect(over.median90d).toEqual({ amountMinor: 150, currency: 'CAD' });
  });

  it('carries the price read before the window into it, unless it went stale first', () => {
    // 50000 read 92 days ago holds 2 days inside the window.
    const carried = judge([point(ago(92), 50000), ...daily(88, 0, 100), point(NOW, 100)]);
    expect(carried.priceLevels90d).toBe(2);
    expect(carried.shareAtOrBelow90dBp).toBe(9778); // 88 of 90 days at or below 100, rounded up
    // 1 read 100 days ago went stale 93 days ago: not in the window, still the lowest recorded.
    const stale = judge([point(ago(100), 1), ...daily(88, 0, 100), point(NOW, 100)]);
    expect(stale.priceLevels90d).toBe(1);
    expect(stale.shareAtOrBelow90dBp).toBe(10_000);
    expect(stale.lowestRecorded?.price.amountMinor).toBe(1);
  });

  it('counts an observation exactly 90 days old from the window start', () => {
    const v = judge([point(ago(90), 300), ...daily(60, 0, 100), point(NOW, 100)]);
    // 300 holds 90 → 83 days ago (stale after 7 days), 100 holds 60 days.
    expect(v.shareAtOrBelow90dBp).toBe(8956); // 60 / 67 = 0.895522…, rounded up
  });
});

describe('days of history, price levels and the 14- and 35-day edges', () => {
  // Reads 5 days apart (inside the 7-day bound); the first `ms` before NOW, at most 7 days before
  // the next one.
  const first35 = (ms: number) => [
    point(new Date(NOW_MS - ms).toISOString(), 12000),
    point(ago(30), 12000),
    point(ago(25), 12000),
    point(ago(20), 11000),
    point(ago(15), 11000),
    point(ago(10), 10500),
    point(ago(5), 10500),
    point(NOW, 10500),
  ];

  it('gives Lowest seen from exactly 35 days of history', () => {
    expect(judge(first35(35 * DAY)).daysOfHistory).toBe(35);
    expect(judge(first35(35 * DAY)).label).toBe('lowest_seen');
    expect(judge(first35(36 * DAY)).label).toBe('lowest_seen');
  });

  it('says Lowest seen could not be judged under 35 days, and gives Good price', () => {
    for (const ms of [35 * DAY - 1, 34 * DAY]) {
      const v = judge(first35(ms));
      expect(v.daysOfHistory).toBe(34);
      expect(v.label).toBe('good_price');
      expect(v.unjudged).toEqual([{ tier: 'lowest_seen', reason: 'history_under_35_days' }]);
    }
  });

  it('judges history from exactly 14 days, and uses the cross-store form under 14', () => {
    const fourteen = [
      point(ago(14), 12000),
      point(ago(9), 11000),
      point(ago(4), 10500),
      point(NOW, 10500),
    ];
    expect(judge(fourteen).daysOfHistory).toBe(14);
    expect(judge(fourteen).label).toBe('good_price');

    for (const first of [ago(14, -1), ago(13)]) {
      const short = [
        point(first, 12000),
        point(ago(9), 11000),
        point(ago(4), 10500),
        point(NOW, 10500),
      ];
      const v = judge(short);
      expect(v.daysOfHistory).toBe(13);
      expect(v.label).toBeNull();
      expect(v.unjudged).toEqual([
        { tier: 'lowest_seen', reason: 'history_under_14_days' },
        { tier: 'good_price', reason: 'history_under_14_days' },
        { tier: 'typical', reason: 'history_under_14_days' },
        { tier: 'high', reason: 'history_under_14_days' },
        { tier: 'cheapest_of_n', reason: 'no_peers' },
      ]);
      expect(judge(short, [peer(20, 11000)]).label).toBe('cheapest_of_n');
    }
  });

  it('needs three price levels in the window; today’s price is one of them', () => {
    const two = [...daily(40, 20, 12000), ...daily(20, 0, 11000)];
    const twoLevels = judge([...two, point(NOW, 12000)]);
    expect(twoLevels.priceLevels90d).toBe(2);
    expect(twoLevels.label).toBeNull();
    expect(twoLevels.unjudged[0]).toEqual({
      tier: 'lowest_seen',
      reason: 'fewer_than_3_price_levels',
    });

    const threeLevels = judge([...two, point(NOW, 10000)]);
    expect(threeLevels.priceLevels90d).toBe(3);
    expect(threeLevels.label).toBe('lowest_seen');
  });

  it('counts levels exactly: one minor unit apart is another level', () => {
    const v = judge([...daily(40, 20, 10001), ...daily(20, 0, 10000), point(NOW, 9999)]);
    expect(v.priceLevels90d).toBe(3);
    expect(v.label).toBe('lowest_seen');
  });

  it('treats a constant history as too few levels, whatever its length', () => {
    const v = judge([...daily(90, 0, 5000), point(NOW, 5000)]);
    expect(v.daysOfHistory).toBe(90);
    expect(v.priceLevels90d).toBe(1);
    expect(v.label).toBeNull();
    expect(v.shareAtOrBelow90dBp).toBe(10_000);
    expect(judge([...daily(90, 0, 5000), point(NOW, 5000)], [peer(20, 6000)]).label).toBe(
      'cheapest_of_n',
    );
  });

  it('judges a single observation on nothing but the share, which needs time', () => {
    const atNow = judge([point(NOW, 100)]);
    expect(atNow).toMatchObject({
      label: null,
      daysOfHistory: 0,
      priceLevels90d: 1,
      median90d: null,
      shareAtOrBelow90dBp: null,
    });
    const hourOld = judge([point(ago(0, 3_600_000), 100)]);
    expect(hourOld.shareAtOrBelow90dBp).toBe(10_000);
  });
});

describe('stock, staleness and the share of 90 days', () => {
  it('leaves out-of-stock time out of the weights and out of the days of history', () => {
    const v = judge([
      point(ago(30), 10000),
      point(ago(25), 10000),
      point(ago(20), 1, 'out'), // a price read while out of stock is no price anyone could pay
      point(ago(15), 9000),
      point(ago(10), 9000),
      point(ago(5), 9000),
      point(NOW, 9000),
    ]);
    expect(v.daysOfHistory).toBe(25);
    expect(v.median90d).toEqual({ amountMinor: 9000, currency: 'CAD' });
    expect(v.lowestRecorded?.price.amountMinor).toBe(9000);
    expect(v.priceLevels90d).toBe(2);
    expect(v.shareAtOrBelow90dBp).toBe(6000);
  });

  it('counts a price read with unknown stock as a price', () => {
    const v = judge([point(ago(10), 500, 'unknown'), point(NOW, 600)]);
    expect(v.median90d).toEqual({ amountMinor: 500, currency: 'CAD' });
    expect(v.shareAtOrBelow90dBp).toBe(10_000);
  });

  it('judges nothing when today’s read is out of stock, and says why for every tier', () => {
    const v = judge([...daily(60, 0, 100), point(NOW, null, 'out')], [peer(20, 200)]);
    expect(v).toMatchObject({ label: null, today: null, shareAtOrBelow90dBp: null });
    expect(v.unjudged).toEqual(
      DEAL_VERDICTS.map((tier) => ({ tier, reason: 'current_out_of_stock' })),
    );
  });

  it('judges nothing when the last read is older than 7 days', () => {
    const v = judge([...daily(60, 8, 100), point(ago(7, 1), 90)]);
    expect(v.today).toBeNull();
    expect(v.unjudged[0]).toEqual({ tier: 'lowest_seen', reason: 'current_stale' });
    expect(judge([...daily(60, 8, 100), point(ago(7), 90)]).today).not.toBeNull();
  });

  it('judges nothing when the last read established no currency', () => {
    const v = judge([...daily(60, 0, 100), point(NOW, null, 'in', 'unknown')]);
    expect(v.today).toBeNull();
    expect(v.unjudged[0]).toEqual({ tier: 'lowest_seen', reason: 'no_current_price' });
  });

  it('rounds the share up, so a deal is never overstated', () => {
    // 100, 200 and 300 each hold 30 days; today 100: 30 of 90 days at or below, 3333.3 → 3334.
    const v = judge([
      ...daily(90, 60, 100),
      ...daily(60, 30, 200),
      ...daily(30, 0, 300),
      point(NOW, 100),
    ]);
    expect(v.shareAtOrBelow90dBp).toBe(3334);
    expect(v.label).toBe('lowest_seen');
  });
});

describe('currencies and amounts', () => {
  it('works in zero- and three-decimal currencies', () => {
    const jpy = threeSteps(10500, 12000, 10000, 11000, 'JPY');
    expect(judge(jpy.history, [], { ...LISTING, currency: 'JPY' })).toMatchObject({
      label: 'good_price',
      today: { price: { amountMinor: 10500, currency: 'JPY' } },
    });
    const kwd = threeSteps(12100, 12000, 10000, 11000, 'KWD');
    expect(judge(kwd.history, [], { ...LISTING, currency: 'KWD' })).toMatchObject({
      label: 'high',
      median90d: { amountMinor: 11000, currency: 'KWD' },
    });
  });

  it('stays exact near 2^53', () => {
    const v = judge(threeSteps(MAX - 4, MAX - 2, MAX - 4, MAX - 3).history);
    expect(v.label).toBe('lowest_seen');
    expect(v.median90d?.amountMinor).toBe(MAX - 3);
    expect(judge(threeSteps(MAX, MAX - 2, MAX - 4, MAX - 3).history).label).toBe('good_price');
    // MAX is within 5% of MAX - 4; a low median far under it shows High stays exact too.
    expect(judge(threeSteps(MAX, 2, 1, 3).history).label).toBe('high');
  });

  it('never uses a struck-through price as a baseline', () => {
    const { history } = threeSteps(10501);
    const withClaims = history.map((h) => ({
      ...h,
      referenceClaimed: 99_999_999,
      sticker: 99_999_999,
    }));
    expect(judge(withClaims)).toEqual(judge(history));
  });
});

describe('the cross-store form: cheapest of N stores, X% under the median', () => {
  const short = () => [point(ago(3), 10000), point(NOW, 10000)];

  it('counts stores, takes the median of their prices and rounds X down', () => {
    const peers = [peer(20, 12000), peer(30, 11000)];
    const v = judge(short(), peers);
    expect(v.label).toBe('cheapest_of_n');
    // Median of 10000, 11000, 12000 is 11000: 1000 / 11000 = 9.0909% → 909 bp.
    expect(v.cheapestOfN).toEqual({
      storeCount: 3,
      underMedianBp: 909,
      median: { amountMinor: 11000, currency: 'CAD' },
      sharedLowestWith: 0,
    });
    expect(v.restsOn).toEqual([...v.restsOn].sort((a, b) => a - b));
    expect(v.restsOn).toEqual(expect.arrayContaining(peers.map((p) => p.observationId)));
  });

  it('includes its own price in the median and never overstates X with a rounded median', () => {
    // Two stores: the exact median is 10500.5 (shown 10501); X = 500.5 / 10500.5 = 4.766% → 476.
    const v = judge(short(), [peer(20, 11001)]);
    expect(v.cheapestOfN).toEqual({
      storeCount: 2,
      underMedianBp: 476,
      median: { amountMinor: 10501, currency: 'CAD' },
      sharedLowestWith: 0,
    });
  });

  it('counts a tie for cheapest as cheapest, at 0% under the median', () => {
    const v = judge(short(), [peer(20, 10000)]);
    expect(v.cheapestOfN).toMatchObject({ storeCount: 2, underMedianBp: 0, sharedLowestWith: 1 });
  });

  it('says not cheapest when one store is cheaper, its own store included', () => {
    expect(judge(short(), [peer(20, 9999)]).unjudged).toContainEqual({
      tier: 'cheapest_of_n',
      reason: 'not_cheapest',
    });
    expect(judge(short(), [peer(10, 9000), peer(20, 12000)]).label).toBeNull();
  });

  it('counts a store once, at its lowest listing', () => {
    const v = judge(short(), [peer(20, 12000), peer(20, 30000), peer(10, 15000)]);
    expect(v.cheapestOfN).toMatchObject({ storeCount: 2, median: { amountMinor: 11000 } });
  });

  it('leaves out peers that are out of stock, unpriced or older than 7 days, and counts them', () => {
    const v = judge(short(), [
      peer(20, 11000),
      peer(30, 5000, { availability: 'out' }),
      peer(40, null, { availability: 'out' }),
      peer(50, 5000, { observedAt: ago(7, 1) }),
    ]);
    expect(v.peersExcluded).toBe(3);
    expect(v.cheapestOfN).toMatchObject({ storeCount: 2 });
  });

  it('never calls an outlier price the cheapest (S§5.5 outlier rule)', () => {
    const peers = [peer(20, 10000), peer(30, 10000), peer(40, 10000)];
    const low = [point(ago(3), 5999), point(NOW, 5999)];
    expect(judge(low, peers).unjudged).toContainEqual({ tier: 'cheapest_of_n', reason: 'outlier' });
    const fine = [point(ago(3), 6000), point(NOW, 6000)];
    expect(judge(fine, peers).label).toBe('cheapest_of_n');
  });

  it('is not used when the history can be judged', () => {
    const v = judge(threeSteps(10501).history, [peer(20, 20000)]);
    expect(v.label).toBe('typical');
    expect(v.cheapestOfN).toBeNull();
  });
});

describe('refusals: mixed sets are refused, never filtered', () => {
  const base = (): DealInput => ({
    now: NOW,
    listing: LISTING,
    history: [point(ago(3), 100), point(NOW, 100)],
    peers: [],
  });
  const code = (input: DealInput) => {
    const r = judgeDeal(input);
    return r.ok ? 'ok' : r.refusal.code;
  };

  it('refuses observations or peers in another currency, condition or market', () => {
    expect(code({ ...base(), history: [...base().history, point(ago(1), 100, 'in', 'USD')] })).toBe(
      'mixed_currency',
    );
    expect(code({ ...base(), peers: [peer(20, 100, { currency: 'USD' })] })).toBe('mixed_currency');
    expect(code({ ...base(), peers: [peer(20, 100, { condition: 'refurbished' })] })).toBe(
      'mixed_condition',
    );
    expect(code({ ...base(), peers: [peer(20, 100, { market: 'US' })] })).toBe('mixed_market');
  });

  it('refuses an unknown currency, and comparing an unknown condition across listings', () => {
    expect(code({ ...base(), listing: { ...LISTING, currency: 'unknown' } })).toBe(
      'unknown_currency',
    );
    const unknown = { ...LISTING, condition: 'unknown' } as const;
    expect(code({ ...base(), listing: unknown })).toBe('ok');
    expect(
      code({ ...base(), listing: unknown, peers: [peer(20, 100, { condition: 'unknown' })] }),
    ).toBe('unknown_condition');
  });

  it('refuses an amount beside an unknown currency', () => {
    expect(
      code({ ...base(), history: [point(ago(2), 100, 'in', 'unknown'), point(NOW, 100)] }),
    ).toBe('amount_without_currency');
  });

  it('refuses observations after now, duplicate ids, bad timestamps and bad amounts', () => {
    expect(code({ ...base(), history: [point(ago(0, -1), 100)] })).toBe('observation_after_now');
    const p = point(ago(2), 100);
    expect(code({ ...base(), history: [p, { ...p }] })).toBe('duplicate_id');
    expect(code({ ...base(), now: '2026-11-25T12:00:00Z' })).toBe('invalid_timestamp');
    expect(code({ ...base(), history: [point('2026-11-24', 100)] })).toBe('invalid_timestamp');
    expect(code({ ...base(), history: [point(ago(1), -1)] })).toBe('invalid_amount');
    expect(code({ ...base(), history: [point(ago(1), 1.5)] })).toBe('invalid_amount');
    expect(code({ ...base(), peers: [peer(20, 100, { listingId: 1 })] })).toBe('duplicate_id');
    expect(code({ ...base(), peers: [peer(20, 100, { observedAt: ago(0, -1) })] })).toBe(
      'observation_after_now',
    );
  });

  it('judges no history at all as nothing, without refusing', () => {
    const v = judgeDeal({ ...base(), history: [] });
    expect(v.ok && v.value.label).toBeNull();
    expect(v.ok && v.value.unjudged[0]).toEqual({
      tier: 'lowest_seen',
      reason: 'no_current_price',
    });
  });
});

describe('the stream verdict block (S§5.6)', () => {
  const block = (v: DealJudgement) => ({
    type: 'verdict',
    listingId: v.listingId,
    relation: 'exact',
    decidedBy: 'identifier',
    group: 'exact',
    ...toStreamVerdict(v),
  });

  it('fills the deal and the share of 90 days, valid under the shared schema', () => {
    const tiered = judge(threeSteps(10500).history);
    expect(toStreamVerdict(tiered)).toEqual({
      deal: { label: 'good_price' },
      shareAtOrBelow90dBp: 3334,
    });
    expect(StreamBlock.safeParse(block(tiered)).success).toBe(true);

    const cheapest = judge([point(ago(3), 10000), point(NOW, 10000)], [peer(20, 12000)]);
    expect(toStreamVerdict(cheapest)).toEqual({
      deal: { label: 'cheapest_of_n', storeCount: 2, underMedianBp: 909 },
      shareAtOrBelow90dBp: 10_000,
    });
    expect(StreamBlock.safeParse(block(cheapest)).success).toBe(true);

    const none = judge([point(NOW, 100)]);
    expect(toStreamVerdict(none)).toEqual({ deal: null, shareAtOrBelow90dBp: null });
    expect(StreamBlock.safeParse(block(none)).success).toBe(true);
  });
});
