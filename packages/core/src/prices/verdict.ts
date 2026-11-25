// S§5.5 deal verdicts, in code only, per listing, within one currency, condition and market. Pure:
// `now` is an argument, the history and the other stores' prices are inputs, and every number in
// the result comes from them. The struck-through "was" price is not an input: it is never a
// baseline.
//
// Definitions (the spec's numbers, and where it is silent, ours):
// - A price segment. Observations are ordered by (observedAt, id). Each holds from its time until
//   the next observation, but never longer than STALE_AFTER_MS (7 days) and never past `now`; the
//   last one runs to `now`, capped the same way. A failed read writes no observation (S§2.10), so a
//   gap is time under the previous price, up to 7 days; after that the price stops counting and
//   the rest of the gap is unknown time that counts for nothing. Seven days: at the default 30 min
//   cadence that is over 300 failed reads, and re-discovery has been queued since the first day of
//   errors (S§5.8); beyond it the listing's price cannot be assumed to have held.
// - A segment is priced when its observation has an effective price, a known currency and stock
//   that is not `out`. Out-of-stock time is no price anyone could pay: it is left out of the median,
//   the share, the days of history and the lowest recorded price. Unknown stock (S§2.10) still
//   counts: the store asked that price.
// - Days of history: the priced time across the whole history given, in whole days rounded down.
// - The window: the last 90 days, [now - 90 d, now]. A price read before the window that still
//   held at its start (not stale) is carried into it.
// - The 90-day time-weighted median: each price weighted by the milliseconds it held inside the
//   window. It is the smallest price at or below which at least half the priced time lies; when
//   exactly half lies at or below it, the mean of it and the next price up, the time-weighted form
//   of the settled even-count rule (shown rounded half up; compared exactly). With equal weights it
//   is the ordinary median.
// - Price levels: the distinct effective prices recorded in the window (priced observations in the
//   window, the price carried into it, and today's price), exact to the minor unit.
// - Lowest recorded: the lowest priced effective price in the whole history other than today's
//   own observation (the earliest on a tie). "At or under it" is the same with or without today.
// - Today's price: the last observation at or before `now`. Not judged when it has no price, is
//   out of stock, or is older than STALE_AFTER_MS.
// - Tiers, when the history has ≥14 days and ≥3 price levels (otherwise the cross-store form):
//   Lowest seen: today ≤ lowest recorded and ≥35 days of history. Good price: today ≤ 105% of the
//   lowest recorded, or today ≤ 90% of the median. High (ours: the spec gives no number): today
//   ≥ 110% of the median, the mirror of Good's 10% under it. Typical: anything between. Every
//   bound is inclusive and cross-multiplied exactly.
// - Cheapest of N stores, X% under the median: N counts stores, the listing's own included, each
//   at its lowest current price; stale (over 7 days), unpriced and out-of-stock peers are left out
//   and counted. The listing must be at or under every store's price (a tie counts, and is
//   reported), and not an outlier by the S§5.5 rule. The median is that of the N store prices,
//   the listing's own included; X is (median - today) / median in basis points rounded down, from
//   the exact median, so it never overstates a saving.
// - The share of the last 90 days at or below today's price: priced time in the window at or
//   below today over all priced time in the window, in basis points rounded up (a smaller share
//   reads as a better deal, so rounding up never overstates one). Null without priced time.
// - A tier that cannot be judged is listed with the reason, never defaulted to Typical.
import {
  AVAILABILITIES,
  type Availability,
  type Condition,
  DEAL_VERDICTS,
  type DealVerdictLabel,
  type ListingCurrency,
  type MinorUnitCurrency,
  type Money,
  type StreamBlock,
  UNKNOWN_CURRENCY,
} from '@agentic-dasher/shared';
import {
  basisPoints,
  DAY_MS,
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
import { assessOutlier, type ExactListingPrice } from './outlier.ts';

/** After this long without an observation a price stops counting (and today's price is stale). */
export const STALE_AFTER_MS = 7 * DAY_MS;
/** The window of the median, the price levels and the share. */
export const VERDICT_WINDOW_MS = 90 * DAY_MS;
export const LOWEST_SEEN_MIN_DAYS = 35;
export const HISTORY_MIN_DAYS = 14;
export const MIN_PRICE_LEVELS = 3;

/** One observation of the listing, as `price_observation` stores it. */
export interface HistoryPoint {
  readonly id: number;
  readonly observedAt: string;
  readonly effective: number | null;
  readonly currency: ListingCurrency;
  readonly availability: Availability;
}

/** The listing judged. */
export interface DealListing {
  readonly listingId: number;
  readonly storeId: number;
  readonly currency: ListingCurrency;
  readonly condition: Condition;
  /** The market key the caller groups by (the user's market country). */
  readonly market: string;
}

/** Another verified exact listing's current price, for the cross-store form. */
export interface PeerPrice {
  readonly listingId: number;
  readonly storeId: number;
  readonly observationId: number;
  readonly observedAt: string;
  readonly effective: number | null;
  readonly currency: ListingCurrency;
  readonly condition: Condition;
  readonly market: string;
  readonly availability: Availability;
}

export interface DealInput {
  /** UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`. */
  readonly now: string;
  readonly listing: DealListing;
  readonly history: readonly HistoryPoint[];
  readonly peers: readonly PeerPrice[];
}

export type UnjudgedReason =
  | 'no_current_price'
  | 'current_out_of_stock'
  | 'current_stale'
  | 'history_under_14_days'
  | 'history_under_35_days'
  | 'fewer_than_3_price_levels'
  | 'no_priced_time_in_window'
  | 'no_peers'
  | 'not_cheapest'
  | 'outlier';

export interface UnjudgedTier {
  readonly tier: DealVerdictLabel;
  readonly reason: UnjudgedReason;
}

export interface CheapestOfN {
  /** Stores compared, the listing's own included (≥2). */
  readonly storeCount: number;
  /** (median - today) / median, basis points rounded down. */
  readonly underMedianBp: number;
  /** The median of the store prices, rounded half up for display. */
  readonly median: Money;
  /** Other listings at exactly today's price (a tie for cheapest). */
  readonly sharedLowestWith: number;
}

export interface DealJudgement {
  readonly listingId: number;
  /** The tier, or null when none could be judged (`unjudged` says why). */
  readonly label: DealVerdictLabel | null;
  readonly today: {
    readonly observationId: number;
    readonly observedAt: string;
    readonly price: Money;
  } | null;
  readonly shareAtOrBelow90dBp: number | null;
  readonly daysOfHistory: number;
  readonly priceLevels90d: number;
  readonly lowestRecorded: { readonly observationId: number; readonly price: Money } | null;
  /** The 90-day time-weighted median, rounded half up for display. */
  readonly median90d: Money | null;
  /** Set when the label is `cheapest_of_n`. */
  readonly cheapestOfN: CheapestOfN | null;
  /** Peers left out of the cross-store form: unpriced, out of stock or stale. */
  readonly peersExcluded: number;
  readonly unjudged: readonly UnjudgedTier[];
  /** The observations the label rests on, ascending. */
  readonly restsOn: readonly number[];
}

interface Segment {
  readonly id: number;
  readonly observedAt: string;
  readonly at: number;
  readonly end: number;
  /** The effective price when the segment is priced (a price, not out of stock), else null. */
  readonly price: number | null;
  readonly availability: Availability;
  /** An effective price in a known currency, whatever the stock. */
  readonly hasPrice: boolean;
}

const HISTORY_TIERS = ['lowest_seen', 'good_price', 'typical', 'high'] as const;

/**
 * The S§5.5 deal verdict of one listing at `now`, from its observations and, for the cross-store
 * form, the other verified exact listings' current prices. Refuses (never filters) observations or
 * peers in another currency, condition or market, an unknown listing currency, an unknown
 * condition compared across listings, observations after `now`, duplicate ids and bad values.
 */
export function judgeDeal(input: DealInput): PricesResult<DealJudgement> {
  const { listing, history, peers } = input;
  const nowMs = timestampMs(input.now);
  if (nowMs === null)
    return refuse('invalid_timestamp', `now is not a S§4 timestamp: ${input.now}`);
  if (!isId(listing.listingId) || !isId(listing.storeId)) {
    return refuse('invalid_id', `listing ${listing.listingId}, store ${listing.storeId}`);
  }
  const currency = minorUnitCurrency(listing.currency);
  if (currency === null) return refuse('unknown_currency', 'a listing in an unknown currency');
  if (!isMarket(listing.market))
    return refuse('invalid_input', `not a market key: ${listing.market}`);

  const points: { readonly at: number; readonly hasPrice: boolean; readonly h: HistoryPoint }[] =
    [];
  const observationIds = new Set<number>();
  for (const h of history) {
    if (!isId(h.id)) return refuse('invalid_id', `observation id ${h.id}`);
    if (observationIds.has(h.id)) return refuse('duplicate_id', `observation ${h.id} twice`);
    observationIds.add(h.id);
    const at = timestampMs(h.observedAt);
    if (at === null) return refuse('invalid_timestamp', `observation ${h.id}: ${h.observedAt}`);
    if (at > nowMs) return refuse('observation_after_now', `observation ${h.id} is after now`);
    if (h.effective !== null && !isAmount(h.effective)) {
      return refuse('invalid_amount', `observation ${h.id}: not an amount: ${h.effective}`);
    }
    if (!AVAILABILITIES.includes(h.availability)) {
      return refuse('invalid_input', `observation ${h.id}: availability ${h.availability}`);
    }
    const known = h.currency !== UNKNOWN_CURRENCY;
    if (!known && h.effective !== null) {
      return refuse(
        'amount_without_currency',
        `observation ${h.id} has an amount, currency unknown`,
      );
    }
    if (known && h.currency !== listing.currency) {
      return refuse(
        'mixed_currency',
        `observation ${h.id} in ${h.currency}, listing in ${currency}`,
      );
    }
    points.push({ at, hasPrice: known && h.effective !== null, h });
  }

  if (peers.length > 0 && listing.condition === 'unknown') {
    return refuse('unknown_condition', 'a listing of unknown condition is compared with no other');
  }
  const peerListings = new Set<number>([listing.listingId]);
  const usable: (PeerPrice & { readonly effective: number })[] = [];
  for (const p of peers) {
    if (!isId(p.listingId) || !isId(p.storeId) || !isId(p.observationId)) {
      return refuse('invalid_id', `peer listing ${p.listingId}`);
    }
    if (peerListings.has(p.listingId) || observationIds.has(p.observationId)) {
      return refuse(
        'duplicate_id',
        `peer listing ${p.listingId} or observation ${p.observationId}`,
      );
    }
    peerListings.add(p.listingId);
    observationIds.add(p.observationId);
    if (p.currency !== listing.currency) {
      return refuse(
        'mixed_currency',
        `peer ${p.listingId} in ${p.currency}, listing in ${currency}`,
      );
    }
    if (p.condition === 'unknown') {
      return refuse('unknown_condition', `peer ${p.listingId} has an unknown condition`);
    }
    if (p.condition !== listing.condition) {
      return refuse('mixed_condition', `peer ${p.listingId} is ${p.condition}: never compared`);
    }
    if (p.market !== listing.market) {
      return refuse('mixed_market', `peer ${p.listingId} is in ${p.market}: never compared`);
    }
    const at = timestampMs(p.observedAt);
    if (at === null) return refuse('invalid_timestamp', `peer ${p.listingId}: ${p.observedAt}`);
    if (at > nowMs) return refuse('observation_after_now', `peer ${p.listingId} is after now`);
    if (p.effective !== null && !isAmount(p.effective)) {
      return refuse('invalid_amount', `peer ${p.listingId}: not an amount: ${p.effective}`);
    }
    if (!AVAILABILITIES.includes(p.availability)) {
      return refuse('invalid_input', `peer ${p.listingId}: availability ${p.availability}`);
    }
    const effective = p.effective;
    if (effective !== null && p.availability !== 'out' && nowMs - at <= STALE_AFTER_MS) {
      usable.push({ ...p, effective });
    }
  }
  const peersExcluded = peers.length - usable.length;

  points.sort((a, b) => a.at - b.at || a.h.id - b.h.id);
  const segments: Segment[] = points.map(({ at, hasPrice, h }, i) => ({
    id: h.id,
    observedAt: h.observedAt,
    at,
    end: Math.min(points[i + 1]?.at ?? nowMs, at + STALE_AFTER_MS, nowMs),
    price: hasPrice && h.availability !== 'out' ? h.effective : null,
    availability: h.availability,
    hasPrice,
  }));

  // Today's price.
  const last = segments.at(-1);
  let todayReason: UnjudgedReason | null = null;
  if (last === undefined) todayReason = 'no_current_price';
  else if (last.availability === 'out') todayReason = 'current_out_of_stock';
  else if (!last.hasPrice) todayReason = 'no_current_price';
  else if (nowMs - last.at > STALE_AFTER_MS) todayReason = 'current_stale';
  const today =
    todayReason === null && last !== undefined && last.price !== null
      ? { id: last.id, observedAt: last.observedAt, price: last.price }
      : null;

  // Days of history, the window, the levels, the lowest recorded.
  const windowStart = nowMs - VERDICT_WINDOW_MS;
  let coveredMs = 0;
  let totalWeight = 0;
  const weightByPrice = new Map<number, number>();
  const levels = new Set<number>();
  const windowIds: number[] = [];
  let lowest: { readonly id: number; readonly price: number } | null = null;
  for (const s of segments) {
    if (s.price === null) continue;
    coveredMs += s.end - s.at;
    const weight = Math.max(0, s.end - Math.max(s.at, windowStart));
    if (weight > 0) {
      totalWeight += weight;
      weightByPrice.set(s.price, (weightByPrice.get(s.price) ?? 0) + weight);
      windowIds.push(s.id);
    }
    if (s.at >= windowStart || s.end > windowStart) levels.add(s.price);
    if (s.id !== today?.id && (lowest === null || s.price < lowest.price)) {
      lowest = { id: s.id, price: s.price };
    }
  }
  const daysOfHistory = Math.floor(coveredMs / DAY_MS);
  const twice = totalWeight > 0 ? timeWeightedTwiceMedian(weightByPrice, totalWeight) : null;

  let share: number | null = null;
  if (today !== null && totalWeight > 0) {
    let atOrBelow = 0;
    for (const [price, weight] of weightByPrice) if (price <= today.price) atOrBelow += weight;
    share = basisPoints(BigInt(atOrBelow), BigInt(totalWeight), 'up');
  }

  const money = (amountMinor: number): Money => ({ amountMinor, currency });
  const judgement = {
    listingId: listing.listingId,
    today:
      today === null
        ? null
        : { observationId: today.id, observedAt: today.observedAt, price: money(today.price) },
    shareAtOrBelow90dBp: share,
    daysOfHistory,
    priceLevels90d: levels.size,
    lowestRecorded:
      lowest === null ? null : { observationId: lowest.id, price: money(lowest.price) },
    median90d: twice === null ? null : money(medianHalfUp(twice)),
    peersExcluded,
  };

  if (today === null) {
    const reason = todayReason ?? 'no_current_price';
    return ok({
      ...judgement,
      label: null,
      cheapestOfN: null,
      unjudged: DEAL_VERDICTS.map((tier) => ({ tier, reason })),
      restsOn: [],
    });
  }

  const t = BigInt(today.price);
  const unjudged: UnjudgedTier[] = [];
  const restsOn = new Set<number>([today.id]);
  let label: DealVerdictLabel | null = null;
  let cheapestOfN: CheapestOfN | null = null;

  const historyReason: UnjudgedReason | null =
    daysOfHistory < HISTORY_MIN_DAYS
      ? 'history_under_14_days'
      : levels.size < MIN_PRICE_LEVELS
        ? 'fewer_than_3_price_levels'
        : null;

  if (historyReason === null) {
    const low = lowest === null ? null : BigInt(lowest.price);
    const atLowest = low !== null && t <= low;
    if (atLowest && daysOfHistory >= LOWEST_SEEN_MIN_DAYS && lowest !== null) {
      label = 'lowest_seen';
      restsOn.add(lowest.id);
    } else {
      if (atLowest) unjudged.push({ tier: 'lowest_seen', reason: 'history_under_35_days' });
      if (low !== null && lowest !== null && 100n * t <= 105n * low) {
        label = 'good_price';
        restsOn.add(lowest.id);
      } else if (twice === null) {
        for (const tier of ['good_price', 'typical', 'high'] as const) {
          unjudged.push({ tier, reason: 'no_priced_time_in_window' });
        }
      } else {
        // today ≤ 90% of twice / 2  ⇔  20 t ≤ 9 twice;  today ≥ 110% of it  ⇔  20 t ≥ 11 twice.
        label = 20n * t <= 9n * twice ? 'good_price' : 20n * t >= 11n * twice ? 'high' : 'typical';
        for (const id of windowIds) restsOn.add(id);
      }
    }
  } else {
    for (const tier of HISTORY_TIERS) unjudged.push({ tier, reason: historyReason });
    const cross = cheapestAmongStores(listing, today.id, today.price, usable, currency);
    if (!cross.ok) return cross;
    if ('reason' in cross.value) {
      unjudged.push({ tier: 'cheapest_of_n', reason: cross.value.reason });
    } else {
      label = 'cheapest_of_n';
      cheapestOfN = cross.value.result;
      for (const p of usable) restsOn.add(p.observationId);
    }
  }

  return ok({
    ...judgement,
    label,
    cheapestOfN,
    unjudged,
    restsOn: [...restsOn].sort((a, b) => a - b),
  });
}

/**
 * Twice the time-weighted median: twice the smallest price with at least half the weight at or
 * below it, or, when exactly half is, that price plus the next one up.
 */
function timeWeightedTwiceMedian(
  weightByPrice: ReadonlyMap<number, number>,
  total: number,
): bigint {
  const prices = [...weightByPrice.keys()].sort((a, b) => a - b);
  let cumulative = 0;
  for (const [i, price] of prices.entries()) {
    cumulative += weightByPrice.get(price) ?? 0;
    if (2 * cumulative > total) return 2n * BigInt(price);
    if (2 * cumulative === total) return BigInt(price) + BigInt(prices[i + 1] ?? price);
  }
  throw new RangeError('the weights do not add up to the total');
}

function cheapestAmongStores(
  listing: DealListing,
  todayId: number,
  todayPrice: number,
  usable: readonly (PeerPrice & { readonly effective: number })[],
  currency: MinorUnitCurrency,
): PricesResult<{ readonly reason: UnjudgedReason } | { readonly result: CheapestOfN }> {
  const storePrices = new Map<number, number>([[listing.storeId, todayPrice]]);
  for (const p of usable) {
    const held = storePrices.get(p.storeId);
    if (held === undefined || p.effective < held) storePrices.set(p.storeId, p.effective);
  }
  if (storePrices.size < 2) return ok({ reason: 'no_peers' });
  if ([...storePrices.values()].some((price) => price < todayPrice)) {
    return ok({ reason: 'not_cheapest' });
  }
  const own: ExactListingPrice = {
    listingId: listing.listingId,
    observationId: todayId,
    effective: todayPrice,
    currency: listing.currency,
    condition: listing.condition,
    market: listing.market,
  };
  const outlier = assessOutlier(
    [
      own,
      ...usable.map(({ listingId, observationId, effective }) => ({
        ...own,
        listingId,
        observationId,
        effective,
      })),
    ],
    listing.listingId,
  );
  if (!outlier.ok) return outlier;
  if (outlier.value.outlier) return ok({ reason: 'outlier' });
  const twice = twiceMedian([...storePrices.values()]);
  const t = BigInt(todayPrice);
  return ok({
    result: {
      storeCount: storePrices.size,
      underMedianBp: twice === 0n ? 0 : basisPoints(twice - 2n * t, twice, 'down'),
      median: { amountMinor: medianHalfUp(twice), currency },
      sharedLowestWith: usable.filter((p) => p.effective === todayPrice).length,
    },
  });
}

type VerdictBlock = Extract<StreamBlock, { readonly type: 'verdict' }>;

/** The fields of the S§5.6 verdict block a judgement fills. */
export type StreamVerdictFields = Pick<VerdictBlock, 'deal' | 'shareAtOrBelow90dBp'>;

/**
 * The deal and the share of 90 days for the progress stream's verdict block, copied from a
 * judgement without recomputing anything.
 */
export function toStreamVerdict(judgement: DealJudgement): StreamVerdictFields {
  const { label, cheapestOfN, shareAtOrBelow90dBp } = judgement;
  if (label === null) return { deal: null, shareAtOrBelow90dBp };
  if (label === 'cheapest_of_n') {
    return {
      deal:
        cheapestOfN === null
          ? null
          : {
              label,
              storeCount: cheapestOfN.storeCount,
              underMedianBp: cheapestOfN.underMedianBp,
            },
      shareAtOrBelow90dBp,
    };
  }
  return { deal: { label }, shareAtOrBelow90dBp };
}
