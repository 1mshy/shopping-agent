// Text preparation and tokens for the title rules. Pure string work: no locale, no clock.

/** A quantity a title states, folded to one base unit per dimension. */
export interface Measure {
  /** The value in the dimension's base unit (g, ml, US cup, GB, mAh, W, thousand). */
  readonly value: number;
  /** Comparable only within one dimension and one unit system ("10 cup" vs "2.4 L" is not). */
  readonly dim: string;
}

export type TokenKind = 'word' | 'code' | 'number' | 'measure' | 'feature';

export interface Token {
  /** Lower case, dashes removed ("k-mini" → "kmini", "wh-1000xm5" → "wh1000xm5"). */
  readonly key: string;
  readonly kind: TokenKind;
  /** The hyphen-separated parts of the token as written ("pi5-8gb" → ["pi5", "8gb"]). */
  readonly parts: readonly string[];
  /** Written with a trailing plus ("PLA+", "PRO+"). */
  readonly plus: boolean;
  readonly measure?: Measure;
}

/** Names the community and stores use for one thing (ported from the predecessor's aliases). */
const ALIASES: readonly (readonly [RegExp, string])[] = [
  [/\bbambu ?labs?\b/g, 'bambu lab'],
  [/\bx1[\s-]?carbon\b/g, 'x1c'],
  // Bambu's bundle is "the Combo"; stores also write it as the printer "w/ AMS" (same SKU).
  [/(?:\bwith|\bw\/|\+|&)\s*ams(?:[\s-]lite)?\b/g, ' combo '],
];

/**
 * Lower case, NFKC, markup and trademark signs removed, dashes and brackets unified, aliases
 * applied, and a written-out generation folded to its number ("(2nd generation)" → "2").
 */
export function prepare(raw: string): string {
  // Trademark signs go first: NFKC would turn "™" into the letters "TM".
  let s = raw
    .replace(/[®™©℠]/g, ' ')
    .normalize('NFKC')
    .toLowerCase();
  s = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|[’‘]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/[【（[{]/g, '(')
    .replace(/[】）\]}]/g, ')')
    .replace(/[“”„]/g, '"');
  // Thousands and decimal commas between digits ("10,000 mAh", "1,6 l"), before any clause split.
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{1,2})(?![\d,])/g, '$1.$2');
  s = s.replace(/\(?\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*gen(?:eration)?\b\.?\)?/g, ' $1 ');
  s = s.replace(/\(?\bgen(?:eration)?[\s-]*(\d{1,2})\b\)?/g, ' $1 ');
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  s = s.replace(/\bw\/(?!o\b)\s*/g, 'with ');
  s = s.replace(/&/g, ' and ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Units by written form: [dimension, factor to the dimension's base unit]. */
const UNITS: ReadonlyMap<string, readonly [string, number]> = new Map([
  ['kg', ['mass', 1000]],
  ['g', ['mass', 1]],
  ['lb', ['mass_us', 16]],
  ['lbs', ['mass_us', 16]],
  ['l', ['vol', 1000]],
  ['liter', ['vol', 1000]],
  ['litre', ['vol', 1000]],
  ['liters', ['vol', 1000]],
  ['litres', ['vol', 1000]],
  ['ml', ['vol', 1]],
  ['qt', ['vol_us', 4]],
  ['quart', ['vol_us', 4]],
  ['quarts', ['vol_us', 4]],
  ['cup', ['vol_us', 1]],
  ['cups', ['vol_us', 1]],
  ['tb', ['storage', 1000]],
  ['gb', ['storage', 1]],
  ['mah', ['charge', 1]],
  ['ah', ['charge', 1000]],
  ['w', ['power', 1]],
  ['watt', ['power', 1]],
  ['watts', ['power', 1]],
  ['kw', ['power', 1000]],
  ['k', ['k', 1000]],
]);

/** Units recognised so a quantity is not mistaken for a model code, but never compared. */
const OTHER_UNITS = new Set([
  'mm',
  'cm',
  'm',
  'in',
  'inch',
  'inches',
  'ft',
  'oz',
  'v',
  'volt',
  'hz',
  'khz',
  'db',
  'mb',
  'h',
  'mins',
  'min',
  'mmps',
  'c',
  'f',
  'x',
  'p',
  'dpi',
  'nm',
  'rpm',
  'pcs',
  'pc',
  'pk',
  'ct',
  'qt',
]);

/** Feature counts written as "<n>-<noun>": a count of ports or speeds, not a model code. */
const FEATURE_NOUNS = new Set([
  'port',
  'ports',
  'speed',
  'speeds',
  'tool',
  'tools',
  'piece',
  'pieces',
  'pack',
  'bit',
  'blade',
  'blades',
  'layer',
  'way',
  'step',
  'year',
  'years',
  'colour',
  'color',
  'colors',
  'colours',
  'farben',
  'in1',
  'teilig',
  'tlg',
  'er',
]);

const MEASURE_RE = /^(\d+(?:\.\d+)?)([a-zäöü]+)$/;

