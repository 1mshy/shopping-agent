// The form clauses of the guard (S§5.1): "http/https only; a URL not acceptable as written
// (user-info, no host) refused". Pure.
//
// The text is judged as written before any parser normalises it, because parsers disagree:
// the WHATWG parser reads "https:///p/1" as host "p", turns "\" into "/", drops tabs and line
// breaks, and accepts "http:host" without slashes, where other parsers see no host or another
// host. A guard and a transport that read different hosts is the classic way past an address
// check (S§5.15), so such text is refused (`url_form`) instead of being interpreted. What is
// accepted is then parsed once by the WHATWG parser, and from there on only its canonical
// serialisation is used: the host the guard judges is the host the transport is told to reach.

/** The refusal reasons of the form clauses. */
export type FormReason = 'scheme' | 'url_form';

export type TargetHost =
  /** An IP literal in any spelling the parser accepts, canonicalised (IPv6 without brackets). */
  | { readonly kind: 'address'; readonly address: string }
  /** A host name, lowercased and IDNA-encoded by the parser, as it goes to the resolver. */
  | { readonly kind: 'name'; readonly name: string };

/** A URL that passed the form clauses. */
export interface Target {
  /** The canonical absolute URL without its fragment: what goes on the wire. */
  readonly href: string;
  readonly scheme: 'http' | 'https';
  readonly host: TargetHost;
  /** The port to connect to: the URL's, or 80/443. */
  readonly port: number;
}

export type TargetParse =
  | { readonly ok: true; readonly target: Target }
  | { readonly ok: false; readonly reason: FormReason };

/** An RFC 3986 scheme followed by its colon, at the very start of the text. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
/** A strict dotted-quad: how the WHATWG parser serialises every IPv4 host it accepts. */
const DOTTED_QUAD = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function fail(reason: FormReason): TargetParse {
  return { ok: false, reason };
}

/** C0 controls (U+0000-U+001F), space and DEL: never valid in a URL, and dropped by parsers. */
function hasControlOrSpace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit <= 0x20 || unit === 0x7f) return true;
  }
  return false;
}

/**
 * True when the text has characters a parser would drop or reinterpret: controls and spaces
 * anywhere, a backslash before the query (WHATWG reads it as "/", others as a character).
 */
export function hasAmbiguousCharacters(text: string): boolean {
  if (hasControlOrSpace(text)) return true;
  const end = text.search(/[?#]/);
  return (end === -1 ? text : text.slice(0, end)).includes('\\');
}

/** Applies the form clauses to `text` and returns the target to resolve and reach. */
export function parseTarget(text: string): TargetParse {
  if (typeof text !== 'string') return fail('scheme');
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return fail('scheme');
  if (hasAmbiguousCharacters(text)) return fail('url_form');
  const afterScheme = text.slice(scheme.length + 1);
  if (!afterScheme.startsWith('//')) return fail('url_form');
  const rest = afterScheme.slice(2);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  // User-info, even empty ("http://@host"), and an authority with no host before its port.
  if (authority.includes('@') || authority === '' || authority.startsWith(':')) {
    return fail('url_form');
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail('url_form');
  }
  if (url.protocol !== `${scheme}:` || url.username !== '' || url.password !== '') {
    return fail('url_form');
  }
  const hostname = url.hostname;
  if (hostname === '') return fail('url_form');
  url.hash = '';
  let host: TargetHost;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    host = { kind: 'address', address: hostname.slice(1, -1) };
  } else if (DOTTED_QUAD.test(hostname)) {
    host = { kind: 'address', address: hostname };
  } else {
    host = { kind: 'name', name: hostname };
  }
  const port = url.port === '' ? (scheme === 'https' ? 443 : 80) : Number(url.port);
  return { ok: true, target: { href: url.href, scheme, host, port } };
}

/**
 * The target a redirect's Location names, from the hop it came from, through the same form
 * clauses. An absolute Location is judged as written, like any URL. A network-path one
 * ("//host/p") is judged as written under the hop's scheme. A path-relative one keeps the hop's
 * authority, so it is resolved by the parser, after the same character check.
 */
export function resolveLocation(location: string, from: Target): TargetParse {
  if (typeof location !== 'string') return fail('url_form');
  if (SCHEME.test(location)) return parseTarget(location);
  if (hasAmbiguousCharacters(location)) return fail('url_form');
  if (location.startsWith('//')) return parseTarget(`${from.scheme}:${location}`);
  let resolved: string;
  try {
    resolved = new URL(location, from.href).href;
  } catch {
    return fail('url_form');
  }
  return parseTarget(resolved);
}
