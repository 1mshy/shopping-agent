// The watch's reference price (S§5.8 "Reference price" and Intake "The baseline and currency are
// adopted only from the first real read"). Pure: the watch and the listings it follows come in;
// whether to set, keep or have no reference comes out. The corpus area `reference-price` is its
// definition of done.
//
// What the caller passes as a listing's `latest`: its latest observation when it has one, and a
// failed read only when it was never observed. A failed read never overwrites the last known state
// (S§2.10), so it must not knock a listing out of the median.
//
// `none` means the watch has no reference to hold: the caller clears one it holds. With `latest`
// passed as above, that happens only when the eligible listings or the user's price went away.
//
// Readings chosen where the corpus leaves a choice:
// - Currency comes first, then the new-first-party preference within it: a new first-party
//   listing billed in another currency cannot be in the baseline, so it does not push a
//   same-currency refurb out.
// - With no currency adopted, the currency is the market's when an eligible listing bills in it;
//   otherwise the one most eligible listings bill in, a tie going to the first in input order.
// - A user-confirmed price is the reference only in the watch's currency. Before a currency is
//   adopted, it is the reference once an eligible real read gives a currency and the user's price
//   is in that currency (the read adopts the currency, the user's price stays the reference);
//   with no eligible real read it waits, since the currency is adopted only from a real read.
// - A listing's availability does not matter: a sold-out listing's latest price still counts.
// - `no_real_read`: no listing given has an observation with a price in a known currency;
//   `no_eligible_listing`: some do, none is eligible in the reference currency.
import type {
  Availability,
  Condition,
  Id,
  ListingChannel,
  ListingCurrency,
  MatchRelation,
  MinorUnitCurrency,
  Money,
  ReferenceKind,
  SellerKind,
  Timestamp,
} from '@agentic-dasher/shared';
import { assertMinor, assertPriceMoney, medianHalfUp } from './exact.ts';

export type ReferenceLatestRead =
  | {
      readonly kind: 'observation';
      readonly observationId: Id;
      readonly observedAt: Timestamp;
      readonly currency: ListingCurrency;
      /** Integer minor units; null when the read has no price. */
      readonly price: number | null;
      readonly availability: Availability;
    }
  | { readonly kind: 'failed'; readonly at: Timestamp };

export interface ReferenceListing {
  readonly listingId: Id;
  /** S§4.1 listing.product_id: the one product whose history this URL belongs to. */
  readonly productId: Id | null;
  readonly channel: ListingChannel;
  readonly sellerKind: SellerKind;
  readonly condition: Condition;
  /** The listing's relation to the watch's product (S§5.4). */
  readonly relation: MatchRelation;
  /** Identity confirmed by identifier, rules, cached verdict or a person (S§8 "Verified"). */
  readonly identityVerified: boolean;
  /** See the file header: the latest observation, or a failed read if never observed; null if never read. */
  readonly latest: ReferenceLatestRead | null;
}

export interface ReferenceInput {
  readonly watch: {
    readonly productId: Id;
    /** The user's configured market currency (S§2 invariant 3). */
    readonly marketCurrency: MinorUnitCurrency;
    /** Adopted from the first real read; null before it. */
    readonly currency: MinorUnitCurrency | null;
    readonly reference: { readonly price: Money; readonly kind: ReferenceKind } | null;
    readonly userConfirmedPrice: Money | null;
  };
  readonly listings: readonly ReferenceListing[];
}

/** Why no reference is set. */
export const NO_REFERENCE_REASONS = ['no_real_read', 'no_eligible_listing'] as const;
export type NoReferenceReason = (typeof NO_REFERENCE_REASONS)[number];

export type ReferenceDecision =
  | {
      readonly action: 'set';
      /** The watch's currency, adopted with the reference when it had none. */
      readonly currency: MinorUnitCurrency;
      readonly price: Money;
      readonly kind: ReferenceKind;
      /** The listings the median was taken over, in input order; empty for user_confirmed. */
      readonly fromListings: readonly Id[];
    }
  | { readonly action: 'keep' }
  | { readonly action: 'none'; readonly why: NoReferenceReason };

