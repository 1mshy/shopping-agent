// A page's locale as written in hreflang, og:locale or a resolved shop locale ("en-CA", "fr_CA",
// "zh-Hant-TW", "de"). Only its language and region subtags are read. No Intl: the answers here
// must not move with the ICU build of the host (progress, workstream 2a, found 16 codes where ICU
// and ISO disagree).

export interface LocaleTag {
  /** Lower case, two or three letters. */
  readonly language: string;
  /** ISO 3166-1 alpha-2, upper case, or null (none written, or a UN M.49 area such as 419). */
  readonly region: string | null;
}

/** Reads a BCP 47 tag (an underscore counts as a hyphen), or null when it is not one. */
export function parseLocaleTag(raw: unknown): LocaleTag | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const subtags = raw.trim().replaceAll('_', '-').split('-');
  const [first = '', ...rest] = subtags;
  if (!/^[A-Za-z]{2,3}$/.test(first)) return null; // x-default, i-…, empty
  let region: string | null = null;
  let index = 0;
  if (rest[index] !== undefined && /^[A-Za-z]{4}$/.test(rest[index] ?? '')) index += 1; // script
  const candidate = rest[index];
  if (candidate !== undefined && /^[A-Za-z]{2}$/.test(candidate)) region = candidate.toUpperCase();
  return { language: first.toLowerCase(), region };
}

/** How a locale writes a number's decimal point and its thousands separator. */
export interface LocaleSeparators {
  readonly decimal: '.' | ',';
  readonly group: '.' | ',' | ' ' | "'";
}

const DOT_COMMA: LocaleSeparators = { decimal: '.', group: ',' };
const COMMA_DOT: LocaleSeparators = { decimal: ',', group: '.' };
const COMMA_SPACE: LocaleSeparators = { decimal: ',', group: ' ' };
const DOT_APOSTROPHE: LocaleSeparators = { decimal: '.', group: "'" };

// By language, as CLDR writes the default region. Only languages whose shop prices follow one
// convention are listed; a language not listed is unclear, and so is every `null` below.
const BY_LANGUAGE: Readonly<Record<string, LocaleSeparators>> = {
  en: DOT_COMMA,
  ja: DOT_COMMA,
  zh: DOT_COMMA,
  ko: DOT_COMMA,
  th: DOT_COMMA,
  he: DOT_COMMA,
  hi: DOT_COMMA,
  ms: DOT_COMMA,
  fil: DOT_COMMA,
  ga: DOT_COMMA,
  cy: DOT_COMMA,
  mt: DOT_COMMA,
  de: COMMA_DOT,
  es: COMMA_DOT,
  it: COMMA_DOT,
  nl: COMMA_DOT,
  pt: COMMA_DOT,
  da: COMMA_DOT,
  id: COMMA_DOT,
  tr: COMMA_DOT,
  el: COMMA_DOT,
  ro: COMMA_DOT,
  hr: COMMA_DOT,
  sl: COMMA_DOT,
  is: COMMA_DOT,
  vi: COMMA_DOT,
  ca: COMMA_DOT,
  fr: COMMA_SPACE,
  sv: COMMA_SPACE,
  fi: COMMA_SPACE,
  nb: COMMA_SPACE,
  nn: COMMA_SPACE,
  no: COMMA_SPACE,
  pl: COMMA_SPACE,
  cs: COMMA_SPACE,
  sk: COMMA_SPACE,
  hu: COMMA_SPACE,
  ru: COMMA_SPACE,
  uk: COMMA_SPACE,
  bg: COMMA_SPACE,
  lt: COMMA_SPACE,
  lv: COMMA_SPACE,
  et: COMMA_SPACE,
};

// Regions that write numbers differently from their language's default. `null` marks a pair this
// table does not vouch for (English in continental Europe, Austrian and Swiss French or German
// variants whose CLDR data has changed over the years): those locales are unclear.
const BY_LANGUAGE_REGION: Readonly<Record<string, LocaleSeparators | null>> = {
  'en-ZA': COMMA_SPACE,
  'en-AT': null,
  'en-BE': null,
  'en-CH': DOT_APOSTROPHE,
  'en-DE': null,
  'en-DK': null,
  'en-FI': null,
  'en-NL': null,
  'en-SE': null,
  'en-SI': null,
  'de-AT': null,
  'de-BE': null,
  'de-CH': DOT_APOSTROPHE,
  'de-LI': DOT_APOSTROPHE,
  'de-LU': null,
  'it-CH': DOT_APOSTROPHE,
  'fr-CH': null,
  'es-MX': DOT_COMMA,
  'es-US': DOT_COMMA,
  'es-PR': DOT_COMMA,
  'es-CR': null,
  'es-CU': null,
  'es-DO': null,
  'es-GT': null,
  'es-HN': null,
  'es-NI': null,
  'es-PA': null,
  'es-PE': null,
  'es-PH': null,
  'es-SV': null,
  'pt-PT': COMMA_SPACE,
  'pt-AO': null,
  'pt-CV': null,
  'pt-MZ': null,
};

/**
 * The separators a locale writes, or null when the locale is absent, malformed or unclear. A
 * language alone ("de") takes the language's default; "es-419" (Latin America) is written as
 * Mexico writes it.
 */
export function localeSeparators(raw: unknown): LocaleSeparators | null {
  if (typeof raw === 'string' && /^es[-_]419$/i.test(raw.trim())) return DOT_COMMA;
  const tag = parseLocaleTag(raw);
  if (tag === null) return null;
  if (tag.region !== null) {
    const key = `${tag.language}-${tag.region}`;
    if (Object.hasOwn(BY_LANGUAGE_REGION, key)) return BY_LANGUAGE_REGION[key] ?? null;
  }
  return Object.hasOwn(BY_LANGUAGE, tag.language) ? (BY_LANGUAGE[tag.language] ?? null) : null;
}
