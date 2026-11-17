import { describe, expect, it } from 'vitest';
import { checkUrl, isBlockedAddress, type Lookup, sameSite } from './guard.ts';

const fakeDns =
  (table: Record<string, string[]>): Lookup =>
  async (host) => {
    const addrs = table[host];
    if (!addrs) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

describe('isBlockedAddress', () => {
  it.each([
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '172.16.5.4',
    '192.168.1.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00:ec2::254',
    '::ffff:10.0.0.1',
  ])('refuses %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '23.227.38.65', '2606:4700::6810:84e5'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('allows loopback only when a test asks for it', () => {
    expect(isBlockedAddress('127.0.0.1', { allowLoopback: true })).toBe(false);
    expect(isBlockedAddress('10.0.0.1', { allowLoopback: true })).toBe(true);
  });
});

describe('checkUrl', () => {
  const lookup = fakeDns({
    'shop.example': ['93.184.216.34'],
    'lan.example': ['93.184.216.34', '192.168.0.10'],
    'meta.example': ['169.254.169.254'],
  });

  it('accepts a public https URL', async () => {
    expect(await checkUrl('https://shop.example/robots.txt', { lookup })).toEqual({
      ok: true,
      addresses: ['93.184.216.34'],
    });
  });

  it.each(['ftp://shop.example/', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'refuses the scheme of %s',
    async (url) => {
      expect(await checkUrl(url, { lookup })).toMatchObject({ ok: false, reason: 'scheme' });
    },
  );

  it('refuses credentials in the URL', async () => {
    expect(await checkUrl('https://u:p@shop.example/', { lookup })).toMatchObject({
      ok: false,
      reason: 'credentials',
    });
  });

  it('refuses a host when any resolved address is private or metadata', async () => {
    expect(await checkUrl('https://lan.example/', { lookup })).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(await checkUrl('http://meta.example/latest', { lookup })).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
  });

  it('refuses IP literals in private ranges without a lookup', async () => {
    expect(await checkUrl('http://10.0.0.1/', { lookup })).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
    expect(await checkUrl('http://[::1]:8080/', { lookup })).toMatchObject({
      ok: false,
      reason: 'private_address',
    });
  });

  it('reports a DNS failure with its code', async () => {
    expect(await checkUrl('https://missing.example/', { lookup })).toEqual({
      ok: false,
      reason: 'dns',
      code: 'ENOTFOUND',
    });
  });
});

describe('sameSite', () => {
  it('treats www and subdomains as the same site, anything else as off-site', () => {
    expect(sameSite('shop.example', 'www.shop.example')).toBe(true);
    expect(sameSite('www.shop.example', 'eu.shop.example')).toBe(true);
    expect(sameSite('shop.example', 'shop.example.evil')).toBe(false);
    expect(sameSite('shop.example', 'other.example')).toBe(false);
  });
});
