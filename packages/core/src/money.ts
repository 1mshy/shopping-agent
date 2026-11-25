// Exact money arithmetic over integer minor units (S§2.1, S§2.2, S§2.10).
// No floating point touches an amount: decimals are read as digit strings and checked with BigInt
// before they become a Number, and every result stays inside the safe-integer range or is refused.
// Every function takes its currency explicitly; nothing converts between currencies.
//
// The parameter types describe correct use, but the inputs come from database rows, JSON bodies
// and, later, page-derived data (S§2.7). So every public function checks its inputs at run time,
// reads each field exactly once, and returns a refusal for any input: it never throws.
import {
  type Currency,
  hasMinorUnits,
  ISO_MINOR_UNITS,
  type IsoCurrencyCode,
  type MinorUnitCurrency,
  type MinorUnitExponent,
  type Money,
  UNKNOWN_CURRENCY,
} from '@agentic-dasher/shared';

export const MONEY_REFUSAL_CODES = [
  'not_money', // Not an object whose amountMinor and currency fields can be read.
  'unknown_currency', // The currency is the explicit value `unknown`: it has no exponent.
  'no_minor_unit', // An ISO code whose minor unit is "N.A." (XAU, XDR, XXX, ...).
  'not_a_currency', // Not an ISO 4217 code or `unknown`.
  'malformed_decimal', // Not a canonical machine decimal string, or longer than the cap.
  'excess_precision', // More non-zero fraction digits than the currency has; never rounded.
  'out_of_range', // The amount in minor units would leave the safe-integer range.
  'not_safe_integer', // An amount that is not a safe integer.
  'currency_mismatch', // Two amounts in different currencies; they are never converted.
  'invalid_percentage', // Basis points that are not an integer from 0 to 10,000.
  'negative_amount', // A price below zero where only a price makes sense.
] as const;
export type MoneyRefusalCode = (typeof MONEY_REFUSAL_CODES)[number];

export type MoneyRefusal = { readonly code: MoneyRefusalCode; readonly detail: string };
export type MoneyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: MoneyRefusal };

/** An amount whose currency has not been checked yet (a database row, a JSON body). */
export type UncheckedMoney = { readonly amountMinor: number; readonly currency: Currency };

/**
 * The longest decimal string read. The longest canonical decimal with a value in the safe range is
 * 18 characters ("-900719925474.0991"); 64 leaves room for zero padding and bounds the BigInt work.
 */
export const MAX_DECIMAL_LENGTH = 64;
/** Input echoed into a refusal's detail is cut to this many characters. */
const ECHO_LENGTH = 24;

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
// Optional minus, an integer part without leading zeros, an optional non-empty fraction. ASCII only.
const CANONICAL_DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function ok<T>(value: T): MoneyResult<T> {
  return { ok: true, value };
}

function refuse(code: MoneyRefusalCode, detail: string): { ok: false; refusal: MoneyRefusal } {
  return { ok: false, refusal: { code, detail } };
}

/** A short description of any value for a refusal detail. Cannot throw; never echoes much. */
function show(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value.length > ECHO_LENGTH
        ? `"${value.slice(0, ECHO_LENGTH)}…" (${value.length} characters)`
        : `"${value}"`;
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value);
    default:
      return value === null ? 'null' : `a ${typeof value}`;
  }
}

function isIsoCode(code: string): code is IsoCurrencyCode {
  return Object.hasOwn(ISO_MINOR_UNITS, code);
}

function resolve(currency: unknown): MoneyResult<MinorUnitCurrency> {
  if (typeof currency !== 'string') {
    return refuse('not_a_currency', `not an ISO 4217 code: ${show(currency)}`);
  }
  if (currency === UNKNOWN_CURRENCY) {
    return refuse('unknown_currency', 'unknown currency has no exponent');
  }
  if (!isIsoCode(currency)) {
    return refuse('not_a_currency', `not an ISO 4217 code: ${show(currency)}`);
  }
  if (!hasMinorUnits(currency)) {
    return refuse('no_minor_unit', `${currency} has no ISO 4217 minor unit`);
  }
  return ok(currency);
}

/** The ISO 4217 minor-unit exponent of a currency, or a refusal. Never a guess. */
export function minorUnitExponent(currency: Currency): MoneyResult<MinorUnitExponent> {
  const resolved = resolve(currency);
  return resolved.ok ? ok(ISO_MINOR_UNITS[resolved.value]) : resolved;
}

/** Reads each field once into a local, checks the locals, and builds Money from them only. */
function read(money: unknown): MoneyResult<Money> {
  if (typeof money !== 'object' || money === null) {
    return refuse('not_money', `expected an object with amountMinor and currency: ${show(money)}`);
  }
  let amountMinor: unknown;
  let currency: unknown;
  try {
    const fields = money as Record<string, unknown>;
    amountMinor = fields.amountMinor;
    currency = fields.currency;
  } catch {
    return refuse('not_money', 'its amountMinor or currency field could not be read');
  }
  const resolved = resolve(currency);
  if (!resolved.ok) return resolved;
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor)) {
    return refuse('not_safe_integer', `amount is not a safe integer: ${show(amountMinor)}`);
  }
  return ok({ amountMinor, currency: resolved.value });
}

