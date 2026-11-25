import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientAddress, requestOrigin, throttleKey } from '../../src/auth/index.ts';
import { fromAddress } from './harness.ts';

describe('throttleKey', () => {
  it('keeps an IPv4 address, also when IPv4-mapped', () => {
    expect(throttleKey('192.0.2.10')).toBe('192.0.2.10');
    expect(throttleKey('::ffff:192.0.2.10')).toBe('192.0.2.10');
  });

  it('keys an IPv6 address by its /64, however it is written', () => {
    const key = '2001:db8:1:2::/64';
    expect(throttleKey('2001:db8:1:2::1')).toBe(key);
    expect(throttleKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(key);
    expect(throttleKey('[2001:DB8:1:2::abcd]')).toBe(key);
    expect(throttleKey('2001:db8:1:2::1%en0')).toBe(key);
    expect(throttleKey('2001:db8:1:3::1')).not.toBe(key);
    expect(throttleKey('::1')).toBe('0:0:0:0::/64');
    expect(throttleKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
  });

  it('falls back to the text for anything it cannot read', () => {
    expect(throttleKey('')).toBe('unknown');
    expect(throttleKey('not:an:address::::')).toBe('not:an:address::::');
  });
});

describe('clientAddress and requestOrigin', () => {
  const app = new Hono().get('/', (c) =>
    c.json({
      plain: clientAddress(c, false),
      proxied: clientAddress(c, true),
      origin: requestOrigin(c, false),
      proxiedOrigin: requestOrigin(c, true),
    }),
  );

  it('takes the socket address and ignores X-Forwarded-* unless the proxy is trusted', async () => {
    const res = await app.request(
      'http://dasher.lan:8080/',
      {
        headers: {
          'X-Forwarded-For': '203.0.113.9, 198.51.100.7',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'dasher.example.org',
        },
      },
      fromAddress('10.0.0.2'),
    );
    expect(await res.json()).toEqual({
      plain: '10.0.0.2',
      // The rightmost entry: what the trusted proxy itself appended.
      proxied: '198.51.100.7',
      origin: 'http://dasher.lan:8080',
      proxiedOrigin: 'https://dasher.example.org',
    });
  });

  it('says unknown when there is no socket', async () => {
    const res = await app.request('/');
    expect(((await res.json()) as { plain: string }).plain).toBe('unknown');
  });
});
