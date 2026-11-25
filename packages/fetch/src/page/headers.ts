// What each rung adds to the profile's own headers (S§5.1 Ladder). The profile owns the
// User-Agent and the client hints; a rung only adds Accept (api), a same-site Referer (http) and
// the host session's Cookie.

/**
 * The `api` rung's Accept: JSON first, but anything accepted, so an endpoint that answers JSON
 * under another type (Shopify's `/products/<handle>.js`) does not answer 406. It is the common
 * default of JavaScript HTTP clients, as a shop's own front end would send.
 */
export const API_ACCEPT = 'application/json, text/plain, */*';

function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

/**
 * Same site without a public suffix list: the same host, or one host under the other (shop and
 * www.shop). Two different registrable domains never pass, which is the property that matters:
 * a Referer never crosses sites.
 */
export function sameSite(a: URL, b: URL): boolean {
  if (a.protocol !== b.protocol) return false;
  const x = a.hostname;
  const y = b.hostname;
  if (x === y) return true;
  if (isIpHost(x) || isIpHost(y)) return false;
  return x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

export interface RefererHeaders {
  readonly referer: string;
  /** Sec-Fetch-Site as Chrome sends it with that Referer (the profile says `none`). */
  readonly fetchSite: 'same-origin' | 'same-site';
}

/**
 * The Referer for a request to `target` coming from `from`, under Chrome's default policy
 * (strict-origin-when-cross-origin): the full URL without fragment or credentials for the same
 * origin, the origin alone for another origin of the same site, nothing across sites or from
 * https to http. Null when nothing is sent, or `from` is not an http(s) URL.
 */
export function refererFor(from: string, target: string): RefererHeaders | null {
  let source: URL;
  let to: URL;
  try {
    source = new URL(from);
    to = new URL(target);
  } catch {
    return null;
  }
  if (source.protocol !== 'https:' && source.protocol !== 'http:') return null;
  if (source.protocol === 'https:' && to.protocol !== 'https:') return null;
  if (!sameSite(source, to)) return null;
  source.username = '';
  source.password = '';
  source.hash = '';
  if (source.origin === to.origin) return { referer: source.href, fetchSite: 'same-origin' };
  return { referer: `${source.origin}/`, fetchSite: 'same-site' };
}
