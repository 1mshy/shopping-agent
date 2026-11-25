// GTIN handling for tier 1 (S§5.4: "GTIN equality (check digit validated, normalised to 14
// digits)"). A page's GTIN is read, never trusted: one that fails its check digit identifies nothing.

/** True when the 14-digit string's last digit is its GS1 mod-10 check digit. */
export function gtinCheckDigitHolds(digits14: string): boolean {
  if (!/^[0-9]{14}$/.test(digits14)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (digits14.charCodeAt(i) - 48) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === digits14.charCodeAt(13) - 48;
}

/**
 * A GTIN-8, -12 (UPC-A), -13 (EAN) or -14 as read (spaces and dashes allowed), normalised to 14
 * digits with leading zeros. Null when the length is not one of those, the check digit fails, or
 * every digit is zero.
 */
export function normaliseGtin(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(digits)) return null;
  const g14 = digits.padStart(14, '0');
  if (/^0+$/.test(g14)) return null;
  return gtinCheckDigitHolds(g14) ? g14 : null;
}
