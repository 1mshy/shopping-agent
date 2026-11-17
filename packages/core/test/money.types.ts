// Compile-time checks for the money API (checked by `tsc` only, not a Vitest file).
// S§2.2: there is no default currency, so a currency can never be left out.
import type { Money } from '@agentic-dasher/shared';
import { addMoney, moneyFromDecimal, moneyToDecimal } from '../src/index.ts';

// @ts-expect-error the currency is required
moneyFromDecimal('12.99');
// @ts-expect-error the currency is required
moneyToDecimal({ amountMinor: 1299 });
// @ts-expect-error a currency is a code, not any string
moneyFromDecimal('12.99', 'usd');

// @ts-expect-error Money has no `unknown` currency: it has no exponent
export const unknownMoney: Money = { amountMinor: 1, currency: 'unknown' };
// @ts-expect-error Money has no currency without a minor unit
export const gold: Money = { amountMinor: 1, currency: 'XAU' };
// @ts-expect-error Money needs its currency
export const bare: Money = { amountMinor: 1 };

// Accepted by the types, refused at run time with a typed refusal (see money.test.ts).
moneyFromDecimal('12.99', 'unknown');
moneyToDecimal({ amountMinor: 1299, currency: 'unknown' });
addMoney({ amountMinor: 1, currency: 'USD' }, { amountMinor: 1, currency: 'EUR' });
