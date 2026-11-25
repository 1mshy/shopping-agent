// The address decision on its own (S§5.1): every range of the IANA IPv4 and IPv6 special-purpose
// registries refused, with an address inside each range and the nearest public address outside
// each boundary; multicast and everything outside IPv6 global unicast refused; IPv4 carried in
// IPv6 judged by the IPv4 address; anything the parser cannot place refused.
//
// The expected values are written out by hand from the registries (iana-ipv4-special-registry,
// iana-ipv6-special-registry, as published in 2025), not derived from the implementation's table.
import { describe, expect, test } from 'vitest';
import { judgeAddress } from '../../src/guard/address.ts';

interface Range {
  readonly range: string;
  /** Addresses inside the range (first, last, and any well-known one). */
  readonly inside: readonly string[];
  /** The nearest addresses just outside a boundary that are themselves public. */
  readonly outside: readonly string[];
}

const IPV4: readonly Range[] = [
  {
    range: '0.0.0.0/8 this network',
    inside: ['0.0.0.0', '0.0.0.1', '0.255.255.255'],
    outside: ['1.0.0.0'],
  },
  {
    range: '10.0.0.0/8 private',
    inside: ['10.0.0.0', '10.255.255.255'],
    outside: ['9.255.255.255', '11.0.0.0'],
  },
  {
    range: '100.64.0.0/10 shared address space (CGNAT)',
    inside: ['100.64.0.0', '100.127.255.255'],
    outside: ['100.63.255.255', '100.128.0.0'],
  },
  {
    range: '127.0.0.0/8 loopback',
    inside: ['127.0.0.0', '127.0.0.1', '127.255.255.255'],
    outside: ['126.255.255.255', '128.0.0.0'],
  },
  {
    range: '169.254.0.0/16 link-local (cloud metadata)',
    inside: ['169.254.0.0', '169.254.169.254', '169.254.255.255'],
    outside: ['169.253.255.255', '169.255.0.0'],
  },
  {
    range: '172.16.0.0/12 private',
    inside: ['172.16.0.0', '172.31.255.255'],
    outside: ['172.15.255.255', '172.32.0.0'],
  },
  {
    range:
      '192.0.0.0/24 IETF protocol assignments (DS-Lite, PCP and TURN anycast, NAT64 discovery)',
    inside: ['192.0.0.0', '192.0.0.8', '192.0.0.9', '192.0.0.10', '192.0.0.170', '192.0.0.255'],
    outside: ['191.255.255.255', '192.0.1.0'],
  },
  {
    range: '192.0.2.0/24 documentation (TEST-NET-1)',
    inside: ['192.0.2.0', '192.0.2.255'],
    outside: ['192.0.1.255', '192.0.3.0'],
  },
  {
    range: '192.31.196.0/24 AS112-v4',
    inside: ['192.31.196.0', '192.31.196.255'],
    outside: ['192.31.195.255', '192.31.197.0'],
  },
  {
    range: '192.52.193.0/24 AMT',
    inside: ['192.52.193.0', '192.52.193.255'],
    outside: ['192.52.192.255', '192.52.194.0'],
  },
  {
    range: '192.88.99.0/24 deprecated 6to4 relay anycast',
    inside: ['192.88.99.0', '192.88.99.2', '192.88.99.255'],
    outside: ['192.88.98.255', '192.88.100.0'],
  },
  {
    range: '192.168.0.0/16 private',
    inside: ['192.168.0.0', '192.168.255.255'],
    outside: ['192.167.255.255', '192.169.0.0'],
  },
  {
    range: '192.175.48.0/24 direct delegation AS112',
    inside: ['192.175.48.0', '192.175.48.255'],
    outside: ['192.175.47.255', '192.175.49.0'],
  },
  {
    range: '198.18.0.0/15 benchmarking',
    inside: ['198.18.0.0', '198.19.255.255'],
    outside: ['198.17.255.255', '198.20.0.0'],
  },
  {
    range: '198.51.100.0/24 documentation (TEST-NET-2)',
    inside: ['198.51.100.0', '198.51.100.255'],
    outside: ['198.51.99.255', '198.51.101.0'],
  },
  {
    range: '203.0.113.0/24 documentation (TEST-NET-3)',
    inside: ['203.0.113.0', '203.0.113.255'],
    outside: ['203.0.112.255', '203.0.114.0'],
  },
  {
    range: '224.0.0.0/4 multicast (own registry)',
    inside: ['224.0.0.0', '224.0.0.1', '239.255.255.255'],
    outside: ['223.255.255.255'],
  },
  { range: '240.0.0.0/4 reserved', inside: ['240.0.0.0', '255.255.255.254'], outside: [] },
  { range: '255.255.255.255/32 limited broadcast', inside: ['255.255.255.255'], outside: [] },
];

