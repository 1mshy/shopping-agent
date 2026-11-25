// Which host names this server answers for (S§5.13, S§5.15): the defence against DNS rebinding.
//
// The CSRF rule compares a request's Origin with the server's own origin, and the server learns
// its own origin from the request's Host header. A hostile page can point its own name at this
// server's address ("rebinding"): its requests then carry an Origin and a Host that agree, and
// every same-origin rule passes. So the Host itself is judged first, on every /api request.
//
// Answered without configuration, because no public DNS name can be made to carry them:
//   - an IP address literal (the page would have to be served from this server already);
//   - `localhost` and names under it;
//   - a single-label name (`nas`, a Compose service name): resolved by the LAN or a search domain;
//   - names under the local-only suffixes below, which are not delegated in the public DNS.
// Any other name (a domain of the owner's behind a reverse proxy, a tailnet name) must be listed
// in the ALLOWED_HOSTS environment variable. It is an environment variable and not a setting on
// purpose: nothing reachable over the API can widen it.

/** Suffixes that are not delegated in the public DNS (RFC 6762, RFC 8375, ICANN's reservations). */
const LOCAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.lan',
  '.home',
  '.internal',
  '.home.arpa',
  '.localdomain',
  '.test',
];

const HOST_CHARACTERS = /^[A-Za-z0-9._:[\]-]+$/;
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Characters that end or split an authority: never part of a host, in a header or a list. */
const NOT_A_HOST = /[\s/\\@?#]/;

/**
 * The host name of a Host header (`name`, `name:port`, `[v6]:port`), lower-cased; null when
 * malformed. A header is ASCII; `unicode` is for a name a person typed into ALLOWED_HOSTS, which
 * the parser turns into the punycode form requests carry.
 */
export function hostNameOf(
  host: string | undefined | null,
  options: { unicode?: boolean } = {},
): string | null {
  if (typeof host !== 'string' || host === '' || NOT_A_HOST.test(host)) return null;
  if (!options.unicode && !HOST_CHARACTERS.test(host)) return null;
  let name: string;
  try {
    const url = new URL(`http://${host}`);
    if (url.username !== '' || url.password !== '' || url.pathname !== '/') return null;
    name = url.hostname;
  } catch {
    return null;
  }
  name = name.toLowerCase().replace(/\.$/, '');
  return name === '' ? null : name;
}

export interface AllowedHosts {
  /** Names as requests carry them: lower case, punycode, no port; a leading dot lists a domain. */
  readonly names: string[];
  /** Entries that are not host names, as written: said once at start-up, never matched. */
  readonly rejected: string[];
}

/**
 * `ALLOWED_HOSTS`: names separated by commas or spaces, read as people write them. A port is
 * dropped (`name:8443`), a leading `.` or `*.` lists every name under a domain, and a Unicode name
 * is stored in punycode.
 */
export function parseAllowedHosts(text: string | undefined): AllowedHosts {
  const names: string[] = [];
  const rejected: string[] = [];
  for (const entry of (text ?? '').split(/[\s,]+/)) {
    if (entry === '') continue;
    const domain = entry.startsWith('*.') ? entry.slice(1) : entry;
    const wide = domain.startsWith('.');
    const name = hostNameOf(wide ? domain.slice(1) : domain, { unicode: true });
    if (name === null || name.startsWith('[')) rejected.push(entry);
    else names.push(wide ? `.${name}` : name);
  }
  return { names, rejected };
}

/** True when this server answers for `host` (a Host header's value). */
export function hostAllowed(host: string | undefined | null, allowed: readonly string[]): boolean {
  const name = hostNameOf(host);
  if (name === null) return false;
  // The URL parser gives an IPv6 literal in brackets and every IPv4 spelling as a dotted quad.
  if (name.startsWith('[') || DOTTED_QUAD.test(name)) return true;
  if (name === 'localhost' || !name.includes('.')) return true;
  if (LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return allowed.some((entry) => {
    const listed = entry.toLowerCase().replace(/\.$/, '');
    return listed.startsWith('.') ? name.endsWith(listed) : name === listed;
  });
}
