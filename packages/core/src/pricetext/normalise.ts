// Page text normalised for reading figures, marks and words. Targeted, not NFKC: NFKC would turn a
// superscript cents display ("$99⁹⁹") into "$9999", a hundredfold misread.

export interface NormalisedText {
  /** Single ASCII spaces, ASCII digits, "'" for every apostrophe, "-" for every dash. */
  readonly text: string;
  /** The text holds digits this reader does not read (superscripts, fractions, other scripts). */
  readonly foreignDigits: boolean;
}

// Code points, not literal characters, so that invisible ones stay reviewable.
const chars = (...codes: number[]) => new Set(codes.map((c) => String.fromCodePoint(c)));
const FULLWIDTH_SIGNS = new Map([
  [String.fromCodePoint(0xffe0), '¢'],
  [String.fromCodePoint(0xffe1), '£'],
  [String.fromCodePoint(0xffe5), '¥'],
  [String.fromCodePoint(0xffe6), '₩'],
]);
// Quotation marks, modifier letter apostrophe, prime, acute and grave accents.
const APOSTROPHES = chars(0x2018, 0x2019, 0x02bc, 0x2032, 0x00b4, 0x0060);
// Hyphen, non-breaking hyphen, figure dash, en and em dashes, horizontal bar, minus signs.
const DASHES = chars(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63);
// Zero-width space, non-joiner and joiner, word joiner, soft hyphen.
const INVISIBLE = chars(0x200b, 0x200c, 0x200d, 0x2060, 0x00ad);

export function normaliseText(raw: string): NormalisedText {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0); // fullwidth ASCII: "１２３" is "123"
    } else if (FULLWIDTH_SIGNS.has(ch)) {
      out += FULLWIDTH_SIGNS.get(ch);
    } else if (INVISIBLE.has(ch)) {
      // dropped: zero-width characters and soft hyphens split nothing
    } else if (/\s/u.test(ch)) {
      out += ' '; // ordinary, no-break (U+00A0), narrow no-break (U+202F), thin and other spaces
    } else if (APOSTROPHES.has(ch)) {
      out += "'";
    } else if (DASHES.has(ch)) {
      out += '-';
    } else {
      out += ch;
    }
  }
  const text = out.replace(/ {2,}/g, ' ').trim();
  // Any decimal or other digit outside ASCII; letter numbers (Roman numerals in a name) aside.
  return { text, foreignDigits: /[^\P{N}0-9]/u.test(text.replace(/\p{Nl}/gu, '')) };
}
