// From the review of the own-network refusal (2026-11-25): a NAT64 spelling of an own IPv4
// address passed, and a failure to read the interfaces made the guard throw.
import { describe, expect, it } from 'vitest';
import { guardedExchange, onOwnNetwork, ownNetworksOf } from '../../src/guard/index.ts';

const own = ownNetworksOf([
  { address: '203.0.114.5', cidr: '203.0.114.5/24', internal: false },
  { address: '2a01:4f8:1:2::5', cidr: '2a01:4f8:1:2::5/64', internal: false },
]);

describe('own networks, second pass', () => {
  it('an own IPv4 address written through the NAT64 well-known prefix is on an own network', () => {
    expect(onOwnNetwork('64:ff9b::cb00:7209', own)).toBe(true);
    expect(onOwnNetwork('64:ff9b::203.0.114.9', own)).toBe(true);
    expect(onOwnNetwork('::ffff:203.0.114.9', own)).toBe(true);
    // Another public address through the same prefix is not.
    expect(onOwnNetwork('64:ff9b::808:808', own)).toBe(false);
  });

  it('the guard answers with an outcome, never a throw, when the interfaces cannot be read', async () => {
    const result = await guardedExchange(
      { url: 'https://shop.example.test/p', rung: 'http' },
      {
        lookup: async () => ['93.184.216.34'],
        exchange: async () => {
          throw new Error('must not be reached');
        },
      },
      {
        ownNetworks: () => {
          throw Object.assign(new Error('uv_interface_addresses'), { code: 'ERR_SYSTEM_ERROR' });
        },
      },
    );
    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.outcome).toEqual({
        kind: 'refused_by_policy',
        rung: 'http',
        reason: 'private_address',
      });
    }
  });
});
