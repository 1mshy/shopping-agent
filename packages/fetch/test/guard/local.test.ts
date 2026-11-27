// The machine's own networks: a global address of this host or of a device on its link is refused
// like a private one (found by the independent review of 2026-11-25: on an IPv6 network the host
// and its LAN have addresses in 2000::/3, which the special-purpose table lets through).
import { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  guardedExchange,
  type InterfaceAddress,
  onOwnNetwork,
  ownNetworksOf,
  parseDeniedNetworks,
} from '../../src/guard/index.ts';

const HOME: InterfaceAddress[] = [
  { address: '127.0.0.1', cidr: '127.0.0.1/8', internal: true },
  { address: '10.0.0.32', cidr: '10.0.0.32/24', internal: false },
  { address: 'fe80::1c2d:3e4f:5a6b:7c8d', cidr: 'fe80::1c2d:3e4f:5a6b:7c8d/64', internal: false },
  {
    address: '2607:f2c0:1234:6100:1c2d:3e4f:5a6b:7c8d',
    cidr: '2607:f2c0:1234:6100:1c2d:3e4f:5a6b:7c8d/64',
    internal: false,
  },
  // A server's public IPv4 address, and a tunnel that states the whole internet as its link.
  { address: '203.0.114.25', cidr: '203.0.114.25/24', internal: false },
  { address: '45.80.12.7', cidr: '45.80.12.7/0', internal: false },
  { address: 'fe80::1%utun3', cidr: null, internal: false },
  { address: 'not-an-address', cidr: 'not-an-address/64', internal: false },
];
const own = ownNetworksOf(HOME);

describe('ownNetworksOf and onOwnNetwork', () => {
  it('holds the host itself and the devices on its link, at global addresses too', () => {
    expect(onOwnNetwork('2607:f2c0:1234:6100:1c2d:3e4f:5a6b:7c8d', own)).toBe(true);
    expect(onOwnNetwork('2607:f2c0:1234:6100::1', own)).toBe(true);
    expect(onOwnNetwork('203.0.114.25', own)).toBe(true);
    expect(onOwnNetwork('203.0.114.200', own)).toBe(true);
    expect(onOwnNetwork('::ffff:203.0.114.25', own)).toBe(true);
    expect(onOwnNetwork('10.0.0.1', own)).toBe(true);
  });

  it('does not hold the next network over, nor the internet behind a /0 tunnel', () => {
    expect(onOwnNetwork('2607:f2c0:1234:6101::1', own)).toBe(false);
    expect(onOwnNetwork('2606:4700:4700::1111', own)).toBe(false);
    expect(onOwnNetwork('203.0.115.25', own)).toBe(false);
    expect(onOwnNetwork('93.184.216.34', own)).toBe(false);
    // The tunnel's own address is held, its stated /0 is not.
    expect(onOwnNetwork('45.80.12.7', own)).toBe(true);
    expect(onOwnNetwork('45.80.12.8', own)).toBe(false);
  });

  it('skips what it cannot read and never throws', () => {
    expect(onOwnNetwork('not-an-address', own)).toBe(false);
    expect(ownNetworksOf([{ address: '', cidr: null, internal: false }])).toEqual([]);
  });
});

