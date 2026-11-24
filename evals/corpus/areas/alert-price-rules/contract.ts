// Contract of the price-alert decision (S§5.8 "Alert rules"; predecessor service.py `_reasons`,
// `_should_notify`, `_best_offer(fresh_only=True)`). A pure decision: the case supplies the watch,
// every read of one listing and the last accepted alert; the function says whether a price alert
// fires for the read just made, and why not when it does not. No clock, database or network.
//
// Units: money is `Money` (integer minor units with its currency); percentages are integer basis
// points (500 = 5%); the cooldown is integer seconds (the `watch.cooldown_s` column).
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

/** A read of the listing that produced an observation (S§4.1 price_observation, trimmed). */
export interface ObservedRead {
  readonly kind: 'observation';
  readonly observationId: Id;
  readonly observedAt: Timestamp;
  readonly currency: ListingCurrency;
  /**
   * The amount the watch measures, in integer minor units of `currency`; null when the read has
   * no price. It is the effective price after any automatic discount (the alert price, shown
   * beside the sticker); a coupon that needs a clip or a code is never taken off it (owner's
   * ruling of 2026-11-23).
   */
  readonly price: number | null;
  /** The sticker, in minor units of `currency`, when an automatic discount makes it differ from `price`. */
  readonly sticker?: number;
  /**
   * The amount off of a coupon the buyer must clip or enter as a code, in minor units of
   * `currency`. Shown with the read; it never lowers `price` and never triggers an alert on its own.
   */
  readonly actionCouponOff?: number;
  readonly availability: Availability;
  readonly readPath: ReadMethod;
  readonly rung: Rung;
}

/** A read that failed: it wrote no observation (S§4.1 failed-read rule, S§2.10). */
export interface FailedRead {
  readonly kind: 'failed';
  readonly at: Timestamp;
  readonly rung: Rung;
}

export type ListingRead = ObservedRead | FailedRead;

export interface PriceAlertWatch {
  /** Adopted from the first real read (S§5.8 Intake). */
  readonly currency: MinorUnitCurrency | null;
  /** The reference price (S§5.8): the baseline a drop is measured from. Null until adopted. */
  readonly referencePrice: Money | null;
  readonly targetPrice: Money | null;
  /** The user's drop threshold in basis points (500 = the default 5% rule); null for no drop rule. */
  readonly dropBasisPoints: number | null;
  /** The cooldown in seconds (12 h = 43200). */
  readonly cooldownSeconds: number;
}

export interface PriceAlertInput {
  readonly now: Timestamp;
  readonly watch: PriceAlertWatch;
  /** Every read of this one listing, oldest first. The last entry is the read being evaluated. */
  readonly reads: readonly ListingRead[];
  /**
   * The last price alert of this watch that a channel accepted (S§2.11: only acceptance stamps the
   * cooldown); null when no price alert of this watch was ever accepted.
   */
  readonly lastAcceptedPriceAlert: { readonly price: Money; readonly acceptedAt: Timestamp } | null;
}

/** Which rule fired. Both are reported when both are met, target first. */
export type PriceRuleMet = 'target_reached' | 'drop';

/**
 * Proposed vocabulary. How this alert relates to the last accepted one: `first` (none accepted),
 * `further_drop` (below the last accepted price: bypasses the cooldown), `moved_after_cooldown`
 * (cooldown over and the price differs from the last accepted one).
 */
export type AlertRepeat = 'first' | 'further_drop' | 'moved_after_cooldown';

/**
 * Proposed vocabulary: why no price alert fires. When several apply, the first in this order wins:
 * - `failed_read`: the read being evaluated failed; a failed read never alerts (S§2.10).
 * - `not_in_stock`: the read's availability is not `in` (out or unknown).
 * - `currency_mismatch`: the read is not in the watch's currency (or has no price in it).
 * - `no_reference` | `below_threshold` | `within_noise` | `awaiting_confirmation`: no rule is met.
 *   With a drop rule this says how the drop rule failed: no reference price yet; the drop is
 *   smaller than the user's threshold; the drop is not more than max(3 MAD, 1% of the reference);
 *   or the read before it, on the same read path, does not confirm it. Without a drop rule it is
 *   `below_threshold` (the target was not reached).
 * - `cooldown`: a rule is met, the last accepted alert is less than `cooldownSeconds` old and the
 *   price is not below its price.
 * - `unchanged_price`: the cooldown is over, but the price equals the last accepted alert's.
 */
