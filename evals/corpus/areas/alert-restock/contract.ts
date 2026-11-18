// Contract of the restock decision (S§5.8 "A restock fires only on an out→in transition (first
// sighting is not one), with a watermark rather than a cooldown"; predecessor service.py
// `_upsert_offer` stock transitions, `_restocked_offer`, `set_tracker`). A pure decision over the
// reads of the watch's listings, the watch's restock rule and its watermark. No clock or database.
import type {
  Availability,
  Id,
  ListingCurrency,
  MinorUnitCurrency,
  Money,
  ReadMethod,
  Rung,
  Timestamp,
} from '@agentic-dasher/shared';

export interface ObservedRead {
  readonly kind: 'observation';
  readonly observationId: Id;
  readonly observedAt: Timestamp;
  readonly currency: ListingCurrency;
  /** Integer minor units of `currency`; null when the read carries no price. */
  readonly price: number | null;
  readonly availability: Availability;
  readonly readPath: ReadMethod;
  readonly rung: Rung;
}

/** A read that failed and wrote no observation (S§2.10). */
export interface FailedRead {
  readonly kind: 'failed';
  readonly at: Timestamp;
  readonly rung: Rung;
}

export type ListingRead = ObservedRead | FailedRead;

export interface RestockListing {
  readonly listingId: Id;
  /** Every read of the listing, oldest first. */
  readonly reads: readonly ListingRead[];
}

export interface RestockInput {
  readonly now: Timestamp;
  readonly watch: {
    readonly currency: MinorUnitCurrency | null;
    readonly targetPrice: Money | null;
    /** When the restock rule was last switched on; null when it is off. */
    readonly restockRuleOnSince: Timestamp | null;
    /** When a channel accepted this watch's last restock alert (S§2.11); null if never. */
    readonly lastAcceptedRestockAt: Timestamp | null;
  };
  readonly listings: readonly RestockListing[];
}

/**
 * Proposed vocabulary: why no restock alert fires. For one listing, the first that applies:
 * - `rule_off`: the watch has no restock rule.
 * - `not_comparable`: the listing's latest read is not in the watch's currency.
 * - `stale_read`: the listing's latest read failed.
 * - `not_in_stock`: the latest read's availability is not `in`.
 * - `first_sighting`: in stock, but it was never seen out of stock before.
 * - `already_told`: the last out→in transition is not later than the watermark.
 * With several listings, `silence` is that of the first listing in input order.
 */
export type RestockSilence =
  | 'rule_off'
  | 'not_comparable'
  | 'stale_read'
  | 'not_in_stock'
  | 'first_sighting'
  | 'already_told';

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
      /** True when the returned listing's price also reaches the watch's target. */
      readonly targetReached: boolean;
    }
  | { readonly fire: false; readonly silence: RestockSilence };

/**
 * The subject (Phase 1, packages/core). Per listing: walk the reads oldest first, keeping the last
 * known stock state; a failed read and an observation with availability `unknown` leave it as it
 * was. An out→in transition happens at an observation with availability `in` when the last known
 * state was `out`; a first `in` with no earlier known state is a first sighting, not a transition.
 * The watermark is the later of `restockRuleOnSince` and `lastAcceptedRestockAt`. A listing has
 * come back when its latest read is an in-stock observation with a price in the watch's currency
 * and its last transition is later than the watermark. There is no cooldown.
 */
export type EvaluateRestock = (input: RestockInput) => RestockDecision;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface RestockCase {
  readonly id: string;
  readonly what: string;
  readonly input: RestockInput;
  readonly expected: RestockDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
