// Exact money arithmetic over integer minor units (S§2.1, S§2.2, S§2.10).
// No floating point touches an amount: decimals are read as digit strings and checked with BigInt
// before they become a Number, and every result stays inside the safe-integer range or is refused.
// Every function takes its currency explicitly; nothing converts between currencies.
import {
  type Currency,
  ISO_MINOR_UNITS,
  type IsoCurrencyCode,
  type MinorUnitCurrency,
  type Money,
} from '@agentic-dasher/shared';

export const MONEY_REFUSAL_CODES = [
  /** The currency is the explicit value `unknown`: it has no exponent. */
  'unknown_currency',
  /** An ISO code whose minor unit is "N.A." (XAU, XDR, XXX, ...). */
  'no_minor_unit',
  /** Not an ISO 4217 code or `unknown`. */
  'not_a_currency',
  /** Not a canonical machine decimal string. */
  'malformed_decimal',
  /** More non-zero fraction digits than the currency has; refused, never rounded. */
  'excess_precision',
  /** The amount in minor units would leave the safe-integer range. */
  'out_of_range',
  /** An amount that is not a safe integer. */
  'not_safe_integer',
  /** Two amounts in different currencies; they are never converted. */
  'currency_mismatch',
] as const;
export type MoneyRefusalCode = (typeof MONEY_REFUSAL_CODES)[number];

export type MoneyRefusal = { readonly code: MoneyRefusalCode; readonly detail: string };
export type MoneyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: MoneyRefusal };

/** An amount whose currency has not been checked yet (a database row, a JSON body). */
export type UncheckedMoney = { readonly amountMinor: number; readonly currency: Currency };

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
// Optional minus, an integer part without leading zeros, an optional non-empty fraction. ASCII only.
const CANONICAL_DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function ok<T>(value: T): MoneyResult<T> {
  return { ok: true, value };
}

function refuse(code: MoneyRefusalCode, detail: string): { ok: false; refusal: MoneyRefusal } {
  return { ok: false, refusal: { code, detail } };
}

function hasMinorUnits(code: IsoCurrencyCode): code is MinorUnitCurrency {
  return ISO_MINOR_UNITS[code] !== null;
}

function resolve(currency: Currency): MoneyResult<MinorUnitCurrency> {
  if (currency === 'unknown') return refuse('unknown_currency', 'unknown currency has no exponent');
  // Run-time check too: a database row or a JSON body can carry any string.
  if (typeof currency !== 'string' || !Object.hasOwn(ISO_MINOR_UNITS, currency)) {
    return refuse('not_a_currency', `not an ISO 4217 code: ${String(currency)}`);
  }
  if (!hasMinorUnits(currency)) {
    return refuse('no_minor_unit', `${currency} has no ISO 4217 minor unit`);
  }
  return ok(currency);
}

/** The ISO 4217 minor-unit exponent of a currency, or a refusal. Never a guess. */
export function minorUnitExponent(currency: Currency): MoneyResult<number> {
  const resolved = resolve(currency);
  return resolved.ok ? ok(ISO_MINOR_UNITS[resolved.value]) : resolved;
}

/** Checks an amount and its currency, returning them as Money. */
function check(money: UncheckedMoney): MoneyResult<Money> {
  const currency = resolve(money.currency);
  if (!currency.ok) return currency;
  if (!Number.isSafeInteger(money.amountMinor)) {
    return refuse('not_safe_integer', `amount is not a safe integer: ${String(money.amountMinor)}`);
  }
  return ok({ amountMinor: money.amountMinor, currency: currency.value });
}

function fromBigInt(amount: bigint, currency: MinorUnitCurrency): MoneyResult<Money> {
  if (amount > MAX || amount < -MAX) {
    return refuse('out_of_range', `${amount} ${currency} minor units is beyond the safe range`);
  }
  const amountMinor = Number(amount);
  return ok({ amountMinor: amountMinor === 0 ? 0 : amountMinor, currency });
}

/**
 * Reads a canonical machine decimal ("1299", "1299.00", "0.5", "-12.34") as minor units of the
 * given currency. Fraction digits beyond the exponent are accepted only when they are all zero
 * (no value is lost); otherwise the input is refused, never rounded. Page text such as
 * "1.299,00 €" or "$1,299" is not a canonical decimal and is refused.
 */
export function moneyFromDecimal(decimal: string, currency: Currency): MoneyResult<Money> {
  const resolved = resolve(currency);
  if (!resolved.ok) return resolved;
  const e = ISO_MINOR_UNITS[resolved.value];
  const match = typeof decimal === 'string' ? CANONICAL_DECIMAL.exec(decimal) : null;
  if (!match) return refuse('malformed_decimal', `not a canonical decimal: ${String(decimal)}`);
  const [, sign = '', whole = '', fraction = ''] = match;
  if (/[^0]/.test(fraction.slice(e))) {
    return refuse(
      'excess_precision',
      `${decimal} has more than ${e} fraction digits for ${currency}`,
    );
  }
  const magnitude = BigInt(whole + fraction.slice(0, e).padEnd(e, '0'));
  return fromBigInt(sign === '-' ? -magnitude : magnitude, resolved.value);
}

/** Writes minor units as a canonical decimal with exactly the currency's exponent of digits. */
export function moneyToDecimal(money: UncheckedMoney): MoneyResult<string> {
  const checked = check(money);
  if (!checked.ok) return checked;
  const e = ISO_MINOR_UNITS[checked.value.currency];
  const sign = checked.value.amountMinor < 0 ? '-' : '';
  const digits = String(Math.abs(checked.value.amountMinor));
  if (e === 0) return ok(sign + digits);
  const padded = digits.padStart(e + 1, '0');
  return ok(`${sign}${padded.slice(0, -e)}.${padded.slice(-e)}`);
}

function checkPair(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<readonly [Money, Money]> {
  const left = check(a);
  if (!left.ok) return left;
  const right = check(b);
  if (!right.ok) return right;
  if (left.value.currency !== right.value.currency) {
    return refuse(
      'currency_mismatch',
      `${left.value.currency} and ${right.value.currency} are different currencies`,
    );
  }
  return ok([left.value, right.value]);
}

/** Orders two amounts of the same currency: -1, 0 or 1. Different currencies are refused. */
export function compareMoney(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<-1 | 0 | 1> {
  const pair = checkPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return ok(x.amountMinor < y.amountMinor ? -1 : x.amountMinor > y.amountMinor ? 1 : 0);
}

/** a + b in the same currency, refused if the result leaves the safe-integer range. */
export function addMoney(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<Money> {
  const pair = checkPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return fromBigInt(BigInt(x.amountMinor) + BigInt(y.amountMinor), x.currency);
}

/** a - b in the same currency, refused if the result leaves the safe-integer range. */
export function subtractMoney(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<Money> {
  const pair = checkPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return fromBigInt(BigInt(x.amountMinor) - BigInt(y.amountMinor), x.currency);
}
