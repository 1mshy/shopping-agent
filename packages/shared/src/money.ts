import { z } from 'zod';
import { MinorUnitCurrency } from './currency.ts';

/**
 * An amount of money: integer minor units of an explicit currency (S§2.2). The amount is a safe
 * integer and may be negative (differences, discounts). The currency is required and has a
 * minor-unit exponent, so `unknown` and codes without a minor unit (XAU, XDR, XXX, ...) are not
 * Money: an amount in minor units means nothing without an exponent. Functions live in
 * `@agentic-dasher/core`.
 */
export const Money = z.object({
  amountMinor: z.int(),
  currency: MinorUnitCurrency,
});
export type Money = z.infer<typeof Money>;
