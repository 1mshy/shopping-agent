// The guarded GET loop over a scripted transport: no socket is opened. Host names resolve through
// an injected lookup, so the guard runs its real checks without DNS.
import { describe, expect, it } from 'vitest';
import { Budget } from '../routes/http.ts';
import { Pacer } from '../routes/pacer.ts';
import { type GetConfig, guardedGet } from './get.ts';
import type { HttpTransport, TransportRequest, TransportResult } from './transport.ts';

type Answer = TransportResult | ((url: string) => TransportResult);
function scripted(answers: Record<string, Answer | Answer[]>) {
  const calls: string[] = [];
  const t: HttpTransport = {
    info: { id: 'fetch', library: 'test', version: '0.0.0', profile: 'none', notes: '' },
    async get(req: TransportRequest) {
      calls.push(req.url);
      const a = answers[req.url];
      const next = Array.isArray(a) ? a.shift() : a;
      if (!next) return { ok: false, error: 'ECONNREFUSED', detail: 'no script' };
      return typeof next === 'function' ? next(req.url) : next;
    },
    async close() {},
  };
  return { t, calls };
}
const answer = (
  status: number,
  headers: Array<[string, string]> = [],
  body = '',
): TransportResult => ({
  ok: true,
  response: { status, headers, url: '', body: new TextEncoder().encode(body), facts: { x: 1 } },
});
const PUBLIC: Record<string, string> = {
  'shop.example': '93.184.216.34',
  'www.shop.example': '93.184.216.34',
  'other.example': '93.184.216.35',
  'evil.example': '10.0.0.1',
};
const cfg = (): GetConfig => ({
  timeoutMs: 1000,
  maxBytes: 1000,
  maxHops: 3,
  guard: {
    lookup: async (h) => {
      const a = PUBLIC[h];
      if (!a) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
      return [{ address: a, family: 4 }];
    },
  },
  pacer: new Pacer({ minGapMs: 0 }),
});

describe('guardedGet', () => {
  it('follows a same-site redirect by hand and returns the final answer', async () => {
    const { t, calls } = scripted({
      'https://shop.example/p': answer(301, [['location', 'https://www.shop.example/p']]),
      'https://www.shop.example/p': answer(200, [['content-type', 'text/html']], '<html>ok</html>'),
    });
    const r = await guardedGet('https://shop.example/p', t, cfg(), [new Budget(5)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.res.finalUrl).toBe('https://www.shop.example/p');
    expect(r.res.body).toBe('<html>ok</html>');
    expect(r.res.headers.get('content-type')).toBe('text/html');
    expect([r.requests, r.hops]).toEqual([2, 1]);
    expect(calls).toEqual(['https://shop.example/p', 'https://www.shop.example/p']);
    expect(r.chain.map((h) => h.status)).toEqual([301, 200]);
    expect(r.facts).toEqual({ x: 1 });
  });

  it('stops at an off-site redirect without requesting it', async () => {
    const { t, calls } = scripted({
      'https://shop.example/p': answer(302, [['location', 'https://other.example/p']]),
    });
    const r = await guardedGet('https://shop.example/p', t, cfg(), [new Budget(5)]);
    expect(r).toMatchObject({
      ok: false,
      outcome: { kind: 'off_site_redirect', to: 'https://other.example' },
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a redirect to a private address, and a non-http scheme', async () => {
    const priv = scripted({
      'https://shop.example/p': answer(302, [['location', 'https://evil.example/']]),
    });
    expect(
      await guardedGet('https://shop.example/p', priv.t, cfg(), [new Budget(5)]),
    ).toMatchObject({
      outcome: { kind: 'refused_by_policy', reason: 'private_address' },
    });
    const scheme = scripted({
      'https://shop.example/p': answer(302, [['location', 'file:///etc/passwd']]),
    });
    expect(
      await guardedGet('https://shop.example/p', scheme.t, cfg(), [new Budget(5)]),
    ).toMatchObject({
      outcome: { kind: 'refused_by_policy', reason: 'scheme' },
    });
  });

  it('allows at most three hops', async () => {
    const hop = (n: number) => answer(302, [['location', `https://shop.example/${n}`]]);
    const { t } = scripted({
      'https://shop.example/0': hop(1),
      'https://shop.example/1': hop(2),
      'https://shop.example/2': hop(3),
      'https://shop.example/3': hop(4),
    });
    const r = await guardedGet('https://shop.example/0', t, cfg(), [new Budget(5)]);
    expect(r).toMatchObject({
      ok: false,
      outcome: { kind: 'refused_by_policy', reason: 'too_many_redirects' },
    });
    expect(r.requests).toBe(4);
  });

  it('retries once after a retryable network error, never twice', async () => {
    const reset: TransportResult = { ok: false, error: 'ECONNRESET', detail: 'reset' };
    const once = scripted({ 'https://shop.example/p': [reset, answer(200)] });
    const r1 = await guardedGet('https://shop.example/p', once.t, cfg(), [new Budget(5)]);
    expect([r1.ok, r1.requests]).toEqual([true, 2]);
    const twice = scripted({ 'https://shop.example/p': [reset, reset, answer(200)] });
    const r2 = await guardedGet('https://shop.example/p', twice.t, cfg(), [new Budget(5)]);
    expect(r2).toMatchObject({ ok: false, outcome: { kind: 'network_error', code: 'ECONNRESET' } });
    expect(r2.requests).toBe(2);
  });

  it('does not retry a TLS error, and reports a body above the cap as a policy refusal', async () => {
    const tls = scripted({
      'https://shop.example/p': { ok: false, error: 'tls', detail: 'bad cert' },
    });
    const r = await guardedGet('https://shop.example/p', tls.t, cfg(), [new Budget(5)]);
    expect(r).toMatchObject({ outcome: { kind: 'network_error', code: 'tls' }, requests: 1 });
    const big = scripted({
      'https://shop.example/p': { ok: false, error: 'body_cap', detail: '' },
    });
    expect(await guardedGet('https://shop.example/p', big.t, cfg(), [new Budget(5)])).toMatchObject(
      {
        outcome: { kind: 'refused_by_policy', reason: 'body_cap' },
      },
    );
  });

  it('reports DNS failure from the guard without a request', async () => {
    const { t, calls } = scripted({});
    const r = await guardedGet('https://nowhere.example/p', t, cfg(), [new Budget(5)]);
    expect(r).toMatchObject({
      ok: false,
      outcome: { kind: 'network_error', code: 'ENOTFOUND' },
      requests: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it('stops when any budget is spent, and charges every budget', async () => {
    const hop = (n: number) => answer(302, [['location', `https://shop.example/${n}`]]);
    const { t } = scripted({ 'https://shop.example/0': hop(1), 'https://shop.example/1': hop(2) });
    const host = new Budget(10);
    const client = new Budget(2);
    const r = await guardedGet('https://shop.example/0', t, cfg(), [host, client]);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'skipped', reason: 'request_cap' } });
    expect([host.used, client.used]).toEqual([2, 2]);
  });

  it('defers the host after a 429 with Retry-After', async () => {
    const c = cfg();
    let deferred = 0;
    c.pacer.defer = (_h, ms) => {
      deferred = ms;
    };
    const { t } = scripted({ 'https://shop.example/p': answer(429, [['retry-after', '7']]) });
    const r = await guardedGet('https://shop.example/p', t, c, [new Budget(5)]);
    expect(r.ok && r.res.status).toBe(429);
    expect(deferred).toBe(7000);
  });
});
