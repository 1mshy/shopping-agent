// The price-alert decision (S§5.8 "Alert rules"; S§2 invariants 10 and 11). Pure: the watch, every
// read of one listing and the watch's last accepted price alert come in, at `now`; whether a price
// alert fires for the read just made comes out, and why not when it does not. The corpus area
// `alert-price-rules` is its definition of done.
//
// Readings chosen where the corpus leaves a choice (each gives every case the same verdict):
// - "Same read path" is the read method and the rung, for the confirming read (settled by the
//   orchestrator 2026-11-23) and for the MAD window alike.
// - The MAD window is every comparable observation in `reads` on the evaluated read's path and
//   rung, the evaluated read and the read before it included. The caller bounds the history it
//   passes (the "recent" window is the caller's). Including the evaluated read means the window is
//   never empty.
// - The MAD is raw (not scaled by 1.4826); its medians round half up like every even-count median.
// - The read before the evaluated one confirms when it is a comparable observation on the same path
//   and rung that meets (a) and (b) against the same reference and the same MAD.
// - Reads must be oldest first. Equal timestamps are accepted and the array order decides which
//   read came last; a read older than the one before it is refused with a RangeError, because "the
//   read immediately before" would otherwise be a guess.
// - A target, reference or last accepted alert in a currency other than the read's is never
//   compared (S§2.2): such a target is not reached, such a reference counts as none
//   (`no_reference`), and such a last alert can be neither undercut nor equalled, so only the
//   cooldown applies to it and after it any price counts as moved.
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
import {
  assertCount,
  assertMinor,
  assertPriceMoney,
  medianAbsoluteDeviation,
  timestampMs,
} from './exact.ts';

/** A read of a listing that produced an observation (S§4.1 price_observation, trimmed). */
export interface AlertObservedRead {
  readonly kind: 'observation';
  readonly observationId: Id;
  readonly observedAt: Timestamp;
  readonly currency: ListingCurrency;
  /**
   * The effective price after automatic discounts, in minor units of `currency`; null when the read
   * has no price. A coupon that needs a clip or a code is never taken off it.
   */
  readonly price: number | null;
  /** The sticker, when an automatic discount makes it differ from `price`. Shown, never compared. */
  readonly sticker?: number;
  /** A clip or code coupon's amount off. Shown with the read; it never lowers `price`. */
  readonly actionCouponOff?: number;
  readonly availability: Availability;
  readonly readPath: ReadMethod;
  readonly rung: Rung;
}

/** A read that failed: it wrote no observation (S§4.1, S§2.10). */
export interface AlertFailedRead {
  readonly kind: 'failed';
  readonly at: Timestamp;
  readonly rung: Rung;
}

export type AlertListingRead = AlertObservedRead | AlertFailedRead;

export interface PriceAlertWatch {
  /** Adopted from the first real read (S§5.8 Intake); null before it. */
  readonly currency: MinorUnitCurrency | null;
  /** The reference price (S§5.8), the baseline a drop is measured from; null until adopted. */
  readonly referencePrice: Money | null;
  readonly targetPrice: Money | null;
  /** The drop threshold in basis points (500 = 5%), 1 to 9999; null for no drop rule. */
  readonly dropBasisPoints: number | null;
  /** The per-watch cooldown in seconds (`watch.cooldown_s`; 12 h = 43200). */
  readonly cooldownSeconds: number;
}

export interface PriceAlertInput {
  readonly now: Timestamp;
  readonly watch: PriceAlertWatch;
  /** Every read of this one listing (as far back as the caller's window), oldest first. The last is evaluated. */
  readonly reads: readonly AlertListingRead[];
  /** The last price alert of this watch that a channel accepted (S§2.11); null if none ever was. */
  readonly lastAcceptedPriceAlert: { readonly price: Money; readonly acceptedAt: Timestamp } | null;
}

/** Which rule fired; both are reported when both are met, target first. */
export const PRICE_RULES_MET = ['target_reached', 'drop'] as const;
export type PriceRuleMet = (typeof PRICE_RULES_MET)[number];

