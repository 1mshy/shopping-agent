// The restock decision (S§5.8 "A restock fires only on an out→in transition (first sighting is not
// one), with a watermark rather than a cooldown"; S§2 invariants 10 and 11). Pure: the watch's
// restock rule and watermark and the reads of its listings come in; whether a restock alert fires,
// and for which listing, comes out. The corpus area `alert-restock` is its definition of done.
//
// Readings chosen where the corpus leaves a choice:
// - A listing whose latest read is an observation in another currency (or on a watch with no
//   currency yet) is `not_comparable`, whatever its stock; an in-stock one with no price is
//   `not_comparable` too; an out-of-stock one with no price is `not_in_stock`. A listing with no
//   read at all is `not_in_stock` (nothing says it is in stock).
//   A watch with no listing is `not_in_stock` too (when its rule is on).
// - The stock state is the listing's alone: an observation's currency does not affect it.
// - When several listings came back, the cheapest is named; at an equal price, the first in input
//   order.
// - A watch stamp after `now` is not refused: no transition can be later than it, so nothing fires.
import type { Id, MinorUnitCurrency, Money, Timestamp } from '@agentic-dasher/shared';
import { assertMinor, assertPriceMoney, timestampMs } from './exact.ts';
import type { AlertListingRead } from './price-rules.ts';

export interface RestockListing {
  readonly listingId: Id;
  /** Newest transition already covered for this listing on this watch, in insertion order. */
  readonly coveredThroughObservationId?: Id;
  /** Every read of the listing, oldest first. */
  readonly reads: readonly AlertListingRead[];
}

export interface RestockWatch {
  readonly currency: MinorUnitCurrency | null;
  readonly targetPrice: Money | null;
  /** When the restock rule was last switched on (`watch.restock_enabled_at`); null while it is off. */
  readonly restockRuleOnSince: Timestamp | null;
  /** When a channel accepted this watch's last restock alert (S§2.11); null if never. */
  readonly lastAcceptedRestockAt: Timestamp | null;
}

export interface RestockInput {
  readonly now: Timestamp;
  readonly watch: RestockWatch;
  readonly listings: readonly RestockListing[];
}

/** Why no restock alert fires, per listing, the first that applies (see alert-restock's contract). */
export const RESTOCK_SILENCES = [
  'rule_off',
  'not_comparable',
  'stale_read',
  'not_in_stock',
  'first_sighting',
  'already_told',
] as const;
export type RestockSilence = (typeof RESTOCK_SILENCES)[number];

export type RestockDecision =
  | {
      readonly fire: true;
      /** The listing named: the cheapest of those that came back. */
      readonly listingId: Id;
      /** The in-stock observation the alert rests on (the listing's latest read). */
      readonly observationId: Id;
      readonly price: Money;
      /** The observation at which the listing was first seen in stock again. */
      readonly transitionAt: Timestamp;
      /** True when the named listing's price also reaches the watch's target. */
      readonly targetReached: boolean;
    }
  | { readonly fire: false; readonly silence: RestockSilence };

export interface RestockTransition {
  readonly listingId: Id;
  readonly transitionObservationId: Id;
}

type Returned = RestockTransition & {
  readonly observationId: Id;
  readonly price: number;
  readonly transitionAt: Timestamp;
};

/**
 * Per listing: walk the reads oldest first keeping the last known stock (a failed read and an
 * `unknown` observation leave it as it was); an `in` observation after a known `out` is a
 * transition. A listing has come back when its latest read is an in-stock observation with a price
 * in the watch's currency and its last transition is strictly later than the watermark (the later
 * of `restockRuleOnSince` and `lastAcceptedRestockAt`). No cooldown. Refuses with a RangeError:
 * reads out of order or after `now`, a malformed timestamp, a negative or unsafe amount.
 */
export function evaluateRestock(input: RestockInput): RestockDecision {
  return evaluateRestockWithCoverage(input).decision;
}

