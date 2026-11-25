// Money on screen (S§2 invariants 1 and 2). Amounts arrive as integer minor units with their
// currency; this module only formats them and turns typed text into minor units by string
// handling. It never converts between currencies, never sums across them, and never multiplies a
// float to get minor units.

/** The minor-unit exponent of a currency as Intl knows it (EUR 2, JPY 0, KWD 3); null if unknown. */
export function exponentOf(currency: string): number | null {
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' ? digits : null;
  } catch {
    return null;
  }
}

/** Integer minor units as an exact decimal string: 1999 with exponent 2 is "19.99". */
export function minorToDecimal(amountMinor: number, exponent: number): string {
  const negative = amountMinor < 0;
  const digits = String(Math.abs(Math.trunc(amountMinor)));
  if (exponent === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Format an amount with its currency for display. The decimal string goes to Intl as a string, so
 * no float rounding happens on the way. An unusable currency still shows the code beside the
 * minor units, never a bare number.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: string | undefined = undefined,
): string {
  const exponent = exponentOf(currency);
  if (exponent === null) return `${amountMinor} (minor units, ${currency})`;
  const decimal = minorToDecimal(amountMinor, exponent);
  try {
    const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    return format.format(decimal as Intl.StringNumericLiteral);
  } catch {
    return `${decimal} ${currency}`;
  }
}

/**
 * Typed text to integer minor units: digits, optionally one decimal separator ('.' or ',') and at
 * most `exponent` fraction digits. No grouping separators, no sign, no exponent notation. Returns
 * null for anything that cannot be read exactly (the caller refuses it).
 */
export function parseAmount(text: string, exponent: number): number | null {
  const s = text.trim();
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(s);
  if (match === null) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) return null;
  const digits = (whole + fraction.padEnd(exponent, '0')).replace(/^0+(?=\d)/, '');
  const value = Number(digits);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Basis points to a percent string: 500 is "5", 525 is "5.25". Integer arithmetic only. */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const rest = Math.abs(bp % 100);
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** A percent string with at most two decimals to basis points; null when it cannot be read. */
export function percentToBasisPoints(text: string): number | null {
  return parseAmount(text, 2);
}
