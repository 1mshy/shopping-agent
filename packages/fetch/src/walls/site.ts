// Host names and sites, for in-house wall vendors and the walled-session drop.
//
// There is no public suffix list here, on purpose (see `cookies/jar.ts` for why the HTTP rung
// needs none). Two uses need to know where a site's own name ends: naming an in-house wall
// (`www.amazon.co.uk` is Amazon's) and keeping a walled session drop from clearing a public
// suffix (`.co.uk`). A small rule covers both: a single label is a suffix, and so is a two-label
// name made of a generic second level under a two-letter country code (`co.uk`, `com.au`,
// `co.jp`), plus a short list of hosting suffixes where shops live (`myshopify.com`). Browsers
// refuse cookies on a public suffix anyway, so the rule only has to be right for the names a
// store can have; a miss clears less, never another site's session.

/** Generic second levels that registries put under a two-letter country code. */
const COUNTRY_SECOND_LEVELS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gen',
  'go',
  'gob',
  'gov',
  'ltd',
  'me',
  'mil',
  'ne',
  'net',
  'nic',
  'nom',
  'or',
  'org',
  'plc',
  'sch',
]);

/** Hosting suffixes under which every subdomain is somebody else's site. */
const HOSTING_SUFFIXES = new Set([
  'myshopify.com',
  'shopifypreview.com',
  'wixsite.com',
  'square.site',
  'bigcartel.com',
  'github.io',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'azurewebsites.net',
  'cloudfront.net',
  'appspot.com',
  'blogspot.com',
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True for an IP address literal (IPv4, or IPv6 as a URL's host name gives it). */
export function isIpHost(host: string): boolean {
  return IPV4.test(host) || host.includes(':') || host.startsWith('[');
}

/** A domain lower-cased, without leading or trailing dots. */
export function bareDomain(domain: string): string {
  return domain.toLowerCase().replace(/^\.+|\.+$/g, '');
}

/** True when `domain` (bare) is a public suffix under the rule of the module comment. */
export function isPublicSuffix(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length <= 1) return true;
  if (HOSTING_SUFFIXES.has(domain)) return true;
  const [second, top] = labels;
  return (
    labels.length === 2 &&
    top !== undefined &&
    /^[a-z]{2}$/.test(top) &&
    second !== undefined &&
    COUNTRY_SECOND_LEVELS.has(second)
  );
}

/** The host name of an http(s) URL, lower-cased and without a trailing dot; null otherwise. */
export function hostOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = bareDomain(parsed.hostname);
  return host === '' ? null : host;
}

/**
 * The label that names a host's site: `amazon` for `www.amazon.co.uk`, `ebay` for `ebay.ca`.
 * Null for an IP address or a host that is itself a suffix.
 */
export function siteLabel(host: string): string | null {
  if (isIpHost(host)) return null;
  const labels = bareDomain(host).split('.');
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && isPublicSuffix(lastTwo)) return labels[labels.length - 3] ?? null;
  if (isPublicSuffix(lastTwo)) return null;
  return labels[labels.length - 2] ?? null;
}