/** Words written with a digit that are not model codes ("3D printer", "5G"). */
const CODE_LIKE_WORDS = new Set(['2d', '3d', '4d', '3g', '4g', '5g', '3ddrucker']);

function measureOf(value: string, unit: string): Measure | undefined {
  const u = UNITS.get(unit);
  if (u === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return { value: Math.round(n * u[1] * 1000) / 1000, dim: u[0] };
}

function isUnit(word: string): boolean {
  return UNITS.has(word) || OTHER_UNITS.has(word);
}

/** Splits prepared text into raw word strings, keeping decimals, thousands and fractions whole. */
function rawWords(prepared: string): string[] {
  const s = prepared
    .replace(/mm\/s\b/g, 'mmps')
    .replace(/\+(?=[a-z0-9])/g, '+ ')
    // "235x235mm", "2 x 1.3Ah": a multiplication between numbers, not part of a code ("SN850X 2TB").
    .replace(/(?<![a-z\d.])(\d+(?:\.\d+)?)\s*[x×*]\s*(?=\d)/g, '$1 x ');
  return s.split(/[^a-z0-9äöüß.+/-]+/).flatMap((w) => {
    const t = w.replace(/^[-./+]+|[-./]+$/g, '');
    if (t === '') return [];
    // A fraction keeps its parts ("1/2", "1/4-in" → "1/4" "in"); "hx6810/50" and "k1/k1c" split.
    const fraction = /^(\d+\/\d+)(?:-(.+))?$/.exec(t);
    if (fraction?.[1] !== undefined)
      return fraction[2] ? [fraction[1], fraction[2]] : [fraction[1]];
    return t.split('/').filter((p) => p !== '' && p !== '.');
  });
}

function classify(raw: string): Token {
  const plus = raw.endsWith('+') && raw.length > 1;
  const bare = raw.replace(/\++$/, '').replace(/\.$/, '');
  const parts = bare.split('-').filter((p) => p !== '');
  const key = parts.join('');
  if (CODE_LIKE_WORDS.has(key)) return { key, kind: 'word', parts, plus };
  const m = MEASURE_RE.exec(key);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    const measure = measureOf(m[1], m[2]);
    if (measure) return { key, kind: 'measure', parts, plus, measure };
    if (isUnit(m[2])) return { key, kind: 'measure', parts, plus };
  }
  if (parts.length >= 2 && /^\d+$/.test(parts[0] ?? '')) {
    const rest = parts.slice(1).join('');
    if (FEATURE_NOUNS.has(rest) || /^in\d$/.test(rest)) {
      return { key, kind: 'feature', parts, plus };
    }
  }
  if (/^\d+(?:\.\d+)?$/.test(key) || /^\d+\/\d+$/.test(bare)) {
    return { key, kind: 'number', parts, plus };
  }
  if (/\d/.test(key) && /[a-zäöü]/.test(key)) return { key, kind: 'code', parts, plus };
  return { key, kind: 'word', parts, plus };
}

/**
 * The tokens of prepared text. A number followed by a unit word becomes one measure ("10 cup",
 * "6.0-quart", "2 tb"); "pla plus" becomes "pla+".
 */
export function tokenise(prepared: string): Token[] {
  const words = rawWords(prepared);
  const out: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? '';
    const next = words[i + 1];
    // "6.0-quart", "10-cup": the hyphen joins a number to its unit.
    const hy = /^(\d+(?:\.\d+)?)-([a-z]+)$/.exec(w);
    if (hy?.[1] !== undefined && hy[2] !== undefined && UNITS.has(hy[2])) {
      const measure = measureOf(hy[1], hy[2]);
      if (measure) {
        out.push({
          key: hy[1] + hy[2],
          kind: 'measure',
          parts: [hy[1], hy[2]],
          plus: false,
          measure,
        });
        continue;
      }
    }
    if (/^\d+(?:\.\d+)?$/.test(w) && next !== undefined && isUnit(next)) {
      const measure = measureOf(w, next);
      out.push(
        measure
          ? { key: w + next, kind: 'measure', parts: [w, next], plus: false, measure }
          : { key: w + next, kind: 'measure', parts: [w, next], plus: false },
      );
      i++;
      continue;
    }
    if (w === 'plus' && out.length > 0) {
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'word' && !prev.plus && MATERIAL_HINT.has(prev.key)) {
        out[out.length - 1] = { ...prev, plus: true };
        continue;
      }
    }
    out.push(classify(w));
  }
  return out;
}

/** Words that "Plus" marks as a material grade when written out ("PLA Plus" is "PLA+"). */
const MATERIAL_HINT = new Set(['pla', 'petg', 'abs', 'asa', 'tpu']);

/** The keys of a token as it can be found: its key, its parts, and its parts joined in pairs. */
export function tokenForms(t: Token): string[] {
  const forms = new Set<string>([t.key, ...t.parts]);
  for (let i = 0; i + 1 < t.parts.length; i++)
    forms.add((t.parts[i] ?? '') + (t.parts[i + 1] ?? ''));
  return [...forms];
}