/** Evaluate once, reporting every eligible transition covered by the single cheapest-listing alert. */
export function evaluateRestockWithCoverage(input: RestockInput): {
  readonly decision: RestockDecision;
  readonly transitions: readonly RestockTransition[];
} {
  const transitions: RestockTransition[] = [];
  const { watch, listings } = input;
  const now = timestampMs(input.now, 'now');
  const ruleOn =
    watch.restockRuleOnSince === null
      ? null
      : timestampMs(watch.restockRuleOnSince, 'watch.restockRuleOnSince');
  const accepted =
    watch.lastAcceptedRestockAt === null
      ? null
      : timestampMs(watch.lastAcceptedRestockAt, 'watch.lastAcceptedRestockAt');
  if (watch.targetPrice !== null) assertPriceMoney(watch.targetPrice, 'watch.targetPrice');
  for (const listing of listings) checkReads(listing, now);

  if (ruleOn === null) return { decision: { fire: false, silence: 'rule_off' }, transitions };
  const watermark = accepted === null ? ruleOn : Math.max(ruleOn, accepted);

  let firstSilence: RestockSilence | null = null;
  let best: Returned | null = null;
  for (const listing of listings) {
    const outcome = judge(listing, watch.currency, watermark);
    if (typeof outcome === 'string') {
      firstSilence ??= outcome;
    } else {
      transitions.push({
        listingId: outcome.listingId,
        transitionObservationId: outcome.transitionObservationId,
      });
      if (best === null || outcome.price < best.price) best = outcome;
    }
  }
  if (best === null)
    return { decision: { fire: false, silence: firstSilence ?? 'not_in_stock' }, transitions };

  const currency = watch.currency as MinorUnitCurrency;
  const target = watch.targetPrice;
  return {
    transitions,
    decision: {
      fire: true,
      listingId: best.listingId,
      observationId: best.observationId,
      price: { amountMinor: best.price, currency },
      transitionAt: best.transitionAt,
      targetReached:
        target !== null && target.currency === currency && best.price <= target.amountMinor,
    },
  };
}

function checkReads(listing: RestockListing, now: number): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const [i, read] of listing.reads.entries()) {
    const what = `listing ${listing.listingId} reads[${i}]`;
    const at = timestampMs(read.kind === 'failed' ? read.at : read.observedAt, what);
    if (at < previous) throw new RangeError(`${what}: reads are not oldest first`);
    if (at > now) throw new RangeError(`${what}: the read is after now`);
    previous = at;
    if (read.kind === 'observation' && read.price !== null)
      assertMinor(read.price, `${what}.price`);
  }
}

function judge(
  listing: RestockListing,
  currency: MinorUnitCurrency | null,
  watermark: number,
): Returned | RestockSilence {
  const latest = listing.reads[listing.reads.length - 1];
  if (latest === undefined) return 'not_in_stock';
  if (latest.kind === 'failed') return 'stale_read';
  if (currency === null || latest.currency !== currency) return 'not_comparable';
  if (latest.availability !== 'in') return 'not_in_stock';
  if (latest.price === null) return 'not_comparable';

  let known: 'in' | 'out' | null = null;
  let transition: Extract<AlertListingRead, { kind: 'observation' }> | null = null;
  for (const read of listing.reads) {
    if (read.kind === 'failed' || read.availability === 'unknown') continue;
    if (read.availability === 'in' && known === 'out') transition = read;
    known = read.availability;
  }
  if (transition === null) return 'first_sighting';
  if (
    Date.parse(transition.observedAt) <= watermark ||
    (listing.coveredThroughObservationId !== undefined &&
      transition.observationId <= listing.coveredThroughObservationId)
  )
    return 'already_told';
  return {
    listingId: listing.listingId,
    observationId: latest.observationId,
    price: latest.price,
    transitionAt: transition.observedAt,
    transitionObservationId: transition.observationId,
  };
}