type Priced = {
  readonly listing: ReferenceListing;
  readonly currency: MinorUnitCurrency;
  readonly price: number;
};

/** The listing's latest price when it is a real read: an observation with a price in a known currency. */
function realRead(listing: ReferenceListing): Priced | null {
  const latest = listing.latest;
  if (latest === null || latest.kind !== 'observation' || latest.price === null) return null;
  if (latest.currency === 'unknown') return null;
  assertMinor(latest.price, `listing ${listing.listingId} latest.price`);
  return { listing, currency: latest.currency, price: latest.price };
}

const eligible = (r: Priced, productId: Id): boolean =>
  r.listing.productId === productId &&
  r.listing.relation === 'exact' &&
  r.listing.identityVerified &&
  r.listing.condition !== 'unknown';

const newFirstParty = (r: Priced): boolean =>
  r.listing.condition === 'new' &&
  r.listing.sellerKind === 'first_party' &&
  r.listing.channel === 'retail';

function adoptCurrency(
  candidates: readonly Priced[],
  market: MinorUnitCurrency,
): MinorUnitCurrency | null {
  if (candidates.some((r) => r.currency === market)) return market;
  const counts = new Map<MinorUnitCurrency, number>();
  let best: MinorUnitCurrency | null = null;
  for (const r of candidates) {
    const n = (counts.get(r.currency) ?? 0) + 1;
    counts.set(r.currency, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = r.currency;
  }
  return best;
}

/**
 * Works the reference out afresh: the user-confirmed price in the watch's currency, else the median
 * of the eligible listings' latest prices (eligible: the watch's product, `exact` with verified
 * identity, a known condition, a real read; only the new first-party retail ones when any exist),
 * with an even count rounded half up. `keep` when that equals the watch's reference (price and
 * kind) in an adopted currency, `set` otherwise. Refuses with a RangeError a negative or unsafe
 * amount.
 */
export function chooseReferencePrice(input: ReferenceInput): ReferenceDecision {
  const { watch, listings } = input;
  if (watch.userConfirmedPrice !== null) {
    assertPriceMoney(watch.userConfirmedPrice, 'watch.userConfirmedPrice');
  }
  if (watch.reference !== null) assertPriceMoney(watch.reference.price, 'watch.reference.price');

  const real = listings.map(realRead).filter((r): r is Priced => r !== null);
  const candidates = real.filter((r) => eligible(r, watch.productId));
  const currency = watch.currency ?? adoptCurrency(candidates, watch.marketCurrency);

  let decided: Extract<ReferenceDecision, { action: 'set' }>;
  const user = watch.userConfirmedPrice;
  if (currency !== null && user !== null && user.currency === currency) {
    decided = {
      action: 'set',
      currency,
      price: { amountMinor: user.amountMinor, currency },
      kind: 'user_confirmed',
      fromListings: [],
    };
  } else {
    const inCurrency = candidates.filter((r) => r.currency === currency);
    if (currency === null || inCurrency.length === 0) {
      return { action: 'none', why: real.length === 0 ? 'no_real_read' : 'no_eligible_listing' };
    }
    const preferred = inCurrency.filter(newFirstParty);
    const pool = preferred.length > 0 ? preferred : inCurrency;
    const median = medianHalfUp(pool.map((r) => BigInt(r.price)));
    decided = {
      action: 'set',
      currency,
      price: { amountMinor: Number(median), currency },
      kind: 'median_verified',
      fromListings: pool.map((r) => r.listing.listingId),
    };
  }

  const held = watch.reference;
  if (
    held !== null &&
    watch.currency === decided.currency &&
    held.kind === decided.kind &&
    held.price.currency === decided.currency &&
    held.price.amountMinor === decided.price.amountMinor
  ) {
    return { action: 'keep' };
  }
  return decided;
}
