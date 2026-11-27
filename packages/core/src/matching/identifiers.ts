// Tier 1 (S§5.4): identity on identifiers. GTIN equality (check digit validated, normalised to 14
// digits) or normalised brand + MPN equality. A model number in the listing's URL path is
// supporting evidence only, never identity on its own: this module never reads the URL.
import {
  codeAgrees,
  compactKey,
  compareCodes,
  mpnBaseSuffix,
  mpnForms,
  mpnParts,
  sameMpn,
} from './codes.ts';
import { normaliseGtin } from './gtin.ts';

/** Strip trademark signs before NFKC would turn them into letters ("™" becomes "TM"). */
const brandText = (raw: string): string => raw.replace(/[®™©℠]/gu, '').normalize('NFKC');

/** Normalised brand: NFKC, lower case, letters and digits only. */
export function normaliseBrand(raw: string | null | undefined): string {
  return typeof raw === 'string' ? compactKey(brandText(raw)) : '';
}

/** Known names used in brand fields, independent of the product's title or part number. */
function brandKey(raw: string): string {
  const key = normaliseBrand(raw);
  if (key === 'bambulabs') return 'bambulab';
  if (key === 'keurigk') return 'keurig';
  return key;
}

/** Compare complete names, allowing store tags such as "Laifen - US" and "beta-anker-de". */
export function brandFieldMatches(askedBrand: string, listingBrand: string | null): boolean {
  if (listingBrand === null) return false;
  const asked = brandKey(askedBrand);
  if (asked === '') return false;
  if (asked === brandKey(listingBrand)) return true;
  const undecorated = brandText(listingBrand)
    .trim()
    .replace(/^beta[\s_-]+/iu, '')
    .replace(/[\s_-]+(?:us|usa|ca|de|uk|canada|germany)$/iu, '');
  return asked === brandKey(undecorated);
}

export interface Tier1Input {
  readonly askedGtin: string | null;
  readonly askedMpns: readonly string[];
  /** The brand already confirmed for this listing (field or title), as tier 2 read it. */
  readonly brandConfirmed: boolean;
  readonly listingGtin: string | null;
  readonly listingMpn: string | null;
}

export type Tier1Result =
  | { readonly kind: 'gtin' }
  | { readonly kind: 'mpn' }
  /** Both sides state a valid GTIN and they differ: not the same barcode. */
  | { readonly kind: 'gtin_differs' }
  | { readonly kind: 'none' };

/**
 * The page states a part number of its own that is not the asked one: both are part numbers
 * (letters and digits, or digits in the same dashed form such as "910-006556"), neither contains
 * the other ("A1289011-F0" is the refurbished "A1289011"), and the listing's does not name the
 * asked model code ("BES870XL" is a form of the asked "BES870"). An MPN field with spaces is a
 * name, not a part number. Such a listing is not confirmed by its title alone.
 */
export function mpnConflict(
  askedMpn: string | null,
  askedCodes: readonly string[],
  listingMpn: string | null,
): boolean {
  if (askedMpn === null || listingMpn === null || /\s/.test(listingMpn.trim())) return false;
  const a = compactKey(askedMpn);
  const l = compactKey(listingMpn);
  if (a === '' || l === '' || !/\d/.test(l)) return false;
  if (sameMpn(askedMpn, listingMpn)) return false;
  // One base with two different suffixes ("ZX4400-BLK" and "ZX4400-RED"): another SKU.
  const [baseA, suffixA] = mpnBaseSuffix(askedMpn);
  const [baseL, suffixL] = mpnBaseSuffix(listingMpn);
  if (baseA === baseL && suffixA !== '' && suffixL !== '') return true;
  // One written inside the other ("A1289011-F0" is the refurbished "A1289011").
  if (l.includes(a) || a.includes(l)) return false;
  const parts = [...mpnForms(listingMpn), ...mpnParts(listingMpn)];
  if (askedCodes.some((c) => parts.some((p) => codeAgrees(compareCodes(c, p))))) return false;
  const letters = (s: string) => /[a-z]/.test(s);
  if (letters(a) && letters(l)) return true;
  if (letters(a) || letters(l)) return false;
  const dashed = (s: string) =>
    s
      .split(/[-/.\s]+/)
      .map((p) => p.length)
      .join('-');
  return dashed(askedMpn) === dashed(listingMpn) && /[-/.]/.test(askedMpn);
}

/** Identity by identifiers, or what the identifiers say against it. Pure. */
export function tier1(input: Tier1Input): Tier1Result {
  const asked = normaliseGtin(input.askedGtin);
  const listed = normaliseGtin(input.listingGtin);
  if (asked !== null && listed !== null && asked === listed) return { kind: 'gtin' };
  // A barcode in the MPN field is still the page's barcode ("611247373590" stated as MPN).
  const mpnAsGtin = /^\d{8,14}$/.test(input.listingMpn?.trim() ?? '')
    ? normaliseGtin(input.listingMpn)
    : null;
  if (asked !== null && mpnAsGtin === asked) return { kind: 'gtin' };
  // Brand + MPN equality outweighs a differing GTIN field: stores put their own codes there
  // (open-box and refurbished stock under an in-store number).
  if (input.brandConfirmed && input.listingMpn !== null) {
    for (const m of input.askedMpns) {
      const f = compactKey(m);
      const partNumber = /\d/.test(f) && (/[a-z]/.test(f) || f.length >= 6);
      if (partNumber && sameMpn(m, input.listingMpn)) return { kind: 'mpn' };
    }
  }
  if (asked !== null && listed !== null) return { kind: 'gtin_differs' };
  return { kind: 'none' };
}