/**
 * How an alert relates to the last accepted one: `first` (none accepted), `further_drop` (below the
 * last accepted price: bypasses the cooldown), `moved_after_cooldown` (cooldown over, price moved).
 */
export const ALERT_REPEATS = ['first', 'further_drop', 'moved_after_cooldown'] as const;
export type AlertRepeat = (typeof ALERT_REPEATS)[number];

/** Why no price alert fires, in the order the reasons win (see the contract in alert-price-rules). */
export const PRICE_ALERT_SILENCES = [
  'failed_read',
  'not_in_stock',
  'currency_mismatch',
  'no_reference',
  'below_threshold',
  'within_noise',
  'awaiting_confirmation',
  'cooldown',
  'unchanged_price',
] as const;
export type PriceAlertSilence = (typeof PRICE_ALERT_SILENCES)[number];

export type PriceAlertDecision =
  | {
      readonly fire: true;
      readonly rules: readonly PriceRuleMet[];
      /** The observation the alert rests on (S§4.4). */
      readonly observationId: Id;
      readonly price: Money;
      readonly repeat: AlertRepeat;
    }
  | { readonly fire: false; readonly silence: PriceAlertSilence };

type DropSilence = Extract<
  PriceAlertSilence,
  'no_reference' | 'below_threshold' | 'within_noise' | 'awaiting_confirmation'
>;

const readTime = (read: AlertListingRead): Timestamp =>
  read.kind === 'failed' ? read.at : read.observedAt;

function checkReads(reads: readonly AlertListingRead[], now: number): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const [i, read] of reads.entries()) {
    if (read.kind !== 'observation' && read.kind !== 'failed') {
      throw new TypeError(`reads[${i}]: unknown read kind`);
    }
    const at = timestampMs(readTime(read), `reads[${i}]`);
    if (at < previous) throw new RangeError(`reads[${i}]: reads are not oldest first`);
    previous = at;
    if (read.kind === 'observation' && read.price !== null) {
      assertMinor(read.price, `reads[${i}].price`);
    }
  }
  if (previous > now) throw new RangeError('the evaluated read is after now');
}

function checkWatch(watch: PriceAlertWatch): void {
  assertCount(watch.cooldownSeconds, 'watch.cooldownSeconds');
  const bp = watch.dropBasisPoints;
  if (bp !== null && (!Number.isSafeInteger(bp) || bp <= 0 || bp >= 10_000)) {
    throw new RangeError(`watch.dropBasisPoints: ${String(bp)} is not 0 < bp < 10000`);
  }
  if (watch.targetPrice !== null) assertPriceMoney(watch.targetPrice, 'watch.targetPrice');
  if (watch.referencePrice !== null) assertPriceMoney(watch.referencePrice, 'watch.referencePrice');
}

/** A read the rules may compare: an in-stock observation with a price in `currency` (S§5.8). */
function comparablePrice(read: AlertListingRead | undefined, currency: string): bigint | null {
  if (read === undefined || read.kind !== 'observation') return null;
  if (read.availability !== 'in' || read.price === null || read.currency !== currency) return null;
  // A price is above zero (the price-text rules refuse 0): a zero is a misread, not a bargain.
  if (read.price === 0) return null;
  return BigInt(read.price);
}

/** (a) B − P ≥ bp × B / 10000, by cross-multiplication. */
const meetsThreshold = (b: bigint, p: bigint, bp: bigint): boolean => (b - p) * 10_000n >= bp * b;

/** (b) B − P > max(3 × MAD, B / 100), by cross-multiplication. */
const beyondNoise = (b: bigint, p: bigint, mad: bigint): boolean =>
  b - p > 3n * mad && (b - p) * 100n > b;

/**
 * Whether a price alert fires for the last read in `input.reads`. Never throws on well-formed
 * input; refuses with a RangeError or TypeError: no read, reads out of order, a read after `now`, a
 * malformed timestamp, a negative or unsafe amount, a drop threshold outside 0 < bp < 10000, a
 * negative cooldown.
 */
