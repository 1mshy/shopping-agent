// The pieces of the verdict-cache key (S§4.1 `match_verdict`, S§5.4): the spec fingerprint, the
// listing fingerprint (store, SKU or clean URL, title hash, variant) and the key that joins them
// with the matcher version, prompt version and model id. Pure: a small FNV-1a hash in TypeScript
// (no node:crypto, no Web Crypto), over a canonical text of the inputs. Not a security hash: it
// only has to tell cached decisions apart.
import { normaliseGtin } from './gtin.ts';
import type { MatchAsked } from './types.ts';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** The UTF-8 bytes of a string, without TextEncoder (not declared in packages/core). */
function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/** 64-bit FNV-1a of the text's UTF-8 bytes, as 16 lower-case hex digits. */
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET;
  for (const b of utf8(text)) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}

/** Text as compared for a fingerprint: NFKC, lower case, whitespace collapsed. */
export function canonicalText(text: string | null | undefined): string {
  return typeof text === 'string'
    ? text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
    : '';
}

/**
 * The spec fingerprint: what the matcher reads of the asked side (S§5.4 identity: name, brand,
 * model, MPN, GTIN normalised to 14 digits, must-have attributes in attribute order, pack
 * quantity). Two intents that differ only in what the matcher does not read share it.
 */
export function specFingerprint(asked: MatchAsked): string {
  const mustHave = [...asked.mustHave]
    .map((m) => [canonicalText(m.attribute), canonicalText(m.value)] as const)
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  const canonical = JSON.stringify([
    'spec/1',
    canonicalText(asked.name),
    canonicalText(asked.brand),
    canonicalText(asked.model),
    canonicalText(asked.mpn),
    normaliseGtin(asked.gtin) ?? '',
    mustHave,
    asked.packQuantity ?? null,
  ]);
  return `spec1:${fnv1a64(canonical)}`;
}

/** Query parameters that only track a visit and never select a product. */
const TRACKING =
  /^(?:utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|srsltid|ref|ref_|_pos|_sid|_ss|_psq|_v|spm|scm)$/i;

/**
 * A clean URL: lower-case scheme and host, no default port, no fragment, no tracking
 * parameters, the rest of the query sorted, no trailing slash. Null when it does not parse.
 */
export function cleanUrl(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const u = new URL(url);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
  return `${u.protocol}//${u.host.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}

export interface ListingIdentity {
  /** The store, as its stable id or its host and market prefix. */
  readonly store: string;
  readonly sku: string | null;
  readonly url: string | null;
  readonly title: string;
  readonly variant: Readonly<Record<string, string>>;
}

/** The parts of the listing fingerprint (S§4.1): store, SKU or clean URL, title hash, variant. */
export function listingFingerprintParts(
  listing: ListingIdentity,
): readonly [string, string, string, string] {
  const sku = canonicalText(listing.sku);
  const url = listing.url === null ? null : cleanUrl(listing.url);
  const where = sku !== '' ? `sku:${sku}` : url !== null ? `url:${url}` : 'none';
  const variant = Object.entries(listing.variant)
    .map(([k, v]) => [canonicalText(k), canonicalText(v)] as const)
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return [
    canonicalText(listing.store),
    where,
    fnv1a64(canonicalText(listing.title)),
    fnv1a64(JSON.stringify(variant)),
  ];
}

/** The listing fingerprint: a retitled or re-optioned listing gets a new one, so it is judged again. */
export function listingFingerprint(listing: ListingIdentity): string {
  return `listing1:${fnv1a64(JSON.stringify(listingFingerprintParts(listing)))}`;
}

export interface VerdictKeyParts {
  readonly specFp: string;
  readonly listingFp: string;
  readonly matcherVersion: string;
  /** Null for a verdict no model made. */
  readonly promptVersion: string | null;
  readonly modelId: string | null;
}

/** The verdict cache key (S§5.4): spec, listing, matcher version, prompt version, model id. */
export function verdictKey(k: VerdictKeyParts): string {
  return JSON.stringify([k.specFp, k.listingFp, k.matcherVersion, k.promptVersion, k.modelId]);
}
