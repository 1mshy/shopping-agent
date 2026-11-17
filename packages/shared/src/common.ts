// Building blocks shared by the domain contracts.
//
// Casing rule: TypeScript keys are the camelCase of the S§4 snake_case names (`url_canonical` →
// `urlCanonical`, `*_json` drops the suffix). The one exception is an OpenTelemetry GenAI
// attribute, which keeps its registered dotted name verbatim (`gen_ai.request.model`).
// Every contract object is strict: an unknown key is refused, never silently dropped.
import { z } from 'zod';
import { MinorUnitCurrency } from './currency.ts';

/** A row id (SQLite INTEGER PRIMARY KEY). */
export const Id = z.int().positive();
export type Id = z.infer<typeof Id>;

/**
 * A UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ` with exactly three fractional digits (S§4), the form
 * `Date.prototype.toISOString` writes. One fixed width makes text order time order, so SQLite sorts
 * these strings correctly. Offsets, local times and other precisions are refused.
 */
export const Timestamp = z.iso.datetime({ precision: 3 });
export type Timestamp = z.infer<typeof Timestamp>;

/** True when `b` is not earlier than `a`. */
export function notBefore(a: Timestamp, b: Timestamp): boolean {
  return Date.parse(b) >= Date.parse(a);
}

/** A non-negative amount in integer minor units of a currency the record states once (S§2.2). */
export const AmountMinor = z.int().nonnegative();

/**
 * Model spend: integer nano-units (10^-9) of the major unit of an explicit currency (S§4.4). A
 * fast-mode cap of $0.03 is 30,000,000; one token at $0.075 per million is exactly 75. Minor units
 * (cents) cannot hold a $0.0004 judge call. A provider-reported cost is read from its decimal text
 * exactly, never through a float, and any digit beyond the ninth decimal rounds the amount up, so a
 * spend cap is never under-counted.
 */
export const NanoMoney = z.strictObject({
  amountNanos: z.int().nonnegative(),
  currency: MinorUnitCurrency,
});
export type NanoMoney = z.infer<typeof NanoMoney>;

/** A version label for a matcher or a prompt (S§5.4, S§5.7). */
export const Version = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

/** A product attribute name (`capacity`, `pack_count`): lower-case letters and underscores. */
export const AttributeName = z.string().regex(/^[a-z][a-z_]{0,39}$/);

const PRICE_WORDS = /price|budget|cost|discount|deal|sale/;

/**
 * An attribute name in model output. Names that denote a price or a budget are refused. This is a
 * second line, not the guarantee: what keeps a model's figure out of the record is that no field
 * of model output is ever parsed into an amount, a total or a date (S§2.1).
 */
export const ModelAttributeName = AttributeName.refine(
  (name) => !PRICE_WORDS.test(name),
  'an attribute named for a price or a budget is not model output (S§2.1)',
);

/**
 * Text a model writes: search input (names, attribute values, query variants) matched against
 * listings as text. It is never parsed into a figure and never shown as a price, a total or a date;
 * a budget comes only from the user's input, through code (S§2.1). Currency symbols and the percent
 * and per-mille signs are refused as a second line, not the guarantee: "300 dollars" passes.
 */
export function modelText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Sc}%％٪﹪‰]*$/u, 'no currency, percent or per-mille sign in model text');
}

/** A string as a store writes it (a variant key such as "Size" or "option1"): trimmed, bounded. */
export const StoreText = z.string().regex(/^\S(?:.{0,98}\S)?$/);

function gtinCheckDigitHolds(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (digits.charCodeAt(i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(13) - 48;
}

/** A GTIN normalised to 14 digits with a valid GS1 check digit, not all zero (S§4.1, S§5.4). */
export const Gtin14 = z
  .string()
  .regex(/^[0-9]{14}$/)
  .refine((digits) => digits !== '00000000000000', 'an all-zero GTIN identifies nothing')
  .refine(gtinCheckDigitHolds, 'GTIN check digit does not hold');

/** An array whose items are distinct. */
export function distinct<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((items) => new Set(items).size === items.length, 'items must be distinct');
}
