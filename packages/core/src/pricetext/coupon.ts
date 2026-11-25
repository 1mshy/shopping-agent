// Reads the coupon a product page or search card shows beside its buy box into the S§4.1 fields:
// `coupon` is an amount off; a percentage becomes an amount only because its base, the sticker, is
// known (S§5.5). The price after the coupon is not the effective price: a coupon the buyer must
// clip or enter is shown beside the price and never fires an alert on its own (owner's ruling of
// 2026-11-23). Known failure: the CA$167.73 → CA$49.99 clip coupon of 2026-09-02.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import {
  minorUnitExponent,
  moneyFromDecimal,
  priceAfterPercentOff,
  subtractMoney,
} from '../money.ts';
import { normaliseText } from './normalise.ts';
import { type FigureToken, type MarkToken, scan } from './scan.ts';
import { readFigure } from './separators.ts';

export interface CouponInput {
  /** The buy-box price the coupon comes off. Its currency is the coupon's. */
  readonly sticker: Money;
  /** The visible text of the coupon widgets or the search card, fragments joined by spaces. */
  readonly text: string;
}

export type CouponReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'amount_off'; readonly amountOff: Money; readonly afterCoupon: Money }
  | {
      readonly kind: 'percent_off';
      /** The percentage in basis points (20% is 2000). */
      readonly basisPoints: number;
      readonly amountOff: Money;
      readonly afterCoupon: Money;
    };

const NONE: CouponReading = { kind: 'none' };
const COUPON_WORD = /(?<![\p{L}\p{N}])(?:coupons?|cupón|cupon|cupones)(?![\p{L}\p{N}])/giu;
const SUBSCRIPTION_WORD =
  /(?<![\p{L}\p{N}])(?:subscribe|subscription|abonnez|abonnement|abonnieren|spar-abo|suscríbete|suscripción)(?![\p{L}\p{N}])/giu;
const MAX_COUPON_TEXT = 2000;

interface Span {
  readonly start: number;
  readonly end: number;
}
const gap = (a: Span, b: Span) => Math.max(0, b.start - a.end, a.start - b.end);

/**
 * The coupon in the text, or `none`. The figure nearest a word "coupon" is the coupon, among the
 * figures that carry a currency mark or a percent sign. A figure that subscription words sit
 * nearest to ("Save 5% with Subscribe & Save") is never a coupon, wherever it sits. An amount not
 * below the sticker, a percentage outside (0, 100), a mark naming another currency, or two figures
 * equally near, is a misread and gives `none`. A percentage's amount off is the sticker less the
 * price after the coupon, sticker × (1 − percentage) rounded half up to the minor unit.
 */
export function readCoupon(input: CouponInput): CouponReading {
  let sticker: unknown;
  let rawText: unknown;
  try {
    sticker = input.sticker;
    rawText = input.text;
  } catch {
    return NONE;
  }
  if (typeof rawText !== 'string' || rawText.length > MAX_COUPON_TEXT) return NONE;
  const base = checkedSticker(sticker);
  if (base === null) return NONE;

  const { text } = normaliseText(rawText);
  const couponWords = [...text.matchAll(COUPON_WORD)].map(spanOf);
  if (couponWords.length === 0) return NONE;
  const { figures, marks } = scan(text);
  const candidates = figures.filter(
    (f) => !f.glued && (f.percent || marks.some((m) => markBeside(text, f, m))),
  );
  if (candidates.length === 0) return NONE;

  // Each subscription phrase claims the candidate nearest to it.
  const claimed = new Set<FigureToken>();
  for (const word of [...text.matchAll(SUBSCRIPTION_WORD)].map(spanOf)) {
    const nearest = nearestTo(word, candidates);
    if (nearest !== null) claimed.add(nearest);
  }
  const offers = candidates.filter((f) => !claimed.has(f));
  let best: FigureToken | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  let tie = false;
  for (const figure of offers) {
    const distance = Math.min(...couponWords.map((w) => gap(w, figure)));
    if (distance < bestGap) {
      best = figure;
      bestGap = distance;
      tie = false;
    } else if (distance === bestGap) {
      tie = true;
    }
  }
  if (best === null || tie) return NONE;
  return best.percent
    ? percentOff(best, base)
    : amountOff(
        best,
        marks.filter((m) => markBeside(text, best, m)),
        base,
      );
}

function spanOf(m: RegExpMatchArray): Span {
  const start = m.index ?? 0;
  return { start, end: start + m[0].length };
}

function nearestTo(word: Span, figures: readonly FigureToken[]): FigureToken | null {
  let nearest: FigureToken | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const figure of figures) {
    const d = gap(word, figure);
    if (d < distance) {
      nearest = figure;
      distance = d;
    }
  }
  return nearest;
}

/** A mark written against the figure, with at most a space between ("$117.74", "40 $"). */
function markBeside(text: string, figure: FigureToken, mark: MarkToken): boolean {
  const between =
    mark.end <= figure.start
      ? text.slice(mark.end, figure.start)
      : text.slice(figure.end, mark.start);
  return (mark.end <= figure.start || mark.start >= figure.end) && /^ ?$/.test(between);
}

function checkedSticker(sticker: unknown): Money | null {
  if (typeof sticker !== 'object' || sticker === null) return null;
  const { amountMinor, currency } = sticker as { amountMinor?: unknown; currency?: unknown };
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return null;
  }
  if (!minorUnitExponent(currency as MinorUnitCurrency).ok) return null;
  return { amountMinor, currency: currency as MinorUnitCurrency };
}

function amountOff(
  figure: FigureToken,
  marks: readonly MarkToken[],
  sticker: Money,
): CouponReading {
  if (marks.some((m) => m.info.kind === 'cents' || !m.info.compatible.has(sticker.currency))) {
    return NONE;
  }
  const exponent = minorUnitExponent(sticker.currency);
  if (!exponent.ok || figure.orphanSeparator) return NONE;
  const reading = readFigure(figure.text, exponent.value, null);
  if (!reading.ok) return NONE;
  const parsed = moneyFromDecimal(reading.decimal, sticker.currency);
  if (!parsed.ok) return NONE;
  const off = parsed.value;
  if (off.amountMinor <= 0 || off.amountMinor >= sticker.amountMinor) return NONE;
  const after = subtractMoney(sticker, off);
  return after.ok ? { kind: 'amount_off', amountOff: off, afterCoupon: after.value } : NONE;
}

function percentOff(figure: FigureToken, sticker: Money): CouponReading {
  // A percentage has at most two decimals (basis points): "20", "12.5", "12,5".
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(figure.text);
  if (m === null || figure.orphanSeparator) return NONE;
  const basisPoints = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (basisPoints <= 0 || basisPoints >= 10_000) return NONE;
  const after = priceAfterPercentOff(sticker, basisPoints);
  if (!after.ok) return NONE;
  const off = subtractMoney(sticker, after.value);
  if (!off.ok || off.value.amountMinor <= 0) return NONE;
  return { kind: 'percent_off', basisPoints, amountOff: off.value, afterCoupon: after.value };
}
