// What a storefront's host name says about its market (S§5.2: the ccTLD is the last source; the
// predecessor's money.named_region_for_host and learned.country_in_name). A .com names nothing:
// plenty of Canadian shops are .coms (Princess Auto, Canada Computers), so a .com is never USD.

/** Lower case, no port, no trailing dot, no leading "www.". Null when it is not a host name. */
export function normaliseHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 253) return null;
  let host = raw.trim().toLowerCase();
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('.') || host.includes('..')) return null;
  return host;
}

// Two-letter TLDs registered mostly by people outside their country (.io, .co, .ai, .tv, .me…):
// they name no market. A second-level registry under one (shop.com.co) is the country's own.
const GENERIC_CCTLDS = new Set([
  'ac',
  'ag',
  'ai',
  'bz',
  'cc',
  'cd',
  'co',
  'cx',
  'dj',
  'fm',
  'gd',
  'gg',
  'gl',
  'gs',
  'im',
  'io',
  'la',
  'ly',
  'md',
  'me',
  'ms',
  'nu',
  'pw',
  'sh',
  'so',
  'st',
  'sx',
  'tk',
  'tm',
  'to',
  'tv',
  'vc',
  'vg',
  'ws',
]);
const SECOND_LEVEL_REGISTRIES = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'gob']);

// First labels a store uses to name a regional storefront (ca.store.…, eu.store.…). Only codes
// that are not also a common sub-domain word or a language whose speakers span currencies: `my`
// (account pages), `in`, `id`, `me`, `no`, `is` and the like are left out.
const REGIONAL_LABELS: Readonly<Record<string, string>> = {
  us: 'US',
  ca: 'CA',
  uk: 'GB',
  gb: 'GB',
  eu: 'EU',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'ES',
  nl: 'NL',
  be: 'BE',
  at: 'AT',
  ch: 'CH',
  ie: 'IE',
  pt: 'PT',
  se: 'SE',
  dk: 'DK',
  fi: 'FI',
  pl: 'PL',
  cz: 'CZ',
  au: 'AU',
  nz: 'NZ',
  jp: 'JP',
  kr: 'KR',
  tw: 'TW',
  hk: 'HK',
  sg: 'SG',
  mx: 'MX',
  br: 'BR',
  za: 'ZA',
};

/**
 * The market the host names outright (S§5.2 ccTLD; corpus source `host_market`): a country TLD
 * (.ca, .co.uk, .com.au; .uk is GB, .eu is the euro area) or, on a host whose TLD names no
 * country, a regional first label (ca.store.bambulab.com). Null otherwise.
 */
export function hostMarket(raw: unknown): string | null {
  const host = normaliseHost(raw);
  if (host === null) return null;
  const labels = host.split('.');
  const tld = labels.at(-1) ?? '';
  if (/^[a-z]{2}$/.test(tld) && labels.length >= 2) {
    const secondLevel = labels.at(-2) ?? '';
    if (
      !GENERIC_CCTLDS.has(tld) ||
      (labels.length >= 3 && SECOND_LEVEL_REGISTRIES.has(secondLevel))
    ) {
      return tld === 'uk' ? 'GB' : tld.toUpperCase();
    }
  }
  const first = labels[0] ?? '';
  if (labels.length >= 3 && Object.hasOwn(REGIONAL_LABELS, first)) {
    return REGIONAL_LABELS[first] ?? null;
  }
  return null;
}

// Words in a host name that leave no doubt about the country (napacanada.com, boutiquequebec.com).
// Substrings are matched because host names run words together, so each word is long enough not
// to occur inside an unrelated one.
const COUNTRY_WORDS: readonly (readonly [RegExp, string])[] = [
  [/canada|canadian|quebec/, 'CA'],
  [/australia/, 'AU'],
  [/newzealand/, 'NZ'],
  [/deutschland/, 'DE'],
  [/nederland/, 'NL'],
  [/schweiz|suisse|svizzera/, 'CH'],
  [/oesterreich/, 'AT'],
  [/brasil/, 'BR'],
];

/** The country the host's own words name (corpus source `host_name`), ignoring its TLD. */
export function hostNameCountry(raw: unknown): string | null {
  const host = normaliseHost(raw);
  if (host === null) return null;
  const name = host.split('.').slice(0, -1).join('.');
  for (const [pattern, country] of COUNTRY_WORDS) {
    if (pattern.test(name)) return country;
  }
  return null;
}