export type PriceAlertSilence =
  | 'failed_read'
  | 'not_in_stock'
  | 'currency_mismatch'
  | 'no_reference'
  | 'below_threshold'
  | 'within_noise'
  | 'awaiting_confirmation'
  | 'cooldown'
  | 'unchanged_price';

export type PriceAlertDecision =
  | {
      readonly fire: true;
      readonly rules: readonly PriceRuleMet[];
      /** The observation the alert rests on (S§4.4: an alert names its observation). */
      readonly observationId: Id;
      readonly price: Money;
      readonly repeat: AlertRepeat;
    }
  | { readonly fire: false; readonly silence: PriceAlertSilence };

/**
 * The subject (Phase 1, packages/core). Rules, from S§5.8:
 * - Comparable reads: an observation with availability `in`, a price, and the watch's currency.
 *   The price is the effective price after automatic discounts; a clip or code coupon is not
 *   taken off (owner's ruling of 2026-11-23).
 * - Target: fires when the comparable price is at or below `targetPrice` (inclusive: "$50 or
 *   less" fires at $50.00, owner's ruling of 2026-11-23); one read suffices.
 * - Drop, with B = referencePrice and P = the read's price, both in the watch's currency:
 *   (a) B − P ≥ dropBasisPoints × B / 10000 (the user's threshold, inclusive: owner's ruling of
 *       2026-11-23);
 *   (b) B − P > max(3 × MAD, B / 100) (strictly more than 3 MAD, floor 1% of B), where MAD is the
 *       median absolute deviation, around their median, of this listing's comparable observations
 *       on the same read path as the evaluated read (with an even count the median is the mean of
 *       the two middle values, rounded half up to the minor unit: settled by the orchestrator
 *       2026-11-23, the owner may overrule; no case's verdict depends on the rounding);
 *   (c) confirmation: the read immediately before the evaluated one is an observation on the same
 *       read path, including the same rung (settled by the orchestrator 2026-11-23, the owner may
 *       overrule), and the evaluated read, the confirming one, itself meets (a) and (b): a smaller
 *       drop on the second read that does not meet the rule sends nothing, and the watch keeps
 *       watching (owner's ruling of 2026-11-23).
 *   Comparisons are exact (no rounding of B / 100).
 * - Repeat: with an accepted alert at price L, a price below L fires at once (`further_drop`);
 *   otherwise it fires only once `now − acceptedAt ≥ cooldownSeconds` and the price differs from L.
 *   The cooldown is per watch (settled by the orchestrator 2026-11-23, the owner may overrule).
 * Open readings (window of the MAD, whether the reads being confirmed enter it, scaled or raw MAD)
 * are listed in the area report; every case gives the same verdict under each reading.
 */
export type EvaluatePriceAlert = (input: PriceAlertInput) => PriceAlertDecision;

/**
 * How a case's expected value was obtained. `ruling`: the owner's rulings of 2026-11-23, or a
 * detail the orchestrator settled that day (the owner may overrule), as docs/progress.md records
 * them; they win over the spec and the predecessor.
 */
export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec' | 'ruling';

export interface CaseSource {
  readonly how: Provenance;
  /** Predecessor `file::test` or `file:line function`, or the spec section and sentence. */
  readonly ref: string;
}

export interface PriceAlertCase {
  readonly id: string;
  readonly what: string;
  readonly input: PriceAlertInput;
  readonly expected: PriceAlertDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  /** Arithmetic, conversions of the predecessor's float text, and anything added. */
  readonly notes?: string;
  /** What the predecessor did and why the spec differs. */
  readonly divergence?: string;
  /** Inputs were added that the predecessor's scenario lacks; the notes say which and why. */
  readonly specDerived?: true;
  /** The spec says nothing on this behaviour; the predecessor's is ported. */
  readonly specSilent?: true;
}