const IPV6: readonly Range[] = [
  { range: '::/128 unspecified', inside: ['::', '0:0:0:0:0:0:0:0'], outside: [] },
  { range: '::1/128 loopback', inside: ['::1', '0:0:0:0:0:0:0:1'], outside: [] },
  {
    range: '64:ff9b:1::/48 local-use IPv4/IPv6 translation',
    inside: ['64:ff9b:1::', '64:ff9b:1::101:101', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff'],
    outside: [],
  },
  {
    range: '100::/64 discard-only',
    inside: ['100::', '100::1', '100::ffff:ffff:ffff:ffff'],
    outside: [],
  },
  { range: '100:0:0:1::/64 dummy prefix', inside: ['100:0:0:1::1'], outside: [] },
  {
    range:
      '2001::/23 IETF protocol assignments (Teredo, PCP, TURN, AMT, AS112, ORCHID, DRIP, benchmarking)',
    inside: [
      '2001::',
      '2001::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '2001:1::1',
      '2001:1::2',
      '2001:1::3',
      '2001:2::1',
      '2001:3::1',
      '2001:4:112::1',
      '2001:10::1',
      '2001:20::1',
      '2001:30::1',
      '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    ],
    outside: ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:200::'],
  },
  {
    range: '2001:db8::/32 documentation',
    inside: ['2001:db8::', '2001:db8::1', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff'],
    outside: ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::'],
  },
  {
    range: '2002::/16 6to4',
    inside: ['2002::', '2002:7f00:1::1', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    outside: ['2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2003::'],
  },
  {
    range: '2620:4f:8000::/48 direct delegation AS112',
    inside: ['2620:4f:8000::', '2620:4f:8000:ffff:ffff:ffff:ffff:ffff'],
    outside: ['2620:4f:7fff:ffff:ffff:ffff:ffff:ffff', '2620:4f:8001::'],
  },
  {
    range: '3fff::/20 documentation',
    inside: ['3fff::', '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff'],
    outside: ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '3fff:1000::'],
  },
  { range: '5f00::/16 SRv6 SIDs', inside: ['5f00::', '5f00::1', '5f00:ffff::1'], outside: [] },
  {
    range: 'fc00::/7 unique local (IPv6 cloud metadata fd00:ec2::254)',
    inside: ['fc00::', 'fd00:ec2::254', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    outside: [],
  },
  {
    range: 'fe80::/10 link-local',
    inside: ['fe80::', 'fe80::1', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
    outside: [],
  },
  { range: 'ff00::/8 multicast', inside: ['ff00::', 'ff02::1', 'ff0e::1', 'ffff::1'], outside: [] },
  {
    range: 'outside 2000::/3, the only global unicast space',
    inside: [
      '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '4000::',
      '::2',
      '::127.0.0.1',
      '::7f00:1',
      '::ffff:0:a00:1',
      '::ffff:0:101:101',
      'fec0::1',
      '64:ff9b::1:0:0:1',
      '64:ff9b:0:1::101:101',
    ],
    outside: ['2000::', '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
  },
];

function rows(table: readonly Range[], key: 'inside' | 'outside'): [string, string][] {
  return table.flatMap((r) => r[key].map((a): [string, string] => [a, r.range]));
}

describe('IANA IPv4 special-purpose ranges', () => {
  test.each(rows(IPV4, 'inside'))('%s is refused (%s)', (address) => {
    expect(judgeAddress(address).allowed).toBe(false);
  });
  test.each(rows(IPV4, 'outside'))('%s is public, just outside %s', (address) => {
    expect(judgeAddress(address)).toEqual({ allowed: true, address });
  });
});

describe('IANA IPv6 special-purpose ranges', () => {
  test.each(rows(IPV6, 'inside'))('%s is refused (%s)', (address) => {
    expect(judgeAddress(address).allowed).toBe(false);
  });
  test.each(rows(IPV6, 'outside'))('%s is public, just outside %s', (address) => {
    expect(judgeAddress(address)).toEqual({ allowed: true, address });
  });
});

describe('IPv4 carried in IPv6', () => {
  test.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.30',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '::ffff:0.0.0.0',
    '::ffff:100.64.0.1',
    '::ffff:192.0.2.1',
    '::ffff:224.0.0.1',
    '::ffff:255.255.255.255',
    '0:0:0:0:0:ffff:7f00:1',
  ])('the IPv4-mapped %s is judged as the private IPv4 address it carries', (address) => {
    expect(judgeAddress(address).allowed).toBe(false);
  });

  test.each([
    ['::ffff:1.1.1.1', '1.1.1.1'],
    ['::ffff:808:808', '8.8.8.8'],
    ['0:0:0:0:0:FFFF:5DB8:D70E', '93.184.215.14'],
  ])('the IPv4-mapped %s is public and connects as %s', (address, connect) => {
    expect(judgeAddress(address)).toEqual({ allowed: true, address: connect });
  });

  test.each([
    '64:ff9b::7f00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b::a00:1e',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::6440:1',
    '64:ff9b::c000:201',
    '64:ff9b::c612:1',
    '64:ff9b::e000:1',
    '64:ff9b::f000:1',
    '64:ff9b::ffff:ffff',
    '64:ff9b::',
  ])('the NAT64 address %s is judged as the special IPv4 address it embeds', (address) => {
    expect(judgeAddress(address).allowed).toBe(false);
  });

  test.each([
    ['64:ff9b::101:101', '64:ff9b::101:101'],
    ['64:ff9b::1.1.1.1', '64:ff9b::101:101'],
    ['64:FF9B:0:0:0:0:5DB8:D70E', '64:ff9b::5db8:d70e'],
    // The nearest public IPv4 addresses on either side of 10.0.0.0/8, through NAT64.
    ['64:ff9b::9ff:ffff', '64:ff9b::9ff:ffff'],
    ['64:ff9b::b00:0', '64:ff9b::b00:0'],
  ])(
    'the NAT64 address %s embeds a public IPv4 address and connects as itself',
    (address, connect) => {
      expect(judgeAddress(address)).toEqual({ allowed: true, address: connect });
    },
  );
});

describe('what the parser cannot place is refused', () => {
  test.each([
    '',
    ' ',
    'localhost',
    'store.example',
    '127.1',
    '0x7f000001',
    '2130706433',
    '0177.0.0.1',
    '010.0.0.1',
    '01.1.1.1',
    '1.1.1',
    '1.1.1.1.1',
    '1.2.3.256',
    ' 1.1.1.1',
    '1.1.1.1 ',
    '1.1.1.1\n',
    '[2606:4700:4700::1111]',
    '[::1]',
    ':::',
    '2606:4700:4700::1111::1',
    '12345::1',
    'fe80::1%en0',
    'fe80::1%25en0',
    '2606:4700:4700::1111%eth0',
    '::ffff:1.1.1.1%0',
    '::ffff:010.0.0.1',
    '::ffff:1.1.1',
  ])('%j is refused', (text) => {
    expect(judgeAddress(text).allowed).toBe(false);
  });

  test('a value that is not a string is refused', () => {
    expect(judgeAddress(undefined as unknown as string).allowed).toBe(false);
    expect(judgeAddress(2130706433 as unknown as string).allowed).toBe(false);
  });
});

describe('a public address connects as its canonical form', () => {
  test.each([
    ['1.1.1.1', '1.1.1.1'],
    ['93.184.215.14', '93.184.215.14'],
    ['2606:4700:4700::1111', '2606:4700:4700::1111'],
    ['2606:4700:4700:0:0:0:0:1111', '2606:4700:4700::1111'],
    ['2606:4700:4700:0000:0000:0000:0000:1111', '2606:4700:4700::1111'],
    ['2606:4700:4700::1111'.toUpperCase(), '2606:4700:4700::1111'],
    ['2606:2800:220:1::', '2606:2800:220:1::'],
    ['2606:4700::1.1.1.1', '2606:4700::101:101'],
  ])('%s connects as %s', (text, address) => {
    expect(judgeAddress(text)).toEqual({ allowed: true, address });
  });

  test('a refusal says why', () => {
    const verdict = judgeAddress('169.254.169.254');
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.why.length).toBeGreaterThan(0);
  });
});
