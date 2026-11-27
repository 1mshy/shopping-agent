import { expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import { createRuntime } from '../../src/runtime.ts';
import { createSecretBox } from '../../src/secrets/index.ts';
import { Clock, TempDb } from '../sweep/harness.ts';

it('passes operator-denied WAN addresses and delegated IPv6 networks to the production fetch guard', async () => {
  const config = loadConfig({ FETCH_DENY_CIDRS: '203.0.114.55, 2607:f2c0:1234::/48' });
  const tmp = new TempDb();
  const clock = new Clock();
  const exchange = vi.fn(async () => {
    throw new Error('no transport in this test');
  });
  let answers: string[] = [];
  const rt = createRuntime({
    db: tmp.db,
    dataDir: tmp.dir,
    secrets: createSecretBox(new Uint8Array(32).fill(7)),
    market: () => null,
    robotsMode: () => 'ignore',
    now: clock.now,
    deniedNetworks: config.deniedNetworks,
    network: { open: () => ({ lookup: async () => answers, exchange }) },
  });
  try {
    const cases = [
      ['203.0.114.55'],
      ['2607:f2c0:1234:aa::10'],
      ['::ffff:203.0.114.55'],
      ['64:ff9b::203.0.114.55'],
      ['93.184.216.34', '203.0.114.55'],
    ];
    for (const [i, addresses] of cases.entries()) {
      answers = addresses;
      const result = await rt.fetcher.get({
        url: `https://store${i}.example/product`,
        rung: 'http',
        pageKind: 'product',
        deadline: clock.ms + 60_000,
        signal: new AbortController().signal,
      });
      expect(result.outcome).toEqual({
        kind: 'refused_by_policy',
        reason: 'private_address',
        rung: 'http',
      });
    }
    expect(exchange).not.toHaveBeenCalled();
  } finally {
    await rt.stop();
    tmp.dispose();
  }
});

it.each([
  'shop.example',
  '203.0.114.55/33',
  '2607:f2c0::/129',
  '203.0.114.55,invalid',
  '203.0.114.55//32',
])('rejects invalid FETCH_DENY_CIDRS at configuration load (%s)', (value) => {
  expect(() => loadConfig({ FETCH_DENY_CIDRS: value })).toThrow(/FETCH_DENY_CIDRS/);
});
