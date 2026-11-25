// The address decision of the guard (S§5.1): may a connection go to this IP address? Pure, no I/O,
// so the browser add-on's filtering proxy can reuse it as is.
//
// Refused: every range of the IANA IPv4 and IPv6 Special-Purpose Address Registries (settled by
// the orchestrator on 2026-11-23: "every IANA special-purpose address range is refused"), whether
// or not the registry marks it globally reachable; IPv4 multicast (its own registry; the
// predecessor refused it); and in IPv6 everything outside 2000::/3, the only space IANA allocates
// for global unicast (multicast, unique-local, link-local, site-local, unassigned, reserved).
// An IPv4 address carried in IPv6 is judged by that IPv4 address: an IPv4-mapped address
// (::ffff:0:0/96), and a NAT64 address of the well-known prefix (64:ff9b::/96), which S§5.1
// exempts from the registry rule because on an IPv6-only network every IPv4-only shop resolves
// to one. Anything the parser cannot place exactly (a non-canonical IPv4 spelling, a zone id,
// surrounding text) is refused: the decision fails closed.
import { isIPv4, isIPv6 } from 'node:net';
import ipaddr from 'ipaddr.js';

export type AddressVerdict =
  /** A connection may go to `address`, the form to dial (canonical; IPv4 for an IPv4-mapped one). */
  | { readonly allowed: true; readonly address: string }
  /** Refused; `why` names the range or the parse failure, for logs. */
  | { readonly allowed: false; readonly why: string };

type Cidr = readonly [string, number, string];

/** IANA IPv4 Special-Purpose Address Registry (2025), plus multicast. Every entry is refused. */
const IPV4_REFUSED: readonly Cidr[] = [
  ['0.0.0.0', 8, '"this network" (RFC 791)'],
  ['10.0.0.0', 8, 'private-use (RFC 1918)'],
  ['100.64.0.0', 10, 'shared address space, CGNAT (RFC 6598)'],
  ['127.0.0.0', 8, 'loopback (RFC 1122)'],
  ['169.254.0.0', 16, 'link-local, cloud metadata (RFC 3927)'],
  ['172.16.0.0', 12, 'private-use (RFC 1918)'],
  ['192.0.0.0', 24, 'IETF protocol assignments (RFC 6890)'],
  ['192.0.2.0', 24, 'documentation TEST-NET-1 (RFC 5737)'],
  ['192.31.196.0', 24, 'AS112-v4 (RFC 7535)'],
  ['192.52.193.0', 24, 'AMT (RFC 7450)'],
  ['192.88.99.0', 24, 'deprecated 6to4 relay anycast (RFC 7526)'],
  ['192.168.0.0', 16, 'private-use (RFC 1918)'],
  ['192.175.48.0', 24, 'direct delegation AS112 service (RFC 7534)'],
  ['198.18.0.0', 15, 'benchmarking (RFC 2544)'],
  ['198.51.100.0', 24, 'documentation TEST-NET-2 (RFC 5737)'],
  ['203.0.113.0', 24, 'documentation TEST-NET-3 (RFC 5737)'],
  ['224.0.0.0', 4, 'multicast (RFC 5771)'],
  ['240.0.0.0', 4, 'reserved (RFC 1112), limited broadcast (RFC 8190)'],
];

/** IANA IPv6 Special-Purpose Address Registry (2025) entries inside 2000::/3. Every one refused. */
const IPV6_REFUSED_IN_GLOBAL: readonly Cidr[] = [
  ['2001::', 23, 'IETF protocol assignments: Teredo, ORCHID, AMT, AS112, benchmarking (RFC 2928)'],
  ['2001:db8::', 32, 'documentation (RFC 3849)'],
  ['2002::', 16, '6to4 (RFC 3056)'],
  ['2620:4f:8000::', 48, 'direct delegation AS112 service (RFC 7534)'],
  ['3fff::', 20, 'documentation (RFC 9637)'],
];

