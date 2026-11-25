// Who is asking, and over what (S§5.13). Node-free: reads the Hono context only.
//
// The client address is the socket's peer address. X-Forwarded-For and X-Forwarded-Proto/Host are
// read only when the setting `auth.trustProxy` is on (the app sits behind a reverse proxy the owner
// runs), and then only the rightmost X-Forwarded-For entry is taken: the one the trusted proxy
// appended itself; everything left of it is whatever the client claimed.
import type { Context } from 'hono';

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string; encrypted?: boolean } };
}

function socketOf(c: Context) {
  return (c.env as NodeBindings | undefined)?.incoming?.socket;
}

function lastHeaderValue(c: Context, name: string): string | undefined {
  const raw = c.req.header(name);
  if (raw === undefined) return undefined;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.at(-1);
}

function firstHeaderValue(c: Context, name: string): string | undefined {
  const raw = c.req.header(name);
  const first = raw?.split(',')[0]?.trim();
  return first === '' ? undefined : first;
}

/** The client's address as seen by the server (or by the trusted proxy); `unknown` when absent. */
export function clientAddress(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = lastHeaderValue(c, 'x-forwarded-for');
    if (forwarded !== undefined && forwarded.length <= 64) return forwarded;
  }
  return socketOf(c)?.remoteAddress ?? 'unknown';
}

function expandIpv6(address: string): string[] | null {
  let bad = false;
  // A trailing dotted quad (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) becomes its two hextets.
  const text = address.replace(
    /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    (_all, a: string, b: string, c: string, d: string) => {
      const [p, q, r, s] = [a, b, c, d].map(Number) as [number, number, number, number];
      if (p > 255 || q > 255 || r > 255 || s > 255) bad = true;
      return `${((p << 8) | q).toString(16)}:${((r << 8) | s).toString(16)}`;
    },
  );
  if (bad) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const split = (part: string | undefined) => (part ? part.split(':') : []);
  const left = split(halves[0]);
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = split(halves[1]);
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<string>(missing).fill('0'), ...right];
}

/**
 * The throttle key of an address: an IPv4 address as is (also when IPv4-mapped), an IPv6 address
 * by its /64, since one host commonly holds a whole /64 and could otherwise rotate through it.
 */
export function throttleKey(address: string): string {
  const bare = address
    .trim()
    .toLowerCase()
    .replace(/%.*$/, '')
    .replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!bare.includes(':')) return bare === '' ? 'unknown' : bare;
  const groups = expandIpv6(bare);
  if (groups === null || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return bare;
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/**
 * The host (`name` or `name:port`) the browser addressed: the request's own, or with a trusted
 * proxy the one the proxy forwarded. It is what `requestOrigin` builds the origin from.
 */
export function requestHost(c: Context, trustProxy: boolean): string | null {
  try {
    if (trustProxy) {
      const forwarded = firstHeaderValue(c, 'x-forwarded-host');
      if (forwarded !== undefined) return forwarded;
    }
    return new URL(c.req.url).host;
  } catch {
    return null;
  }
}

/**
 * Every host a request names, for the Host check: the request's own, and with a trusted proxy the
 * forwarded one too. Both are judged, because a client that reaches the server directly can write
 * X-Forwarded-Host itself: the forwarded name alone would let it vouch for its own host.
 */
export function requestHosts(c: Context, trustProxy: boolean): (string | null)[] {
  let own: string | null;
  try {
    own = new URL(c.req.url).host;
  } catch {
    own = null;
  }
  const hosts = [own];
  if (trustProxy) {
    const forwarded = firstHeaderValue(c, 'x-forwarded-host');
    if (forwarded !== undefined) hosts.push(forwarded);
  }
  return hosts;
}

/** The request's own origin (`http://host:port`), as the browser addressed it. */
export function requestOrigin(c: Context, trustProxy: boolean): string | null {
  try {
    const url = new URL(c.req.url);
    let protocol = url.protocol;
    let host = url.host;
    if (trustProxy) {
      const proto = firstHeaderValue(c, 'x-forwarded-proto')?.toLowerCase();
      if (proto === 'https' || proto === 'http') protocol = `${proto}:`;
      const fwdHost = firstHeaderValue(c, 'x-forwarded-host');
      if (fwdHost !== undefined) host = fwdHost;
    }
    return new URL(`${protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

/** True when the request reached the server (or, with a trusted proxy, the proxy) over HTTPS. */
export function requestIsHttps(c: Context, trustProxy: boolean): boolean {
  return requestOrigin(c, trustProxy)?.startsWith('https:') ?? false;
}
