// S§5.5 outlier rule. With ≥4 exact listings in one currency, condition and market, a price under
// 60% of their median (50% with 2-3 listings) is never ranked first, is shown separately with the
// reason, and needs a second read within 1% before it can alert. Pure: no clock, no I/O.
//
// Definitions:
// - The listing count n includes the candidate: it is the number of exact listings in the set.
//   n = 1 judges nothing; n = 2 or 3 uses 50%; n ≥ 4 uses 60%.
// - The median is that of the OTHER listings' prices (leave-one-out): a candidate never pulls the
//   baseline it is judged against towards itself, which matters most with 2 or 3 listings (a
//   misread 4000 beside a real 10000 would pass at 50% of their joint median of 7000).
// - "Under" is strict and exact: outlier ⇔ price × 10,000 < share × median, cross-multiplied in
//   BigInt against the exact median (a half unit with an even count of others). The median shown
//   is rounded half up (the settled rule); the threshold shown is the smallest amount that is not
//   an outlier, so "outlier ⇔ price < threshold" holds exactly.
// - Mixed currencies, conditions or markets are refused, never filtered; `unknown` currency and
//   `unknown` condition are never compared.
// - A confirming read is a later read of the same listing on the same read path and rung (the
//   settled rule for confirming reads), priced and not out of stock, whose effective price differs
//   from the first by at most 1% of the first: |second - first| × 100 ≤ first.
import type {
  Availability,
  Condition,
  ListingCurrency,
  Money,
  ReadMethod,
  Rung,
} from '@agentic-dasher/shared';
import {
  basisPoints,
  isAmount,
  isId,
  isMarket,
  medianHalfUp,
  minorUnitCurrency,
  ok,
  type PricesResult,
  refuse,
  timestampMs,
  twiceMedian,
} from './common.ts';

/** One exact listing's current price. */
export interface ExactListingPrice {
  readonly listingId: number;
  /** The observation the price was copied from. */
  readonly observationId: number;
  /** The effective price (S§5.8: the compared price is the effective price). */
  readonly effective: number;
  readonly currency: ListingCurrency;
  readonly condition: Condition;
  /** The market key the caller groups by (the user's market country). */
  readonly market: string;
}

export type OutlierReason = 'under_60_percent_of_median' | 'under_50_percent_of_median';

export interface OutlierRule {
  /** 6000 (60%) with ≥4 listings, 5000 (50%) with 2-3. */
  readonly thresholdBp: 6000 | 5000;
  /** The median of the other listings' prices, rounded half up for display. */
  readonly median: Money;
  /** The observations of the other listings, ascending. */
  readonly medianOf: readonly number[];
  /** The smallest price that is not an outlier: outlier ⇔ price < threshold. */
  readonly threshold: Money;
  /** The price as a share of the exact median, rounded up; null when the median is zero. */
  readonly priceOfMedianBp: number | null;
}

export interface OutlierDecision {
  readonly listingId: number;
  readonly observationId: number;
  readonly price: Money;
  /** Exact listings in the set, the candidate included. */
  readonly listingCount: number;
  readonly outlier: boolean;
  /** Null with a single listing: there is nothing to compare with. */
  readonly rule: OutlierRule | null;
  readonly reason: OutlierReason | null;
}

/** Checks a set of listings: one currency, condition and market, distinct ids, valid amounts. */
function checkSet(listings: readonly ExactListingPrice[]): PricesResult<Money['currency']> {
  const first = listings[0];
  if (first === undefined) return refuse('not_in_group', 'no listings');
  const listingIds = new Set<number>();
  const observationIds = new Set<number>();
  for (const l of listings) {
    if (l.currency !== first.currency) {
      return refuse('mixed_currency', `${l.currency} beside ${first.currency}: never compared`);
    }
    const currency = minorUnitCurrency(l.currency);
    if (currency === null) return refuse('unknown_currency', 'a price in an unknown currency');
    if (l.condition === 'unknown') {
      return refuse('unknown_condition', `listing ${l.listingId} has an unknown condition`);
    }
    if (l.condition !== first.condition) {
      return refuse('mixed_condition', `${l.condition} beside ${first.condition}: never compared`);
    }
    if (!isMarket(l.market))
      return refuse('invalid_input', `not a market key: ${String(l.market)}`);
    if (l.market !== first.market) {
      return refuse('mixed_market', `${l.market} beside ${first.market}: never compared`);
    }
    if (!isId(l.listingId) || !isId(l.observationId)) {
      return refuse('invalid_id', `listing ${l.listingId}, observation ${l.observationId}`);
    }
    if (listingIds.has(l.listingId) || observationIds.has(l.observationId)) {
      return refuse(
        'duplicate_id',
        `listing ${l.listingId} or observation ${l.observationId} twice`,
      );
    }
    listingIds.add(l.listingId);
    observationIds.add(l.observationId);
    if (!isAmount(l.effective)) {
      return refuse('invalid_amount', `listing ${l.listingId}: not an amount: ${l.effective}`);
    }
  }
  return ok(minorUnitCurrency(first.currency) as Money['currency']);
}

