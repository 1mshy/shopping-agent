import { describe, expect, it } from 'vitest';
import type { Offer, ProbeResult } from './client.ts';
import {
  FUNCTIONAL_CHECK_MAX_LINES,
  isProfileRejection,
  MIN_INTERVAL_MS,
  parseArgs,
  parseProductList,
  percentile,
  runAll,
  summarise,
  toRecord,
} from './run.ts';

const PROFILE = 'https://profiles.agentic-dasher.test/agent-profile.json';
const LINE = { query: 'q', country: 'CA', currency: 'CAD' };

function offer(currency: string | null, url: string | null = null): Offer {
  return {
    productId: 'p',
    productTitle: 't',
    variantId: 'v',
    variantTitle: null,
    price: currency === null ? null : { amount: '100', amountJsonType: 'number', currency },
    currencyMatch: currency === null ? 'missing' : currency === 'CAD' ? 'requested' : 'other',
    merchant: { name: null, domain: null, id: null },
    url,
    urlFrom: url === null ? null : 'variant',
    checkoutUrl: null,
    attributionParams: url === null ? [] : ['_gsid'],
    available: null,
    source: null,
  };
}

function ok(latencyMs: number, productCount: number, offers: Offer[]): ProbeResult {
  const base = { status: 200, latencyMs, contentType: 'application/json', rateLimitHeaders: {} };
  return {
    ...base,
    ok: true,
    productCount,
    totalCount: null,
    ucpVersion: null,
    offers,
    messages: [],
  };
}

function err(kind: 'rate_limited' | 'network', status: number | null): ProbeResult {
  const base = { status, latencyMs: 5, contentType: null, rateLimitHeaders: {} };
  return { ...base, ok: false, error: { kind, message: kind } };
}

function rpcErr(jsonrpcCode: number, ucpCode?: string): ProbeResult {
  const base = { status: 200, latencyMs: 5, contentType: 'application/json', rateLimitHeaders: {} };
  return { ...base, ok: false, error: { kind: 'jsonrpc', message: 'm', jsonrpcCode, ucpCode } };
}

describe('parseArgs', () => {
  const base = ['--profile', PROFILE, '--products', 'p.json', '--owner-approved'];
  it('refuses to run without an explicit profile URL', () => {
    expect(() => parseArgs(['--products', 'p.json', '--owner-approved'])).toThrow(/--profile/);
    expect(() =>
      parseArgs(['--profile', 'https://example.com/p.json', ...base.slice(2)]),
    ).toThrow();
  });
  it('refuses to run without the owner-approval flag', () => {
    expect(() => parseArgs(base.slice(0, 4))).toThrow(/--owner-approved/);
  });
  it('defaults to one request every 2 s and refuses anything faster', () => {
    expect(parseArgs(base)).toMatchObject({ intervalMs: 2000, limit: 20, shipsTo: false });
    expect(MIN_INTERVAL_MS).toBe(2000);
    expect(() => parseArgs([...base, '--interval-ms', '1999'])).toThrow();
    expect(parseArgs([...base, '--interval-ms', '5000', '--ships-to']).intervalMs).toBe(5000);
  });
});

describe('parseProductList', () => {
  it('reads query, country and currency', () => {
    expect(parseProductList(JSON.stringify([LINE]))).toEqual([LINE]);
  });
  it('rejects bad rows and lists over the plan size', () => {
    expect(() => parseProductList('[{"query":"q","country":"Canada","currency":"CAD"}]')).toThrow();
    expect(() => parseProductList('{}')).toThrow();
    expect(() => parseProductList(JSON.stringify(Array(61).fill(LINE)))).toThrow(/60/);
  });
});