/** IPv6 ranges outside 2000::/3, named for the refusal message only (all of them are refused). */
const IPV6_OUTSIDE_GLOBAL_NAMES: readonly Cidr[] = [
  ['::', 128, 'unspecified (RFC 4291)'],
  ['::1', 128, 'loopback (RFC 4291)'],
  ['::', 96, 'IPv4-compatible, deprecated (RFC 4291)'],
  ['::ffff:0:0:0', 96, 'IPv4-translated (RFC 2765)'],
  ['64:ff9b:1::', 48, 'local-use IPv4/IPv6 translation (RFC 8215)'],
  ['100::', 64, 'discard-only (RFC 6666)'],
  ['100:0:0:1::', 64, 'dummy prefix (RFC 9780)'],
  ['5f00::', 16, 'SRv6 SIDs (RFC 9602)'],
  ['fc00::', 7, 'unique-local, IPv6 cloud metadata (RFC 4193)'],
  ['fe80::', 10, 'link-local (RFC 4291)'],
  ['fec0::', 10, 'site-local, deprecated (RFC 3879)'],
  ['ff00::', 8, 'multicast (RFC 4291)'],
];

const IPV4_MAPPED = ipaddr.IPv6.parseCIDR('::ffff:0:0/96');
const NAT64_WELL_KNOWN = ipaddr.IPv6.parseCIDR('64:ff9b::/96');
const GLOBAL_UNICAST = ipaddr.IPv6.parseCIDR('2000::/3');

function compile<T extends ipaddr.IPv4 | ipaddr.IPv6>(
  table: readonly Cidr[],
  parse: (text: string) => T,
): readonly (readonly [T, number, string])[] {
  return table.map(([network, bits, name]) => [parse(network), bits, `${network}/${bits} ${name}`]);
}

const V4 = compile(IPV4_REFUSED, (t) => ipaddr.IPv4.parse(t));
const V6_IN_GLOBAL = compile(IPV6_REFUSED_IN_GLOBAL, (t) => ipaddr.IPv6.parse(t));
const V6_OUTSIDE = compile(IPV6_OUTSIDE_GLOBAL_NAMES, (t) => ipaddr.IPv6.parse(t));

/** Strict dotted-quad decimal: four parts 0-255, no leading zeros, nothing else. */
const DOTTED_QUAD =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/;
/** Hex groups, colons and an optional dotted tail; no zone id, no brackets, no spaces. */
const IPV6_CHARS = /^[0-9A-Fa-f:.]+$/;

function refuse(why: string): AddressVerdict {
  return { allowed: false, why };
}

function judgeV4(ip: ipaddr.IPv4): string | null {
  for (const [network, bits, name] of V4) if (ip.match(network, bits)) return name;
  return null;
}

/**
 * Decides whether a connection may go to `text`, an IP address as a resolver or a URL parser
 * writes it: IPv4 in dotted-quad decimal, IPv6 in RFC 4291 text form (without brackets or zone).
 */
export function judgeAddress(text: string): AddressVerdict {
  if (typeof text !== 'string') return refuse('not an address');
  if (DOTTED_QUAD.test(text) && isIPv4(text)) {
    const ip = ipaddr.IPv4.parse(text);
    const range = judgeV4(ip);
    return range === null ? { allowed: true, address: ip.toString() } : refuse(range);
  }
  if (!IPV6_CHARS.test(text) || !isIPv6(text)) {
    return refuse(text.includes('%') ? 'scoped address (zone id)' : 'not an IP address');
  }
  let ip: ipaddr.IPv6;
  try {
    ip = ipaddr.IPv6.parse(text);
  } catch {
    return refuse('not an IP address');
  }
  if (ip.zoneId !== undefined) return refuse('scoped address (zone id)');
  if (ip.match(IPV4_MAPPED)) {
    const v4 = ip.toIPv4Address();
    const range = judgeV4(v4);
    return range === null
      ? { allowed: true, address: v4.toString() }
      : refuse(`IPv4-mapped ${v4.toString()}: ${range}`);
  }
  if (ip.match(NAT64_WELL_KNOWN)) {
    const parts = ip.parts;
    const v4 = new ipaddr.IPv4([
      (parts[6] ?? 0) >> 8,
      (parts[6] ?? 0) & 0xff,
      (parts[7] ?? 0) >> 8,
      (parts[7] ?? 0) & 0xff,
    ]);
    const range = judgeV4(v4);
    return range === null
      ? { allowed: true, address: ip.toRFC5952String() }
      : refuse(`NAT64 of ${v4.toString()}: ${range}`);
  }
  if (!ip.match(GLOBAL_UNICAST)) {
    // Most specific name first: the table lists /128 before the /96 that contains them.
    for (const [network, bits, name] of V6_OUTSIDE)
      if (ip.match(network, bits)) return refuse(name);
    return refuse('outside 2000::/3, not global unicast');
  }
  for (const [network, bits, name] of V6_IN_GLOBAL)
    if (ip.match(network, bits)) return refuse(name);
  return { allowed: true, address: ip.toRFC5952String() };
}
