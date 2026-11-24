// Contract of the watch's reference price (S§5.8 "Reference price is the median of verified exact
// listings or a user-confirmed price, never the first match. A refurb, open-box or marketplace
// listing never becomes the baseline when a new first-party one exists. One URL belongs to one
// product's history." and Intake "The baseline and currency are adopted only from the first real
// read"; predecessor service.py `_initial_baselines`, `track_query` `as_new`, `_discover_product`
// collision check). A pure decision over the watch and the listings it follows.
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

export type LatestRead =
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
  /** The listing's latest read; null if it was never read. */
  readonly latest: LatestRead | null;
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

/** Proposed vocabulary: why no reference is set. */
export type NoReferenceReason = 'no_real_read' | 'no_eligible_listing';

export type ReferenceDecision =
  | {
      readonly action: 'set';
      /** The watch's currency, adopted with the reference when it had none. */
      readonly currency: MinorUnitCurrency;
      readonly price: Money;
      readonly kind: ReferenceKind;
      /** The listings whose prices the median was taken over, in input order; empty for user_confirmed. */
      readonly fromListings: readonly Id[];
    }
  | { readonly action: 'keep' }
  | { readonly action: 'none'; readonly why: NoReferenceReason };

/**
 * The subject (Phase 1). The reference is worked out afresh on every call; the decision is `keep`
 * when it equals the watch's current reference (same price and kind), `set` otherwise.
 * - A user-confirmed price in the watch's currency is the reference (`user_confirmed`) and wins
 *   over the observed median until the user changes it (owner's ruling of 2026-11-23).
 * - Otherwise the reference is the median of the eligible listings' latest prices
 *   (`median_verified`), recomputed as reads arrive (owner's ruling of 2026-11-23). A listing is
 *   eligible when it belongs to the watch's product, its relation is `exact` with verified
 *   identity, its condition is known (an `unknown` condition is shown with a flag and left out of
 *   the reference: owner's ruling of 2026-11-23), and its latest read is an observation with a
 *   price in a known currency. If any eligible listing is new (condition `new`) from a first-party
 *   seller on a retail channel, only those count. Currency: the watch's, if adopted; otherwise the
 *   market currency when an eligible listing bills in it, else the currency the eligible listings
 *   bill in. With an even count the median is the mean of the two middle prices rounded half up to
 *   the minor unit (settled by the orchestrator 2026-11-23, the owner may overrule).
 * Open readings (how a user price relates to "currency adopted only from the first real read",
 * several foreign currencies) are in the area report.
 */
export type ChooseReferencePrice = (input: ReferenceInput) => ReferenceDecision;

/** `ruling`: the owner's rulings of 2026-11-23 or a detail the orchestrator settled that day. */
export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec' | 'ruling';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface ReferenceCase {
  readonly id: string;
  readonly what: string;
  readonly input: ReferenceInput;
  readonly expected: ReferenceDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
