// Contract for reading a price as a page, feed or API wrote it (S§2.2, S§5.2; port map S§7 row 1,
// predecessor `money.parse_price`). The function does not exist yet; Phase 1 workstream 2 writes
// it against these types and the cases in `cases/`.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';

/** How a case's expected value was established. */
export type How =
  | 'test assertion' // a predecessor test asserts it
  | 'reading the function' // read off the predecessor's source
  | 'running the function offline' // the predecessor's pure function, run with no network
  | 'spec'; // no predecessor behaviour: the spec states it

export interface Provenance {
  /** Predecessor path under `pricewatch/` or `reports/`, or a spec section. */
  readonly file: string;
  /** Test function, function name or line. */
  readonly at: string;
  readonly how: How;
  readonly note?: string;
}

/** What every case carries besides its input and expected value. */
export interface CaseMeta {
  readonly id: string;
  readonly what: string;
  readonly from: readonly Provenance[];
  /** What the predecessor did and why the spec differs: the case follows the spec. */
  readonly divergence?: string;
  /** Predecessor behaviour the spec does not mention, ported as is. */
  readonly specSilent?: true;
}

/** A price as read, and the currency it is read in. */
export interface PriceTextInput {
  /**
   * The price exactly as the page, feed or API wrote it: symbols, ISO codes, ordinary, no-break
   * (U+00A0) and narrow no-break (U+202F) spaces included. A JSON number is passed as its source
   * text ("49.99"), never through a float.
   */
  readonly text: string;
  /**
   * The currency already resolved for this figure (area `currency-resolution`). Required: there
   * is no default currency (S§2.2). It fixes the minor-unit exponent.
   */
  readonly currency: MinorUnitCurrency;
}

/**
 * Why a text is not one price. When several apply, the first in this order is reported: the words
 * that say what the money is (instalment, lower bound, per measure) come before the shape of the
 * figures (range, several amounts), and those before the amount itself.
 */
export const PRICE_TEXT_REFUSAL_CODES = [
  'instalment', // a financing or pay-later payment: "/mo", "monthly", "bi-weekly", "payments", "/mois"
  'lower_bound', // "From $49.99", "starting at", "as low as": a floor over options, not this one's price
  'per_measure', // "$1.25 /100 g": a unit price, not the item's (S§4.1 unit_price is its own field)
  'range', // "$10.00 - $20.00": two prices joined as a range (S§5.2 variant coupling)
  'several_amounts', // more than one figure: never the first one (S§5.2 multiple_prices)
  'no_amount', // no figure at all ("free shipping", "Free", "")
  'zero', // the figure is zero: a price is never zero
  'mark_mismatch', // the text names a currency other than `currency` ("US$" read as CAD, "$" as EUR)
  'excess_precision', // more non-zero fraction digits than the currency has: never rounded
] as const;
export type PriceTextRefusalCode = (typeof PRICE_TEXT_REFUSAL_CODES)[number];

/**
 * Separators. The last of "." and "," is the decimal point when both occur ("1.234,56",
 * "1,234.56"). With commas only, one comma followed by exactly two digits is a decimal comma
 * ("12,99"); a three-digit tail or several commas are thousands ("1,299", "1,299,000"). With dots
 * only, several dots are thousands ("1.234.567") and a single dot is the decimal point. Spaces,
 * no-break spaces and apostrophes inside a figure are thousands separators. The amount is then
 * scaled exactly as `moneyFromDecimal` does: zero padding beyond the exponent is accepted, a
 * non-zero excess digit is refused.
 */
export type PriceTextResult =
  | { readonly ok: true; readonly money: Money }
  | {
      readonly ok: false;
      readonly refusal: { readonly code: PriceTextRefusalCode; readonly detail: string };
    };

/** The future function. */
export type ParsePriceText = (input: PriceTextInput) => PriceTextResult;

/** What a case expects: the money, or the refusal code (the detail text is free). */
export type PriceTextExpected =
  | { readonly ok: true; readonly money: Money }
  | { readonly ok: false; readonly code: PriceTextRefusalCode };

export interface PriceTextCase extends CaseMeta {
  readonly input: PriceTextInput;
  readonly expected: PriceTextExpected;
}
