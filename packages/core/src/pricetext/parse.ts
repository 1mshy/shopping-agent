// Reads a price as a page, feed or API wrote it into integer minor units, or refuses (S§2.1, S§2.2,
// S§5.2; port map S§7 row 1, predecessor `money.parse_price`). The currency comes in already
// resolved (currency/resolve.ts): there is no default. Nothing is rounded and nothing converted.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import { localeSeparators } from '../currency/locale.ts';
import { minorUnitExponent, moneyFromDecimal } from '../money.ts';
import { normaliseText } from './normalise.ts';
import { type FigureToken, type MarkToken, scan } from './scan.ts';
import { readFigure } from './separators.ts';
import { INSTALMENT, LOWER_BOUND, PER_MEASURE, RANGE_JOINT, UP_TO } from './words.ts';

/**
 * Why a text is not one price. When several apply, the first in this order is reported: the words
 * that say what the money is come before the shape of the figures, and those before the amount.
 * The same list as the corpus contract (evals/corpus/areas/price-text-parsing/contract.ts).
 */
export const PRICE_TEXT_REFUSAL_CODES = [
  'instalment', // a financing or pay-later payment, or a recurring charge: "/mo", "monthly", "payments"
  'lower_bound', // "From $49.99", "starting at", "as low as", "$49+": a floor over options
  'per_measure', // "$1.25 /100 g": a unit price, not the item's (S§4.1 unit_price is its own field)
  'range', // "$10.00 - $20.00", or one end of it ("up to $50") (S§5.2 variant coupling)
  'several_amounts', // more than one figure: never the first one (S§5.2 multiple_prices)
  'no_amount', // no figure at all ("free shipping", "Free", ""), a percentage alone, a figure joined to letters, digits this reader cannot read
  'zero', // the figure is zero, or negative: a price is never zero or below
  'mark_mismatch', // the text names a currency other than the one given ("US$" read as CAD, "$" as EUR)
  'ambiguous_separator', // "1.299 €" with no clear locale, or separators that group nothing
  'excess_precision', // more non-zero fraction digits than the currency has, or more digits than an exact amount can hold
] as const;
export type PriceTextRefusalCode = (typeof PRICE_TEXT_REFUSAL_CODES)[number];

export interface PriceTextInput {
  /** The price as written, spaces of every kind included; a JSON number as its source text. */
  readonly text: string;
  /** The currency already resolved for this figure. It fixes the exponent. */
  readonly currency: MinorUnitCurrency;
  /** The shop's locale (BCP 47); absent when unclear. It decides only a lone separator. */
  readonly locale?: string;
}

export type PriceTextResult =
  | { readonly ok: true; readonly money: Money }
  | {
      readonly ok: false;
      readonly refusal: { readonly code: PriceTextRefusalCode; readonly detail: string };
    };

/** The longest text read. A price display is a few dozen characters; a financing blurb a few hundred. */
export const MAX_PRICE_TEXT_LENGTH = 2000;
const ECHO = 24;

function refuse(code: PriceTextRefusalCode, detail: string): PriceTextResult {
  return { ok: false, refusal: { code, detail } };
}

function show(text: string): string {
  return text.length > ECHO ? `"${text.slice(0, ECHO)}…"` : `"${text}"`;
}

/**
 * The one price a text states, in integer minor units of `currency`, or the reason it states none.
 * Never throws, whatever the input.
 */