describe('percentile (nearest rank)', () => {
  it('computes p50 and p95', () => {
    const v = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(v, 50)).toBe(100);
    expect(percentile(v, 95)).toBe(190);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('toRecord keeps measurements, not Catalog content', () => {
  it('counts offers by currency and keeps no titles, prices or URLs', () => {
    const r = toRecord(
      0,
      LINE,
      ok(120, 2, [offer('CAD', 'https://s.test/p?_gsid=1'), offer('USD'), offer(null)]),
    );
    expect(r).toMatchObject({
      productCount: 2,
      offerCount: 3,
      offersRequestedCurrency: 1,
      offersOtherCurrency: 1,
      offersMissingPrice: 1,
      currenciesSeen: ['CAD', 'USD'],
      attributionParamCounts: { _gsid: 1 },
      errorKind: null,
    });
    expect(JSON.stringify(r)).not.toMatch(/s\.test|"100"/);
  });
});

describe('summarise (arithmetic on synthetic records)', () => {
  it('reports n, latency percentiles, hits per query, currency share and errors', () => {
    const records = [
      toRecord(0, LINE, ok(100, 4, [offer('CAD'), offer('CAD'), offer('USD')])),
      toRecord(1, LINE, ok(300, 0, [])),
      toRecord(2, LINE, ok(200, 2, [offer('CAD'), offer(null)])),
      toRecord(3, LINE, err('network', null)),
      toRecord(4, LINE, err('rate_limited', 429)),
    ];
    const s = summarise(records, 6);
    expect(s.planned).toBe(6);
    expect(s.attempted).toBe(5);
    expect(s.ok).toBe(3);
    expect(s.latencyMs).toEqual({ n: 4, p50: 100, p95: 300 });
    expect(s.hitsPerQuery).toEqual({ n: 3, mean: 2, median: 2, zeroHit: 1 });
    expect(s.offers).toEqual({
      total: 5,
      withPrice: 4,
      requestedCurrency: 3,
      otherCurrency: 1,
      missingPrice: 1,
    });
    expect(s.shareRequestedCurrency).toBe(0.75);
    expect(s.errorsByKind).toEqual({ network: 1, rate_limited: 1 });
  });
});

describe('runAll', () => {
  it('runs sequentially, sleeps between requests and stops at the first 429', async () => {
    const calls: string[] = [];
    const results = [ok(1, 1, []), err('rate_limited', 429), ok(1, 1, [])];
    const records = await runAll([LINE, LINE, LINE], {
      intervalMs: 2000,
      search: async () => {
        calls.push('search');
        return results[calls.filter((c) => c === 'search').length - 1] as ProbeResult;
      },
      sleep: async (ms) => {
        calls.push(`sleep ${ms}`);
      },
    });
    expect(calls).toEqual(['search', 'sleep 2000', 'search']);
    expect(records.map((r) => r.errorKind)).toEqual([null, 'rate_limited']);
  });
});

describe('functional check (2026-11-23: no latency, at most 6 requests)', () => {
  const base = ['--profile', PROFILE, '--products', 'p.json', '--owner-approved'];
  it('is off by default and set by --functional-check', () => {
    expect(parseArgs(base).functionalCheck).toBe(false);
    expect(parseArgs([...base, '--functional-check']).functionalCheck).toBe(true);
  });
  it('caps the list at 6 rows when asked', () => {
    expect(FUNCTIONAL_CHECK_MAX_LINES).toBe(6);
    const six = JSON.stringify(Array(6).fill(LINE));
    expect(parseProductList(six, FUNCTIONAL_CHECK_MAX_LINES)).toHaveLength(6);
    expect(() =>
      parseProductList(JSON.stringify(Array(7).fill(LINE)), FUNCTIONAL_CHECK_MAX_LINES),
    ).toThrow(/max 6/);
  });
  it('records no latency and the summary has no latency key', () => {
    const r = toRecord(0, LINE, ok(120, 1, [offer('CAD')]), { latency: false });
    expect(r.latencyMs).toBeNull();
    const s = summarise([r], 1, { latency: false });
    expect(s).not.toHaveProperty('latencyMs');
    expect(JSON.stringify(s)).not.toMatch(/p50|p95|120/);
  });
  it('keeps UCP message codes and counts offers with links, without the links', () => {
    const o = { ...offer('CAD', 'https://s.test/p?_gsid=1'), checkoutUrl: 'https://s.test/c' };
    const res = ok(1, 1, [o]);
    if (res.ok) res.messages = [{ type: 'warning', code: 'w1', content: 'x'.repeat(400) }];
    const r = toRecord(0, LINE, res);
    expect(r.offersWithUrl).toBe(1);
    expect(r.offersWithCheckoutUrl).toBe(1);
    expect(r.messages[0]).toMatchObject({ type: 'warning', code: 'w1', severity: null });
    expect(r.messages[0]?.content).toHaveLength(300);
    expect(JSON.stringify(r)).not.toMatch(/s\.test/);
  });
});

describe('profile rejection', () => {
  it('is recognised by MCP code -32001 or a profile error code', () => {
    expect(isProfileRejection(toRecord(0, LINE, rpcErr(-32001)))).toBe(true);
    expect(isProfileRejection(toRecord(0, LINE, rpcErr(-32000, 'profile_unreachable')))).toBe(true);
    expect(isProfileRejection(toRecord(0, LINE, rpcErr(-32602)))).toBe(false);
    expect(isProfileRejection(toRecord(0, LINE, err('network', null)))).toBe(false);
  });
  it('stops the run at the first rejection', async () => {
    let n = 0;
    const records = await runAll([LINE, LINE, LINE], {
      intervalMs: 2000,
      search: async () => (n++ === 0 ? rpcErr(-32001, 'invalid_profile_url') : ok(1, 1, [])),
      sleep: async () => {},
    });
    expect(records).toHaveLength(1);
    expect(summarise(records, 3).profileRejections).toBe(1);
  });
});
