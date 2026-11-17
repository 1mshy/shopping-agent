// Minimal URL guard for the lab (S§5.1 "Guard first"). The product's guard is a Phase 1 unit;
// this one only keeps a list-driven probe off the LAN. Known gap: Node's fetch resolves the
// host again, so the connection is not pinned to the checked address (DNS rebinding window).
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type Lookup = (host: string) => Promise<Array<{ address: string; family: number }>>;
export interface GuardOptions {
  lookup?: Lookup;
  /** Tests only: lets the in-process fixture server on 127.0.0.1 through. */
  allowLoopback?: boolean;
}
export type GuardResult =
  | { ok: true; addresses: string[] }
  | { ok: false; reason: 'scheme' | 'credentials' | 'private_address' | 'dns'; code?: string };

function blockList(allowLoopback: boolean): BlockList {
  const b = new BlockList();
  const v4: Array<[string, number]> = [
    ['0.0.0.0', 8], // "this" network
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // CGNAT (also Alibaba's metadata 100.100.100.200)
    ['169.254.0.0', 16], // link-local, cloud metadata 169.254.169.254
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
  ];
  const v6: Array<[string, number]> = [
    ['::', 128], // unspecified
    ['64:ff9b::', 96], // NAT64 (can reach private v4)
    ['fc00::', 7], // unique local, incl. AWS metadata fd00:ec2::254
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
    ['2001:db8::', 32], // documentation
  ];
  if (!allowLoopback) {
    v4.push(['127.0.0.0', 8]);
    v6.push(['::1', 128]);
  }
  for (const [net, prefix] of v4) b.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of v6) b.addSubnet(net, prefix, 'ipv6');
  return b;
}
const LISTS = { strict: blockList(false), loopback: blockList(true) };

export function isBlockedAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const list = opts.allowLoopback ? LISTS.loopback : LISTS.strict;
  const family = isIP(ip);
  if (family === 0) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return list.check(mapped, 'ipv4');
  return list.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

export async function checkUrl(input: string | URL, opts: GuardOptions = {}): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'scheme' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      const lookup = opts.lookup ?? ((h: string) => dnsLookup(h, { all: true }));
      addresses = (await lookup(host)).map((a) => a.address);
    } catch (e) {
      return { ok: false, reason: 'dns', code: (e as { code?: string }).code ?? 'EDNS' };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: 'dns', code: 'ENODATA' };
  if (addresses.some((a) => isBlockedAddress(a, opts))) {
    return { ok: false, reason: 'private_address' };
  }
  return { ok: true, addresses };
}

/**
 * Same site for redirect purposes: equal after dropping a leading `www.`, or one is a subdomain
 * of the other. No public-suffix list, so `a.co.uk` and `b.co.uk` are (correctly) different.
 */
export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  const x = strip(a);
  const y = strip(b);
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}
