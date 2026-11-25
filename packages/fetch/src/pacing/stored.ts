// How the pacing and the playbook key and time their rows (S§4): a host as the guard's parser
// spells it (lower case, IDNA-encoded ASCII), an instant as a UTC ISO string with exactly three
// fractional digits, so text order is time order. The tables CHECK both; these refuse earlier.
import type { Target } from '../guard/index.ts';

const STORED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Printable ASCII without space: what the WHATWG parser leaves of any host it accepts. */
const ASCII_HOST = /^[!-~]+$/;

/**
 * The host a request is paced and kept in the playbook under: the guard's own reading of the URL
 * (never a second parser), lower case and punycode for a name, the bare address for an IP literal
 * (IPv6 without brackets), without the trailing dot of a fully qualified name. One host per name,
 * whatever the scheme or port.
 */
export function hostKey(target: Target): string {
  const host = target.host.kind === 'address' ? target.host.address : target.host.name;
  const bare = host.length > 1 && host.endsWith('.') ? host.slice(0, -1) : host;
  assertStorableHost(bare);
  return bare;
}

/** Throws a RangeError for a host the tables would refuse (empty, upper case, not ASCII). */
export function assertStorableHost(host: string): void {
  if (typeof host !== 'string' || !ASCII_HOST.test(host) || host !== host.toLowerCase()) {
    throw new RangeError(`not a stored host (lower-case ASCII): ${JSON.stringify(host)}`);
  }
}

/** Epoch milliseconds as the tables store an instant; a fraction of a millisecond rounds up. */
export function toStoredInstant(ms: number): string {
  if (!Number.isFinite(ms)) throw new RangeError(`not an instant: ${ms}`);
  const text = new Date(Math.ceil(ms)).toISOString();
  if (!STORED_INSTANT.test(text)) throw new RangeError(`instant out of range: ${text}`);
  return text;
}

/** A stored instant as epoch milliseconds. */
export function fromStoredInstant(text: string): number {
  if (typeof text !== 'string' || !STORED_INSTANT.test(text)) {
    throw new RangeError(`not a stored instant: ${JSON.stringify(text)}`);
  }
  return Date.parse(text);
}
