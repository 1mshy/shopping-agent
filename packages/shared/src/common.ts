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

/** A UTC instant as an ISO 8601 string ending in `Z` (S§4). Offsets and local times are refused. */
export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;

/** A non-negative amount in integer minor units of a currency the record states once (S§2.2). */
export const AmountMinor = z.int().nonnegative();

/**
 * Model spend: integer nano-units (10^-9) of the major unit of an explicit currency. A fast-mode
 * cap of $0.03 is 30,000,000; one token at $0.075 per million is exactly 75. Minor units (cents)
 * cannot hold a $0.0004 judge call.
 */
export const NanoMoney = z.strictObject({
  amountNanos: z.int().nonnegative(),
  currency: MinorUnitCurrency,
});
export type NanoMoney = z.infer<typeof NanoMoney>;

/** A version label for a matcher or a prompt (S§5.4, S§5.7). */
export const Version = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);

/** A product attribute name (`capacity`, `pack_count`): letters and underscores, so no figure fits. */
export const AttributeName = z.string().regex(/^[a-z][a-z_]{0,39}$/);

/**
 * Text a model writes into a stored record. Currency symbols and percent signs are refused, so a
 * price or a percentage cannot ride in it (S§2.1).
 */
export function modelText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Sc}%]*$/u, 'no currency symbol or percent sign in model text (S§2.1)');
}

function gtinCheckDigitHolds(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (digits.charCodeAt(i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(13) - 48;
}

/** A GTIN normalised to 14 digits with a valid GS1 check digit (S§4.1 product.gtin14, S§5.4). */
export const Gtin14 = z
  .string()
  .regex(/^[0-9]{14}$/)
  .refine(gtinCheckDigitHolds, 'GTIN check digit does not hold');

/** An array whose items are distinct. */
export function distinct<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((items) => new Set(items).size === items.length, 'items must be distinct');
}