function fromBigInt(amount: bigint, currency: MinorUnitCurrency): MoneyResult<Money> {
  if (amount > MAX || amount < -MAX) {
    return refuse('out_of_range', `the amount in ${currency} minor units is beyond the safe range`);
  }
  return ok({ amountMinor: Number(amount), currency });
}

/**
 * Reads a canonical machine decimal ("1299", "1299.00", "0.5", "-12.34") as minor units of the
 * given currency.
 *
 * Fraction digits beyond the currency's exponent are accepted only when they are all zero, because
 * no value is lost: "1299.00" JPY is 1299 and "12.990" USD is 1299. A non-zero excess digit
 * ("1.005" USD, "1299.5" JPY) is refused, never rounded. Strings longer than MAX_DECIMAL_LENGTH
 * are refused before any parsing. Page text such as "1.299,00 €" or "$1,299" is not a canonical
 * decimal and is refused.
 */
export function moneyFromDecimal(decimal: string, currency: Currency): MoneyResult<Money> {
  const resolved = resolve(currency);
  if (!resolved.ok) return resolved;
  const e = ISO_MINOR_UNITS[resolved.value];
  if (typeof decimal !== 'string') {
    return refuse('malformed_decimal', `not a string: ${show(decimal)}`);
  }
  if (decimal.length > MAX_DECIMAL_LENGTH) {
    return refuse(
      'malformed_decimal',
      `longer than ${MAX_DECIMAL_LENGTH} characters: ${show(decimal)}`,
    );
  }
  const match = CANONICAL_DECIMAL.exec(decimal);
  if (!match) return refuse('malformed_decimal', `not a canonical decimal: ${show(decimal)}`);
  const [, sign = '', whole = '', fraction = ''] = match;
  if (/[^0]/.test(fraction.slice(e))) {
    return refuse(
      'excess_precision',
      `${show(decimal)} has more than ${e} fraction digits for ${resolved.value}`,
    );
  }
  const magnitude = BigInt(whole + fraction.slice(0, e).padEnd(e, '0'));
  return fromBigInt(sign === '-' ? -magnitude : magnitude, resolved.value);
}

/** Writes minor units as a canonical decimal with exactly the currency's exponent of digits. */
export function moneyToDecimal(money: UncheckedMoney): MoneyResult<string> {
  const checked = read(money);
  if (!checked.ok) return checked;
  const { amountMinor, currency } = checked.value;
  const e = ISO_MINOR_UNITS[currency];
  const sign = amountMinor < 0 ? '-' : '';
  const digits = String(Math.abs(amountMinor));
  if (e === 0) return ok(sign + digits);
  const padded = digits.padStart(e + 1, '0');
  return ok(`${sign}${padded.slice(0, -e)}.${padded.slice(-e)}`);
}

function readPair(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<readonly [Money, Money]> {
  const left = read(a);
  if (!left.ok) return left;
  const right = read(b);
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
  const pair = readPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return ok(x.amountMinor < y.amountMinor ? -1 : x.amountMinor > y.amountMinor ? 1 : 0);
}

/** a + b in the same currency, refused if the result leaves the safe-integer range. */
export function addMoney(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<Money> {
  const pair = readPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return fromBigInt(BigInt(x.amountMinor) + BigInt(y.amountMinor), x.currency);
}

/** a - b in the same currency, refused if the result leaves the safe-integer range. */
export function subtractMoney(a: UncheckedMoney, b: UncheckedMoney): MoneyResult<Money> {
  const pair = readPair(a, b);
  if (!pair.ok) return pair;
  const [x, y] = pair.value;
  return fromBigInt(BigInt(x.amountMinor) - BigInt(y.amountMinor), x.currency);
}

/**
 * The price left after a percentage comes off: price × (10,000 − basisPoints) / 10,000, rounded
 * half up to the minor unit (S§5.5: a percentage coupon's amount is rounded half up; settled by
 * the orchestrator 2026-11-23). 20% is 2000 basis points. Exact BigInt arithmetic; the price must
 * not be negative, and the basis points are an integer from 0 to 10,000.
 */
export function priceAfterPercentOff(
  price: UncheckedMoney,
  basisPoints: number,
): MoneyResult<Money> {
  const checked = read(price);
  if (!checked.ok) return checked;
  if (typeof basisPoints !== 'number' || !Number.isInteger(basisPoints)) {
    return refuse('invalid_percentage', `basis points must be an integer: ${show(basisPoints)}`);
  }
  if (basisPoints < 0 || basisPoints > 10_000) {
    return refuse(
      'invalid_percentage',
      `basis points must be from 0 to 10000: ${show(basisPoints)}`,
    );
  }
  const { amountMinor, currency } = checked.value;
  if (amountMinor < 0) return refuse('negative_amount', `a price below zero: ${amountMinor}`);
  const scaled = BigInt(amountMinor) * BigInt(10_000 - basisPoints);
  return fromBigInt((scaled + 5_000n) / 10_000n, currency);
}
