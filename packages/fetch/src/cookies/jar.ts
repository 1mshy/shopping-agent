// Cookie jars for the HTTP rungs (S§5.1 "Sessions": one cookie jar per host session for HTTP; a
// walled render clears only that site's cookies, including parent-domain bot-manager cookies).
//
// A minimal RFC 6265 implementation, scoped to what a client that only GETs pages needs: the
// Set-Cookie grammar (§5.2), the cookie-date algorithm (§5.1.1), domain and path matching
// (§5.1.3, §5.1.4), Secure, Max-Age before Expires, host-only cookies, the `__Secure-` and
// `__Host-` prefixes and "leave secure cookies alone" (RFC 6265bis). Kept in memory only.
//
// No dependency, on purpose: the well-known one (tough-cookie) is a new major with a public
// suffix list in tow, and the public suffix check exists to stop a cookie set for `co.uk` from
// reaching every shop under it. Here each host has its own jar, so a cookie never reaches another
// host's requests, whatever its Domain says. HttpOnly and SameSite are not modelled: no script
// reads these cookies, and the only Referer ever sent is same-site.
import { isPublicSuffix } from '../walls/site.ts';

export interface Cookie {
  readonly name: string;
  readonly value: string;
  /** Lower-case, without a leading dot. */
  readonly domain: string;
  /** True when no Domain attribute was given: sent to `domain` exactly, not its subdomains. */
  readonly hostOnly: boolean;
  readonly path: string;
  readonly secure: boolean;
  /** Epoch milliseconds; null for a session cookie (kept for the life of the jar). */
  readonly expiresAt: number | null;
  readonly createdAt: number;
}

/** A cookie whose name and value are longer than this is ignored (RFC 6265 §6.1 minimum). */
export const MAX_COOKIE_BYTES = 4_096;
/** Cookies kept per jar; the oldest go first once a host sets more. */
export const MAX_COOKIES_PER_JAR = 300;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIpHost(host: string): boolean {
  return IPV4.test(host) || host.includes(':') || host.startsWith('[');
}

/** RFC 6265 §5.1.3. */
export function domainMatch(host: string, domain: string): boolean {
  if (host === domain) return true;
  return host.endsWith(`.${domain}`) && !isIpHost(host);
}

/** RFC 6265 §5.1.4. */
export function pathMatch(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** RFC 6265 §5.1.4 default-path. */
function defaultPath(url: URL): string {
  const path = url.pathname;
  if (!path.startsWith('/')) return '/';
  const last = path.lastIndexOf('/');
  return last <= 0 ? '/' : path.slice(0, last);
}

/** RFC 6265 §5.1.1 delimiter: %x09 / %x20-2F / %x3B-40 / %x5B-60 / %x7B-7E. */
function isDateDelimiter(code: number): boolean {
  return (
    code === 0x09 ||
    (code >= 0x20 && code <= 0x2f) ||
    (code >= 0x3b && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

function dateTokens(text: string): string[] {
  const tokens: string[] = [];
  let token = '';
  for (const char of text) {
    if (isDateDelimiter(char.charCodeAt(0))) {
      if (token !== '') tokens.push(token);
      token = '';
    } else {
      token += char;
    }
  }
  if (token !== '') tokens.push(token);
  return tokens;
}

/** A control character other than tab (RFC 6265bis: such a cookie is ignored). */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) return true;
  }
  return false;
}

/** RFC 6265 §5.1.1, the cookie-date algorithm. Epoch milliseconds, or null when it fails. */
export function parseCookieDate(text: string): number | null {
  let time: [number, number, number] | undefined;
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;
  for (const token of dateTokens(text)) {
    const t = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[^\d].*)?$/.exec(token);
    if (time === undefined && t) {
      time = [Number(t[1]), Number(t[2]), Number(t[3])];
      continue;
    }
    const d = /^(\d{1,2})(?:[^\d].*)?$/.exec(token);
    if (day === undefined && d) {
      day = Number(d[1]);
      continue;
    }
    const m = MONTHS.indexOf(token.slice(0, 3).toLowerCase());
    if (month === undefined && m !== -1) {
      month = m;
      continue;
    }
    const y = /^(\d{2,4})(?:[^\d].*)?$/.exec(token);
    if (year === undefined && y) {
      year = Number(y[1]);
    }
  }
  if (time === undefined || day === undefined || month === undefined || year === undefined) {
    return null;
  }
  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;
  const [hour, minute, second] = time;
  if (day < 1 || day > 31 || year < 1601 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month, day, hour, minute, second);
  // A day past the month's end (31 Feb) fails the algorithm.
  return new Date(ms).getUTCDate() === day ? ms : null;
}

interface Parsed {
  readonly name: string;
  readonly value: string;
  readonly domain: string | undefined;
  readonly path: string | undefined;
  readonly secure: boolean;
  readonly maxAge: number | undefined;
  readonly expires: number | undefined;
}