describe('guardedExchange and the machine’s own networks', () => {
  const ownNetworks = () => own;
  function net(
    answers: Record<string, string[]>,
    replies: Record<string, { status: number; location?: string }>,
  ) {
    const dialled: string[] = [];
    return {
      dialled,
      async lookup(host: string) {
        return answers[host] ?? [];
      },
      async exchange(address: string, _port: number, url: string) {
        dialled.push(`${address} ${url}`);
        return replies[url] ?? { status: 200 };
      },
    };
  }
  const refused = {
    delivered: false,
    outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
  };

  it('refuses the host’s own global address as a literal, without a request', async () => {
    const n = net({}, {});
    const url = 'http://[2607:f2c0:1234:6100:1c2d:3e4f:5a6b:7c8d]:8080/api/health';
    expect(await guardedExchange({ url, rung: 'http' }, n, { ownNetworks })).toEqual(refused);
    expect(n.dialled).toEqual([]);
  });

  it('refuses a name that resolves to a device on the host’s link', async () => {
    const n = net({ 'printer.attacker.example': ['2607:f2c0:1234:6100::50'] }, {});
    const result = await guardedExchange(
      { url: 'http://printer.attacker.example/', rung: 'http' },
      n,
      { ownNetworks },
    );
    expect(result).toEqual(refused);
    expect(n.dialled).toEqual([]);
  });

  it('refuses a name with one own-network address among public ones', async () => {
    const n = net({ 'mixed.attacker.example': ['93.184.216.34', '203.0.114.25'] }, {});
    const result = await guardedExchange(
      { url: 'http://mixed.attacker.example/', rung: 'http' },
      n,
      { ownNetworks },
    );
    expect(result).toEqual(refused);
    expect(n.dialled).toEqual([]);
  });

  it('refuses a redirect to the host’s own address: only the first hop is requested', async () => {
    const n = net(
      { 'shop.example': ['93.184.216.34'] },
      {
        'https://shop.example/p': {
          status: 302,
          location: 'http://[2607:f2c0:1234:6100:1c2d:3e4f:5a6b:7c8d]:8080/api/refresh',
        },
      },
    );
    const result = await guardedExchange({ url: 'https://shop.example/p', rung: 'http' }, n, {
      ownNetworks,
    });
    expect(result).toEqual(refused);
    expect(n.dialled).toEqual(['93.184.216.34 https://shop.example/p']);
  });

  it('adds configured prefixes to interface checks for both initial and subsequent hops', async () => {
    const options = { ownNetworks, deniedNetworks: parseDeniedNetworks('45.81.0.0/20') };
    const first = 'https://store.example/product';
    const next = 'https://catalog.example/item';
    for (const address of ['45.81.15.255', '203.0.114.25']) {
      const blocked = net({ 'store.example': [address] }, {});
      expect(await guardedExchange({ url: first, rung: 'http' }, blocked, options)).toEqual(
        refused,
      );
      expect(blocked.dialled).toEqual([]);
      const redirect = net(
        { 'store.example': ['93.184.216.34'], 'catalog.example': [address] },
        {
          [first]: { status: 302, location: next },
        },
      );
      expect(await guardedExchange({ url: first, rung: 'http' }, redirect, options)).toEqual(
        refused,
      );
      expect(redirect.dialled).toEqual([`93.184.216.34 ${first}`]);
    }
    const allowed = net({ 'store.example': ['45.81.16.0'] }, {});
    expect(await guardedExchange({ url: first, rung: 'http' }, allowed, options)).toMatchObject({
      delivered: true,
      status: 200,
    });
  });

  it('normalises mapped operator addresses and mapped prefixes to the native IPv4 range', () => {
    const single = parseDeniedNetworks('::ffff:192.0.2.5');
    expect(onOwnNetwork('192.0.2.5', single)).toBe(true);
    expect(onOwnNetwork('192.0.2.6', single)).toBe(false);
    const prefix = parseDeniedNetworks('::ffff:192.0.2.0/120');
    for (const address of ['192.0.2.254', '::ffff:192.0.2.254', '64:ff9b::192.0.2.254']) {
      expect(onOwnNetwork(address, prefix)).toBe(true);
    }
    expect(onOwnNetwork('192.0.3.0', prefix)).toBe(false);
    expect(() => parseDeniedNetworks('::ffff:192.0.2.0/95')).toThrow(/FETCH_DENY_CIDRS/);
  });

  it('returns the operator policy refusal for a literal next hop even at the redirect limit', async () => {
    const first = 'https://store.example/product';
    const scripted = net(
      { 'store.example': ['93.184.216.34'] },
      {
        [first]: { status: 302, location: 'https://45.81.1.10/product' },
      },
    );
    expect(
      await guardedExchange({ url: first, rung: 'http' }, scripted, {
        maxRedirects: 0,
        ownNetworks,
        deniedNetworks: parseDeniedNetworks('45.81.0.0/20'),
      }),
    ).toEqual(refused);
    expect(scripted.dialled).toEqual([`93.184.216.34 ${first}`]);
  });

  it('still reaches a public address', async () => {
    const n = net({ 'shop.example': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] }, {});
    const result = await guardedExchange({ url: 'https://shop.example/p', rung: 'http' }, n, {
      ownNetworks,
    });
    expect(result).toMatchObject({ delivered: true, status: 200 });
  });

  it('by default refuses every address of this machine’s own interfaces', async () => {
    const addresses = Object.values(networkInterfaces())
      .flatMap((list) => list ?? [])
      .filter((entry) => !entry.internal)
      .map((entry) => entry.address.split('%')[0] as string);
    for (const address of addresses) {
      const n = net({}, {});
      const host = address.includes(':') ? `[${address}]` : address;
      const result = await guardedExchange({ url: `http://${host}:8080/`, rung: 'http' }, n);
      expect(result.delivered, address).toBe(false);
      expect(n.dialled, address).toEqual([]);
    }
  });
});