export function parsePriceText(input: PriceTextInput): PriceTextResult {
  let rawText: unknown;
  let currency: unknown;
  let locale: unknown;
  try {
    rawText = input.text;
    currency = input.currency;
    locale = input.locale;
  } catch {
    return refuse('no_amount', 'the input could not be read');
  }
  if (typeof rawText !== 'string') return refuse('no_amount', 'no text to read');
  const exponentResult = minorUnitExponent(currency as MinorUnitCurrency);
  if (!exponentResult.ok) {
    return refuse(
      'no_amount',
      `no currency with a minor unit to read it in: ${exponentResult.refusal.detail}`,
    );
  }
  const exponent = exponentResult.value;
  const code = currency as MinorUnitCurrency;
  if (rawText.length > MAX_PRICE_TEXT_LENGTH) {
    return refuse('several_amounts', `text of ${rawText.length} characters is no single price`);
  }

  const { text, foreignDigits } = normaliseText(rawText);
  const lower = text.toLowerCase();
  if (INSTALMENT.test(lower))
    return refuse('instalment', `${show(text)} is a payment, not the price`);
  if (LOWER_BOUND.test(lower))
    return refuse('lower_bound', `${show(text)} is a floor over options`);
  if (PER_MEASURE.test(lower)) return refuse('per_measure', `${show(text)} is a price per measure`);
  if (UP_TO.test(lower)) return refuse('range', `${show(text)} is one end of a range`);
  if (foreignDigits) {
    return refuse(
      'no_amount',
      `${show(text)} holds digits this reader does not read (superscript, fraction or another script)`,
    );
  }

  const { figures, marks } = scan(text);
  if (figures.length >= 2) {
    const [first, second] = figures as [FigureToken, FigureToken];
    if (figures.length === 2 && isRangeJoint(text, first, second, marks)) {
      return refuse('range', `${show(text)} is a range`);
    }
    return refuse('several_amounts', `${show(text)} holds ${figures.length} figures`);
  }
  const figure = figures[0];
  if (figure === undefined) return refuse('no_amount', `${show(text)} holds no figure`);
  if (figure.percent) return refuse('no_amount', `${show(text)} is a percentage, not an amount`);
  if (figure.glued)
    return refuse('no_amount', `${show(text)}: a figure joined to letters is no amount`);
  if (isNegative(text, figure, marks))
    return refuse('zero', `${show(text)} is negative: a price is above zero`);
  if (!/[1-9]/.test(figure.text))
    return refuse('zero', `${show(text)} is zero: a price is never zero`);

  for (const mark of marks) {
    if (!mark.info.compatible.has(code)) {
      return refuse('mark_mismatch', `"${mark.text}" is not ${code}`);
    }
  }
  if (figure.orphanSeparator) {
    return refuse('ambiguous_separator', `${show(text)} starts with a separator`);
  }

  const cents = marks.find((m) => m.info.kind === 'cents');
  if (cents !== undefined) return readCents(text, figure, cents, marks, code, exponent);

  // "1.299,-" and "49.–": a decimal mark followed by a dash says the figure is whole units.
  const dashAfter = /^([.,]) ?-/.exec(text.slice(figure.end));
  const wholeUnits = dashAfter?.[1] === '.' || dashAfter?.[1] === ',' ? dashAfter[1] : null;
  const reading = readFigure(figure.text, exponent, localeSeparators(locale), wholeUnits);
  if (!reading.ok) return refuse('ambiguous_separator', reading.detail);
  return toMoney(reading.decimal, code);
}

function toMoney(decimal: string, currency: MinorUnitCurrency): PriceTextResult {
  const money = moneyFromDecimal(decimal, currency);
  if (money.ok) return { ok: true, money: money.value };
  // excess_precision, or a figure beyond the safe-integer range or the decimal length cap: either
  // way the amount cannot be held exactly, and it is never rounded.
  return refuse('excess_precision', money.refusal.detail);
}

/** "99¢": the figure is already in minor units of a two-decimal dollar currency. */
function readCents(
  text: string,
  figure: FigureToken,
  cents: MarkToken,
  marks: readonly MarkToken[],
  currency: MinorUnitCurrency,
  exponent: number,
): PriceTextResult {
  const besideFigure = text.slice(figure.end, cents.start).trim() === '';
  if (exponent !== 2 || marks.length !== 1 || !besideFigure) {
    return refuse('mark_mismatch', `"¢" cannot be read beside ${show(text)} in ${currency}`);
  }
  if (!/^\d+$/.test(figure.text)) {
    return refuse('excess_precision', `${show(text)}: a fraction of a cent`);
  }
  const digits = figure.text.replace(/^0+(?=\d)/, '').padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  return toMoney(`${whole}.${digits.slice(-2)}`, currency);
}

/** The text between two figures, without marks and spaces, is a dash or a word such as "to". */
function isRangeJoint(
  text: string,
  first: FigureToken,
  second: FigureToken,
  marks: readonly MarkToken[],
): boolean {
  let between = '';
  for (let i = first.end; i < second.start; i += 1) {
    if (!marks.some((m) => i >= m.start && i < m.end)) between += text[i];
  }
  return RANGE_JOINT.test(between.replace(/ /g, '').toLowerCase());
}

/** A dash before the figure, with only marks and spaces between: "-$5.00", "- 5,00 €". */
function isNegative(text: string, figure: FigureToken, marks: readonly MarkToken[]): boolean {
  let i = figure.start - 1;
  while (i >= 0 && (text[i] === ' ' || marks.some((m) => i >= m.start && i < m.end))) i -= 1;
  return text[i] === '-';
}
