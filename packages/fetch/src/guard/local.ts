// The machine's own networks (S§5.1 "Guard first", S§5.15): a page must not be able to make this
// process connect to the machine itself or to its LAN. The IANA special-purpose table
// (address.ts) covers private IPv4, loopback, link-local and unique-local space, but on an IPv6
// network the machine and every device beside it have global addresses, and a server on a public
// IPv4 address is reachable at it. A site the agent visits sees the address the request came
// from, so it could answer with a redirect to that address, or point a name at a neighbour.
// These are refused here: every address of a network interface of this machine, and every
// address on the same link as one (the interface's prefix).
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import ipaddr from 'ipaddr.js';

/** One network of this machine: an address and how many leading bits name the network. */
export type OwnNetwork = readonly [address: ipaddr.IPv4 | ipaddr.IPv6, bits: number];

/** Operator-supplied networks extend the guard on hosts whose interfaces Docker cannot see. */
export function parseDeniedNetworks(setting: string | undefined): OwnNetwork[] {
  if (!setting?.trim()) return [];
  return setting.split(',').map((entry, index) => {
    const [address = '', prefix, ...extra] = entry.trim().split('/');
    const family = isIP(address);
    const width = family === 4 ? 32 : 128;
    const bits = prefix === undefined ? width : Number(prefix);
    if (
      family === 0 ||
      address.includes('%') ||
      extra.length > 0 ||
      (prefix !== undefined && !/^(?:0|[1-9][0-9]{0,2})$/.test(prefix)) ||
      bits > width
    ) {
      throw new Error(
        `FETCH_DENY_CIDRS entry ${index + 1} must be an IPv4 or IPv6 address or CIDR`,
      );
    }
    const parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
      if (bits < 96) {
        throw new Error(
          `FETCH_DENY_CIDRS entry ${index + 1} extends outside the IPv4-mapped prefix`,
        );
      }
      return [parsed.toIPv4Address(), bits - 96];
    }
    return [parsed, bits];
  });
}

/** What `os.networkInterfaces()` gives for one address; only these fields are read. */
export interface InterfaceAddress {
  readonly address: string;
  readonly cidr: string | null;
  readonly internal: boolean;
}

/**
 * The shortest prefix taken as "the link". A tunnel or a point-to-point interface may state a
 * prefix as short as /0, which would refuse the whole internet; below these lengths only the
 * interface's own address is refused.
 */
export const SHORTEST_LINK_PREFIX = { ipv4: 16, ipv6: 48 } as const;

/** The networks of the given interface addresses. Pure; an entry that cannot be read is skipped. */
export function ownNetworksOf(addresses: readonly InterfaceAddress[]): OwnNetwork[] {
  const networks: OwnNetwork[] = [];
  for (const entry of addresses) {
    // Loopback is refused by the address table already.
    if (entry.internal) continue;
    // A link-local address carries a zone ("fe80::1%en0"); it is refused by the table too.
    const text = entry.address.split('%')[0] ?? '';
    if (!ipaddr.isValid(text)) continue;
    const address = ipaddr.parse(text);
    const kind = address.kind() as 'ipv4' | 'ipv6';
    const whole = kind === 'ipv4' ? 32 : 128;
    let bits = whole;
    const stated = Number((entry.cidr ?? '').split('/')[1]);
    if (Number.isInteger(stated) && stated >= SHORTEST_LINK_PREFIX[kind] && stated <= whole) {
      bits = stated;
    }
    networks.push([address, bits]);
  }
  return networks;
}

/** The networks of this machine's interfaces now. Cheap; read again for every request. */
export function hostNetworks(): OwnNetwork[] {
  const all: InterfaceAddress[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) all.push(entry);
  }
  return ownNetworksOf(all);
}

/** The NAT64 well-known prefix (RFC 6052): its last 32 bits are an IPv4 address. */
const NAT64_WELL_KNOWN = ipaddr.IPv6.parseCIDR('64:ff9b::/96');

/** True when `address` (an IP address as the guard writes it) is on one of `networks`. */
export function onOwnNetwork(address: string, networks: readonly OwnNetwork[]): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const contains = (ip: ipaddr.IPv4 | ipaddr.IPv6): boolean =>
    networks.some(([network, bits]) => ip.kind() === network.kind() && ip.match(network, bits));
  if (contains(parsed)) return true;
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return contains((parsed as ipaddr.IPv6).toIPv4Address());
  } else if (parsed.kind() === 'ipv6' && parsed.match(NAT64_WELL_KNOWN)) {
    // The address table lets a public IPv4 address through this prefix (address.ts); an own
    // IPv4 address written that way is still an own address.
    return contains(new ipaddr.IPv4(parsed.toByteArray().slice(12)));
  }
  return false;
}