/** RFC 6265 §5.2. Undefined for a header that sets no cookie. */
function parseSetCookie(header: string): Parsed | undefined {
  const [pair = '', ...attributes] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return undefined;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (name === '' || hasControl(name + value)) return undefined;
  if (new TextEncoder().encode(name + value).byteLength > MAX_COOKIE_BYTES) return undefined;
  let domain: string | undefined;
  let path: string | undefined;
  let secure = false;
  let maxAge: number | undefined;
  let expires: number | undefined;
  for (const attribute of attributes) {
    const at = attribute.indexOf('=');
    const key = (at === -1 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const raw = at === -1 ? '' : attribute.slice(at + 1).trim();
    switch (key) {
      case 'expires': {
        const date = parseCookieDate(raw);
        if (date !== null) expires = date;
        break;
      }
      case 'max-age':
        if (/^-?\d+$/.test(raw)) maxAge = Number(raw);
        break;
      case 'domain': {
        const bare = raw.replace(/^\./, '').toLowerCase();
        if (bare !== '') domain = bare;
        break;
      }
      case 'path':
        path = raw.startsWith('/') ? raw : undefined;
        break;
      case 'secure':
        secure = true;
        break;
      default:
        // HttpOnly, SameSite and anything unknown: see the module comment.
        break;
    }
  }
  return { name, value, domain, path, secure, maxAge, expires };
}

/** The cookies of one host session. */
export class CookieJar {
  #cookies: Cookie[] = [];

  /** Every cookie held now, expired ones included until the next read. */
  list(): readonly Cookie[] {
    return [...this.#cookies];
  }

  get size(): number {
    return this.#cookies.length;
  }

  clear(): void {
    this.#cookies = [];
  }

  /** Removes the cookies `predicate` picks. */
  remove(predicate: (cookie: Cookie) => boolean): void {
    this.#cookies = this.#cookies.filter((cookie) => !predicate(cookie));
  }

  /** Stores what a response's Set-Cookie headers set, for a response from `url` at `now`. */
  store(setCookies: readonly string[], url: string, now: number): void {
    const target = new URL(url);
    const host = target.hostname;
    const https = target.protocol === 'https:';
    for (const header of setCookies) {
      const parsed = parseSetCookie(header);
      if (parsed === undefined) continue;

      let domain = host;
      let hostOnly = true;
      if (parsed.domain !== undefined && parsed.domain !== host) {
        // A Domain the host is not under, or any Domain for an IP host, is refused (§5.3 6).
        if (!domainMatch(host, parsed.domain)) continue;
        domain = parsed.domain;
        hostOnly = false;
      }
      if (parsed.secure && !https) continue;
      if (parsed.name.startsWith('__Secure-') && !parsed.secure) continue;
      if (
        parsed.name.startsWith('__Host-') &&
        (!parsed.secure || parsed.domain !== undefined || parsed.path !== '/')
      ) {
        continue;
      }
      const path = parsed.path ?? defaultPath(target);
      // RFC 6265bis "leave secure cookies alone": plain http cannot shadow a secure cookie.
      if (
        !https &&
        this.#cookies.some(
          (c) =>
            c.secure &&
            c.name === parsed.name &&
            (domainMatch(domain, c.domain) || domainMatch(c.domain, domain)) &&
            pathMatch(path, c.path),
        )
      ) {
        continue;
      }

      let expiresAt: number | null = null;
      if (parsed.maxAge !== undefined) {
        expiresAt = parsed.maxAge <= 0 ? Number.NEGATIVE_INFINITY : now + parsed.maxAge * 1_000;
      } else if (parsed.expires !== undefined) {
        expiresAt = parsed.expires;
      }

      const index = this.#cookies.findIndex(
        (c) => c.name === parsed.name && c.domain === domain && c.path === path,
      );
      const createdAt = index === -1 ? now : (this.#cookies[index]?.createdAt ?? now);
      if (index !== -1) this.#cookies.splice(index, 1);
      if (expiresAt !== null && expiresAt <= now) continue;
      this.#cookies.push({
        name: parsed.name,
        value: parsed.value,
        domain,
        hostOnly,
        path,
        secure: parsed.secure,
        expiresAt,
        createdAt,
      });
    }
    this.#evict(now);
  }

  /** The Cookie header for a request to `url` at `now` (RFC 6265 §5.4), or null for none. */
  header(url: string, now: number): string | null {
    this.#purge(now);
    const target = new URL(url);
    const host = target.hostname;
    const https = target.protocol === 'https:';
    const path = target.pathname || '/';
    const sent = this.#cookies
      .filter(
        (c) =>
          (c.hostOnly ? host === c.domain : domainMatch(host, c.domain)) &&
          pathMatch(path, c.path) &&
          (!c.secure || https),
      )
      .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
    if (sent.length === 0) return null;
    return sent.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  #purge(now: number): void {
    this.#cookies = this.#cookies.filter((c) => c.expiresAt === null || c.expiresAt > now);
  }

  #evict(now: number): void {
    this.#purge(now);
    if (this.#cookies.length <= MAX_COOKIES_PER_JAR) return;
    this.#cookies.sort((a, b) => a.createdAt - b.createdAt);
    this.#cookies.splice(0, this.#cookies.length - MAX_COOKIES_PER_JAR);
  }
}

