import { z } from 'zod';
import { ISO_CURRENCY_CODES, ISO_MINOR_UNITS } from './currency-table.ts';

export {
  ISO_4217_LIST_ONE,
  ISO_CURRENCY_CODES,
  ISO_FUND_CODES,
  ISO_MINOR_UNITS,
} from './currency-table.ts';

/** An active ISO 4217 alphabetic code (S§2.2). */
export const IsoCurrencyCode = z.enum(ISO_CURRENCY_CODES);
export type IsoCurrencyCode = z.infer<typeof IsoCurrencyCode>;

/** The explicit value for a currency the engine could not establish (S§2.2, S§2.10). */
export const UNKNOWN_CURRENCY = 'unknown';

/** Every ISO 4217 code plus `unknown`. There is no default currency anywhere (S§2.2). */
export const CURRENCIES = [...ISO_CURRENCY_CODES, UNKNOWN_CURRENCY] as const;
export const Currency = z.enum(CURRENCIES);
export type Currency = z.infer<typeof Currency>;

type MinorUnits = typeof ISO_MINOR_UNITS;

/** An ISO code with a minor-unit exponent: the only currencies an amount in minor units can have. */
export type MinorUnitCurrency = {
  [K in IsoCurrencyCode]: MinorUnits[K] extends number ? K : never;
}[IsoCurrencyCode];

/** The exponents that occur in the table. */
export type MinorUnitExponent = MinorUnits[MinorUnitCurrency];

/** True when the ISO 4217 list gives the code a minor unit (it is not "N.A."). */
export function hasMinorUnits(code: IsoCurrencyCode): code is MinorUnitCurrency {
  return ISO_MINOR_UNITS[code] !== null;
}

export const MINOR_UNIT_CURRENCIES: readonly MinorUnitCurrency[] =
  ISO_CURRENCY_CODES.filter(hasMinorUnits);
export const MinorUnitCurrency = z.enum(MINOR_UNIT_CURRENCIES);

/**
 * The currency a listing or a price observation may carry (S§2.2, S§4.1): an ISO code with a
 * minor unit, or `unknown`. XXX, XTS, the metals, the bond-market units, XDR, XSU and XUA are
 * refused, so they can be neither a second way to say "unknown" nor a wrong resolution that
 * validates. Open point: fund codes (ISO_FUND_CODES, e.g. CLF, USN) are still accepted.
 */
export const LISTING_CURRENCIES = [...MINOR_UNIT_CURRENCIES, UNKNOWN_CURRENCY] as const;
export const ListingCurrency = z.enum(LISTING_CURRENCIES);
export type ListingCurrency = z.infer<typeof ListingCurrency>;
