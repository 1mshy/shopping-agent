// Currency marks as pages write them beside a figure (S§5.2: "an explicit mark on the figure (an
// ISO code, a qualified dollar sign, €, £)"). An explicit mark names one currency. A family mark
// ("$", "¥", "kr") names a family of currencies and never decides one on its own: S§5.2 gives a
// bare "$" the store's country. Each mark also lists the currencies a figure written with it may
// be in, so "$12" is never read as euros and "US$" never as Canadian dollars.
import { ISO_MINOR_UNITS } from '@agentic-dasher/shared';

export type MarkKind = 'explicit' | 'family' | 'cents';

export interface MarkInfo {
  readonly kind: MarkKind;
  /** The currency an explicit mark names (any ISO 4217 code, even one with no minor unit). */
  readonly names: string | null;
  /** Every currency a figure written with this mark may be in. */
  readonly compatible: ReadonlySet<string>;
}

const explicit = (code: string, ...also: string[]): MarkInfo => ({
  kind: 'explicit',
  names: code,
  compatible: new Set([code, ...also]),
});
const family = (...codes: string[]): MarkInfo => ({
  kind: 'family',
  names: null,
  compatible: new Set(codes),
});

/** Every currency whose own sign is a bare "$". */
export const DOLLAR_FAMILY = family(
  'USD',
  'CAD',
  'AUD',
  'NZD',
  'SGD',
  'HKD',
  'TWD',
  'MXN',
  'ARS',
  'CLP',
  'COP',
  'CUP',
  'DOP',
  'UYU',
  'BSD',
  'BBD',
  'BZD',
  'BMD',
  'BND',
  'FJD',
  'GYD',
  'JMD',
  'KYD',
  'LRD',
  'NAD',
  'SBD',
  'SRD',
  'TTD',
  'XCD',
);
const RUPEE_FAMILY = family('INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR');

/** Single-character signs. "$" is handled with its qualifiers. */
export const GLYPH_MARKS: Readonly<Record<string, MarkInfo>> = {
  '€': explicit('EUR'),
  '£': explicit('GBP', 'GIP', 'FKP', 'SHP'),
  '¥': family('JPY', 'CNY'),
  円: explicit('JPY'),
  '₹': explicit('INR'),
  '₩': explicit('KRW', 'KPW'),
  '₽': explicit('RUB'),
  '₺': explicit('TRY'),
  '₪': explicit('ILS'),
  '₫': explicit('VND'),
  '฿': explicit('THB'),
  '₱': explicit('PHP'),
  '₦': explicit('NGN'),
  '₴': explicit('UAH'),
  '₸': explicit('KZT'),
  '₼': explicit('AZN'),
  '₾': explicit('GEL'),
  '₡': explicit('CRC'),
  '₲': explicit('PYG'),
  '₵': explicit('GHS'),
  '₭': explicit('LAK'),
  '₮': explicit('MNT'),
  '៛': explicit('KHR'),
  '₨': RUPEE_FAMILY,
  '¢': { kind: 'cents', names: null, compatible: DOLLAR_FAMILY.compatible },
};

/** The glyphs, for "is this character a currency sign". */
export const SIGN_CHARACTERS = new Set(['$', ...Object.keys(GLYPH_MARKS)]);

/** Letters written right before "$" (lower case): "US$", "CA$", "CDN$", "A$", "R$". */
const DOLLAR_QUALIFIERS: Readonly<Record<string, string>> = {
  us: 'USD',
  c: 'CAD',
  ca: 'CAD',
  can: 'CAD',
  cdn: 'CAD',
  a: 'AUD',
  au: 'AUD',
  nz: 'NZD',
  s: 'SGD',
  sg: 'SGD',
  hk: 'HKD',
  nt: 'TWD',
  mx: 'MXN',
  mex: 'MXN',
  r: 'BRL',
  rd: 'DOP',
  j: 'JMD',
  tt: 'TTD',
  bz: 'BZD',
  ec: 'XCD',
  fj: 'FJD',
  bds: 'BBD',
  n: 'NAD',
};

export function isIsoCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Object.hasOwn(ISO_MINOR_UNITS, code);
}

/**
 * The mark for letters glued to a "$" (or one space before it, for qualifiers of two letters or
 * more: "US $12.34"), or null when the letters qualify nothing ("MEGA$" is a word and a bare "$").
 * An ISO code works as a qualifier too ("CAD$12").
 */
export function qualifiedDollar(letters: string, spaced: boolean): MarkInfo | null {
  if (spaced && letters.length < 2) return null;
  const lower = letters.toLowerCase();
  if (Object.hasOwn(DOLLAR_QUALIFIERS, lower)) {
    const code = DOLLAR_QUALIFIERS[lower] ?? '';
    return explicit(code, ...(code === 'CAD' && lower === 'c' ? ['NIO'] : []));
  }
  const code = isoWord(letters);
  return code === null ? null : explicit(code);
}

/**
 * Words that are marks only when written next to a figure (or alone). Exact case: "Ft" is forint,
 * "ft" is feet; "RM" is ringgit, "rm" nothing.
 */
const WORD_MARKS: Readonly<Record<string, MarkInfo>> = {
  kr: family('SEK', 'NOK', 'DKK', 'ISK'),
  Kr: family('SEK', 'NOK', 'DKK', 'ISK'),
  KR: family('SEK', 'NOK', 'DKK', 'ISK'),
  zł: explicit('PLN'),
  Kč: explicit('CZK'),
  Ft: explicit('HUF'),
  lei: family('RON', 'MDL'),
  Lei: family('RON', 'MDL'),
  Rs: RUPEE_FAMILY,
  RM: explicit('MYR'),
  Rp: explicit('IDR'),
  R: explicit('ZAR'),
  TL: explicit('TRY'),
  RMB: explicit('CNY'),
  NIS: explicit('ILS'),
  dollar: DOLLAR_FAMILY,
  dollars: DOLLAR_FAMILY,
  Dollar: DOLLAR_FAMILY,
  Dollars: DOLLAR_FAMILY,
  euro: explicit('EUR'),
  euros: explicit('EUR'),
  Euro: explicit('EUR'),
  Euros: explicit('EUR'),
  yen: explicit('JPY'),
  Yen: explicit('JPY'),
};

// ISO codes that are also everyday English words: written in lower or mixed case they are words.
const CODE_WORDS = new Set([
  'all',
  'top',
  'mad',
  'cup',
  'pen',
  'try',
  'gel',
  'bob',
  'mop',
  'sos',
  'ron',
  'cop',
  'bam',
  'mur',
]);

/**
 * The mark a word names, when it is written next to a figure or alone: an ISO 4217 code in any
 * case ("USD", "usd", but not "all" or "top" unless upper case), or one of the written
 * abbreviations above. Letters inside a longer word are never a code ("Audio", "Decade").
 */
export function wordMark(word: string): MarkInfo | null {
  if (Object.hasOwn(WORD_MARKS, word)) return WORD_MARKS[word] ?? null;
  const code = isoWord(word);
  return code === null ? null : explicit(code);
}

/** The ISO code a three-letter word is, in any case, unless it is an English word in lower case. */
function isoWord(word: string): string | null {
  if (!/^[A-Za-z]{3}$/.test(word)) return null;
  const upper = word.toUpperCase();
  if (!isIsoCode(upper)) return null;
  if (word !== upper && CODE_WORDS.has(word.toLowerCase())) return null;
  return upper;
}