function bareSite(site: string): string {
  return site.toLowerCase().replace(/^\.+|\.+$/g, '');
}

/**
 * Jars kept at once; the least recently used goes first. A page chooses the hosts it redirects
 * to, so without a cap it chooses how many jars exist. About 12 HTTP hosts are in flight at once
 * (S§5.1 Pacing) and a home install watches tens of stores, so 256 leaves every live session its
 * jar; a jar that is dropped costs that host one cold request.
 */
export const MAX_JARS = 256;
/**
 * Cookies kept across all jars: past it, the least recently used jars are dropped whole. With
 * `MAX_COOKIE_BYTES` this bounds what cookies can hold to about 16 MB of names and values (the
 * jar in use may add up to `MAX_COOKIES_PER_JAR` more until the next jar is asked for).
 */
export const MAX_COOKIES_TOTAL = 4_000;

/**
 * True when cookies set for `domain` go when `site` is forgotten: the site's own, those of a
 * domain under it, and those of its parent domains short of a public suffix (`shop.co.uk`'s wall
 * says nothing about a cookie on `co.uk`).
 */
function related(domain: string, site: string): boolean {
  if (domain === site || domain.endsWith(`.${site}`)) return true;
  return site.endsWith(`.${domain}`) && !isPublicSuffix(domain);
}

/** Every HTTP host session's jar, kept in memory: one jar per host. */
export class CookieJars {
  /** In order of use, least recent first. */
  readonly #jars = new Map<string, CookieJar>();

  /** The number of jars held. */
  get size(): number {
    return this.#jars.size;
  }

  /** The cookies held across every jar, expired ones included until their jar is read. */
  get cookieCount(): number {
    let count = 0;
    for (const jar of this.#jars.values()) count += jar.size;
    return count;
  }

  /** The jar of the session with `host` (a URL's host name), made on first use. */
  jar(host: string): CookieJar {
    // `shop.test.` is `shop.test`: one session, and `forget` reaches it.
    const key = host.toLowerCase().replace(/\.+$/, '');
    let jar = this.#jars.get(key);
    if (jar === undefined) jar = new CookieJar();
    else this.#jars.delete(key);
    // Last in the map: the most recently used.
    this.#jars.set(key, jar);
    this.#trim(key);
    return jar;
  }

  /**
   * Holds both caps, never dropping `keep`. Too many jars: the least recently used go. Too many
   * cookies: the largest jars go first (the least recently used among equals), so the hosts that
   * filled the budget pay for it, not a watched shop with a handful of cookies that a page's
   * redirects pushed down the order.
   */
  #trim(keep: string): void {
    for (const host of this.#jars.keys()) {
      if (this.#jars.size <= MAX_JARS) break;
      if (host !== keep) this.#jars.delete(host);
    }
    let cookies = this.cookieCount;
    while (cookies > MAX_COOKIES_TOTAL) {
      let victim: string | undefined;
      let most = 0;
      for (const [host, jar] of this.#jars) {
        if (host !== keep && jar.size > most) {
          victim = host;
          most = jar.size;
        }
      }
      if (victim === undefined) return;
      cookies -= most;
      this.#jars.delete(victim);
    }
  }

  /**
   * Forgets `site` (a host name): every jar of that host or a host under it is emptied, and every
   * other jar drops the cookies set for that site, a domain under it, or a parent domain of it
   * (the bot manager's cookie on `example.com` for a wall on `www.example.com`).
   *
   * A site that is a public suffix (`myshopify.com`, the site of `www.myshopify.com`) has other
   * people's shops under it: only its own hosts (the name itself and its `www.`) are forgotten.
   */
  forget(site: string): void {
    const bare = bareSite(site);
    if (bare === '') return;
    if (isPublicSuffix(bare)) {
      for (const [host, jar] of this.#jars) {
        if (host === bare || host === `www.${bare}`) jar.clear();
        else jar.remove((cookie) => cookie.domain === bare || cookie.domain === `www.${bare}`);
      }
      return;
    }
    for (const [host, jar] of this.#jars) {
      if (host === bare || host.endsWith(`.${bare}`)) jar.clear();
      else jar.remove((cookie) => related(cookie.domain, bare));
    }
  }
}