function decideOne(
  listings: readonly ExactListingPrice[],
  candidate: ExactListingPrice,
  currency: Money['currency'],
): OutlierDecision {
  const others = listings.filter((l) => l !== candidate);
  const base = {
    listingId: candidate.listingId,
    observationId: candidate.observationId,
    price: { amountMinor: candidate.effective, currency },
    listingCount: listings.length,
  };
  if (others.length === 0) return { ...base, outlier: false, rule: null, reason: null };
  const thresholdBp = listings.length >= 4 ? 6000 : 5000;
  const twice = twiceMedian(others.map((l) => l.effective));
  const price = BigInt(candidate.effective);
  // price < thresholdBp / 10,000 × twice / 2  ⇔  price × 20,000 < thresholdBp × twice.
  const scaledLimit = BigInt(thresholdBp) * twice;
  const outlier = price * 20_000n < scaledLimit;
  const threshold = (scaledLimit + 19_999n) / 20_000n; // ceil(scaledLimit / 20,000)
  return {
    ...base,
    outlier,
    rule: {
      thresholdBp,
      median: { amountMinor: medianHalfUp(twice), currency },
      medianOf: others.map((l) => l.observationId).sort((a, b) => a - b),
      threshold: { amountMinor: Number(threshold), currency },
      priceOfMedianBp: twice === 0n ? null : basisPoints(price * 2n, twice, 'up'),
    },
    reason: outlier
      ? thresholdBp === 6000
        ? 'under_60_percent_of_median'
        : 'under_50_percent_of_median'
      : null,
  };
}

/**
 * Whether one listing's price is an outlier among a set of exact listings that includes it, with
 * the median and threshold used. A set mixing currencies, conditions or markets is refused.
 */
export function assessOutlier(
  listings: readonly ExactListingPrice[],
  candidateListingId: number,
): PricesResult<OutlierDecision> {
  const checked = checkSet(listings);
  if (!checked.ok) return checked;
  const candidate = listings.find((l) => l.listingId === candidateListingId);
  if (candidate === undefined) {
    return refuse('not_in_group', `listing ${candidateListingId} is not among the listings given`);
  }
  return ok(decideOne(listings, candidate, checked.value));
}

/** `assessOutlier` for every listing of the set, in the order given. */
export function assessOutliers(
  listings: readonly ExactListingPrice[],
): PricesResult<readonly OutlierDecision[]> {
  const checked = checkSet(listings);
  if (!checked.ok) return checked;
  return ok(listings.map((l) => decideOne(listings, l, checked.value)));
}

/** A read of a listing, as `price_observation` stores it. */
export interface ConfirmingRead {
  readonly id: number;
  readonly listingId: number;
  readonly observedAt: string;
  readonly effective: number | null;
  readonly currency: ListingCurrency;
  readonly availability: Availability;
  readonly readPath: ReadMethod;
  readonly rung: Rung;
}

export type ConfirmationReason =
  | 'within_1_percent'
  | 'differs_by_more_than_1_percent'
  | 'not_after_first'
  | 'different_read_path'
  | 'no_price'
  | 'not_in_stock';

export interface OutlierConfirmation {
  readonly confirmed: boolean;
  readonly reason: ConfirmationReason;
  /** |second - first| in minor units; null when either read has no price. */
  readonly differenceMinor: number | null;
  /** The difference as a share of the first price, rounded up; null without a positive first price. */
  readonly differenceBp: number | null;
}

/**
 * Whether a second read confirms an outlier price: a later read of the same listing on the same
 * read path and rung, priced, not out of stock, within 1% of the first read (inclusive, exact).
 * Reads of different listings or currencies are refused.
 */
export function confirmOutlierRead(
  first: ConfirmingRead,
  second: ConfirmingRead,
): PricesResult<OutlierConfirmation> {
  if (first.listingId !== second.listingId) {
    return refuse('different_listing', `listing ${first.listingId} and ${second.listingId}`);
  }
  if (minorUnitCurrency(first.currency) === null || minorUnitCurrency(second.currency) === null) {
    return refuse('unknown_currency', 'a read in an unknown currency confirms nothing');
  }
  if (first.currency !== second.currency) {
    return refuse('mixed_currency', `${first.currency} and ${second.currency}: never compared`);
  }
  const firstAt = timestampMs(first.observedAt);
  const secondAt = timestampMs(second.observedAt);
  if (firstAt === null || secondAt === null) {
    return refuse('invalid_timestamp', 'a read time is not a S§4 timestamp');
  }
  for (const r of [first, second]) {
    if (r.effective !== null && !isAmount(r.effective)) {
      return refuse('invalid_amount', `observation ${r.id}: not an amount: ${r.effective}`);
    }
  }
  const no = (reason: ConfirmationReason): PricesResult<OutlierConfirmation> =>
    ok({ confirmed: false, reason, differenceMinor: null, differenceBp: null });
  if (secondAt <= firstAt) return no('not_after_first');
  if (first.readPath !== second.readPath || first.rung !== second.rung) {
    return no('different_read_path');
  }
  if (first.effective === null || second.effective === null) return no('no_price');
  if (first.availability === 'out' || second.availability === 'out') return no('not_in_stock');
  const a = BigInt(first.effective);
  const b = BigInt(second.effective);
  const difference = a > b ? a - b : b - a;
  const within = difference * 100n <= a;
  return ok({
    confirmed: within,
    reason: within ? 'within_1_percent' : 'differs_by_more_than_1_percent',
    differenceMinor: Number(difference),
    differenceBp: a === 0n ? null : basisPoints(difference, a, 'up'),
  });
}