export function evaluatePriceAlert(input: PriceAlertInput): PriceAlertDecision {
  const { watch, reads, lastAcceptedPriceAlert: last } = input;
  const now = timestampMs(input.now, 'now');
  checkWatch(watch);
  if (reads.length === 0) throw new RangeError('no read to evaluate');
  checkReads(reads, now);
  if (last !== null) {
    assertPriceMoney(last.price, 'lastAcceptedPriceAlert.price');
    timestampMs(last.acceptedAt, 'lastAcceptedPriceAlert.acceptedAt');
  }

  const evaluated = reads[reads.length - 1] as AlertListingRead;
  if (evaluated.kind === 'failed') return { fire: false, silence: 'failed_read' };
  if (evaluated.availability !== 'in') return { fire: false, silence: 'not_in_stock' };
  const currency = watch.currency;
  if (
    currency === null ||
    evaluated.currency !== currency ||
    evaluated.price === null ||
    evaluated.price === 0
  ) {
    return { fire: false, silence: 'currency_mismatch' };
  }
  const p = BigInt(evaluated.price);

  const rules: PriceRuleMet[] = [];
  const target = watch.targetPrice;
  if (target !== null && target.currency === currency && p <= BigInt(target.amountMinor)) {
    rules.push('target_reached');
  }

  let dropSilence: DropSilence = 'below_threshold';
  if (watch.dropBasisPoints !== null) {
    const verdict = dropRule(watch.dropBasisPoints, watch.referencePrice, currency, reads, p);
    if (verdict === 'met') rules.push('drop');
    else dropSilence = verdict;
  }
  if (rules.length === 0) return { fire: false, silence: dropSilence };

  const price: Money = { amountMinor: evaluated.price, currency };
  const repeat = repeatOf(last, price, now, watch.cooldownSeconds);
  if (repeat === 'cooldown' || repeat === 'unchanged_price')
    return { fire: false, silence: repeat };
  return { fire: true, rules, observationId: evaluated.observationId, price, repeat };
}

function dropRule(
  basisPoints: number,
  reference: Money | null,
  currency: MinorUnitCurrency,
  reads: readonly AlertListingRead[],
  p: bigint,
): 'met' | DropSilence {
  if (reference === null || reference.currency !== currency) return 'no_reference';
  const b = BigInt(reference.amountMinor);
  const bp = BigInt(basisPoints);
  if (!meetsThreshold(b, p, bp)) return 'below_threshold';

  const evaluated = reads[reads.length - 1] as AlertObservedRead;
  const window: bigint[] = [];
  for (const read of reads) {
    if (read.kind !== 'observation') continue;
    if (read.readPath !== evaluated.readPath || read.rung !== evaluated.rung) continue;
    const price = comparablePrice(read, currency);
    if (price !== null) window.push(price);
  }
  const mad = medianAbsoluteDeviation(window);
  if (!beyondNoise(b, p, mad)) return 'within_noise';

  const before = reads[reads.length - 2];
  const confirming = comparablePrice(before, currency);
  if (
    before === undefined ||
    before.kind !== 'observation' ||
    before.readPath !== evaluated.readPath ||
    before.rung !== evaluated.rung ||
    confirming === null ||
    !meetsThreshold(b, confirming, bp) ||
    !beyondNoise(b, confirming, mad)
  ) {
    return 'awaiting_confirmation';
  }
  return 'met';
}

function repeatOf(
  last: PriceAlertInput['lastAcceptedPriceAlert'],
  price: Money,
  now: number,
  cooldownSeconds: number,
): AlertRepeat | 'cooldown' | 'unchanged_price' {
  if (last === null) return 'first';
  const comparable = last.price.currency === price.currency;
  if (comparable && price.amountMinor < last.price.amountMinor) return 'further_drop';
  const elapsedMs = BigInt(now - timestampMs(last.acceptedAt, 'lastAcceptedPriceAlert.acceptedAt'));
  if (elapsedMs < BigInt(cooldownSeconds) * 1000n) return 'cooldown';
  if (comparable && price.amountMinor === last.price.amountMinor) return 'unchanged_price';
  return 'moved_after_cooldown';
}
