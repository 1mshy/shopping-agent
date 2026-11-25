// A figure read from structured data → integer minor units of the currency it is in, or the reason
// it is not one price. Everything goes through packages/core: `resolveCurrency` (S§5.2 order, no
// default currency, converted figures refused) and `parsePriceText` (no float, no rounding).
import {
  moneyFromDecimal,
  type PriceTextRefusalCode,
  parsePriceText,
  resolveCurrency,
} from '@agentic-dasher/core';
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import type { JsonValue } from './json.ts';
import { JsonNumber } from './json.ts';
import type { PageContext } from './page.ts';

/** A schema.org machine value: digits with an optional dot and fraction ("249", "18.99"). */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** How a price-like property was written. */
export type FigureText =
  | { readonly kind: 'none' }
  | { readonly kind: 'text'; readonly text: string }
  /** Present but not a figure: an object, a list, a boolean, or a JSON number in exponent form. */
  | { readonly kind: 'invalid'; readonly shown: string | null };

export function figureText(value: JsonValue | undefined): FigureText {
  if (value === undefined || value === null) return { kind: 'none' };
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? { kind: 'none' } : { kind: 'text', text: t };
  }
  if (value instanceof JsonNumber) {
    // A JSON number's digits are the figure, as long as they are a plain decimal (no sign, no
    // exponent): "249" and "18.99" are read, "2.49e2" and "-5" are refused.
    return PLAIN_DECIMAL.test(value.text)
      ? { kind: 'text', text: value.text }
      : { kind: 'invalid', shown: value.text };
  }
  return { kind: 'invalid', shown: null };
}

export type PriceRead =
  | { readonly kind: 'amount'; readonly currency: MinorUnitCurrency; readonly minor: number }
  /** No currency could be established: the amount stays text (S§2.2). */
  | { readonly kind: 'unknown_currency' }
  | {
      readonly kind: 'refused';
      readonly reason: 'converted_currency' | 'unreadable_price' | 'multiple_prices';
      readonly detail: string;
    };

const NOT_ONE_PRICE: ReadonlySet<PriceTextRefusalCode> = new Set([
  'range',
  'lower_bound',
  'several_amounts',
]);

/**
 * Reads one price figure. `declared` is the currency the markup states beside it (schema.org
 * `priceCurrency`, OpenGraph `product:price:currency`), as written.
 */
export function readPrice(text: string, declared: string | null, ctx: PageContext): PriceRead {
  const resolution = resolveCurrency({
    host: ctx.host,
    platform: null,
    priceCurrency: declared,
    locale: ctx.currencyLocale,
    storeCountry: ctx.storeCountry,
    priceText: text,
  });
  if (!resolution.ok) {
    if (resolution.refusal.code === 'converted') {
      return { kind: 'refused', reason: 'converted_currency', detail: resolution.refusal.detail };
    }
    // unknown_currency, not_a_listing_currency, conflict: nothing establishes one currency. The
    // figure is kept as text, if it looks like one figure at all.
    if (!/[1-9]/.test(text) || !/^\D*\d[\d.,'\s ]*\D*$/.test(text)) {
      return {
        kind: 'refused',
        reason: 'unreadable_price',
        detail: `"${short(text)}" is no figure`,
      };
    }
    return { kind: 'unknown_currency' };
  }
  // A machine value is read with no locale: schema.org writes a decimal dot, and "1.299" there is
  // refused as ambiguous rather than read as 1299 on a German page. Display text uses the locale.
  const parsed = parsePriceText({
    text,
    currency: resolution.currency,
    locale: PLAIN_DECIMAL.test(text) ? undefined : ctx.parseLocale,
  });
  if (parsed.ok) {
    return { kind: 'amount', currency: resolution.currency, minor: parsed.money.amountMinor };
  }
  const { code, detail } = parsed.refusal;
  if (code === 'mark_mismatch') return { kind: 'refused', reason: 'converted_currency', detail };
  if (NOT_ONE_PRICE.has(code)) return { kind: 'refused', reason: 'multiple_prices', detail };
  return { kind: 'refused', reason: 'unreadable_price', detail };
}

/**
 * An amount in a currency already established for the read (a struck price, a shipping rate).
 * Null when it does not read. `allowZero` is for shipping, where 0 means free.
 */
export function readAmountIn(
  text: string,
  currency: MinorUnitCurrency,
  ctx: PageContext,
  allowZero: boolean,
): number | null {
  if (allowZero && /^0+(?:\.0+)?$/.test(text)) {
    const zero = moneyFromDecimal('0', currency);
    return zero.ok ? zero.value.amountMinor : null;
  }
  const parsed = parsePriceText({
    text,
    currency,
    locale: PLAIN_DECIMAL.test(text) ? undefined : ctx.parseLocale,
  });
  return parsed.ok ? parsed.money.amountMinor : null;
}

/** A comparable key for a figure whose currency is unknown: its text without spaces. */
export function textKey(text: string): string {
  return text.replace(/\s+/g, '');
}

function short(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}
