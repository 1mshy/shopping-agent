// The composed fetcher on a scripted network and a fake clock: pacing under concurrency, the pool,
// persistence across a restart, the playbook's gate and updates, robots per mode, the budget.
import type { PageKind } from '@agentic-dasher/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { CookieJars } from '../../src/cookies/index.ts';
import {
  bindReaderGet,
  createFetcher,
  createRequestBudget,
  type FetcherDeps,
  type FetcherRequest,
  type FetcherResult,
} from '../../src/fetcher/index.ts';
import {
  jitteredGap,
  memoryPacingStore,
  RATE_LIMITED_DEFAULT_PAUSE_MS,
  sqlitePacingStore,
} from '../../src/pacing/index.ts';
import type { PageResult } from '../../src/page/index.ts';
import {
  memoryPlaybookStore,
  type PlaybookStore,
  sqlitePlaybookStore,
} from '../../src/playbook/index.ts';
import type { RobotsMode } from '../../src/robots/index.ts';
import { type TempDatabase, tempDatabase } from '../db.ts';
import { FakeClock, sequence } from '../pacing/clock.ts';
import type { PageReply, PageScript } from '../page/net.ts';
import { timedNetwork } from './net.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const PUBLIC = '93.184.215.14';
/** random() = 0.5 gives this gap. */
const GAP = 2_688;

const ok = (body = 'hello'): PageReply => ({
  status: 200,
  headers: [['content-type', 'text/html']],
  body: [body],
});
const robotsTxt = (body: string): PageReply => ({
  status: 200,
  headers: [['content-type', 'text/plain']],
  body: [body],
});

interface Setup {
  readonly dns?: PageScript['dns'];
  readonly replies?: PageScript['replies'];
  readonly latencyMs?: number;
  readonly failLookups?: number;
  readonly mode?: RobotsMode;
  readonly deps?: Partial<FetcherDeps>;
  readonly clock?: FakeClock;
}

function setup(options: Setup = {}) {
  const clock = options.clock ?? new FakeClock(T0);
  const net = timedNetwork(
    { dns: options.dns ?? { 'shop.test': [PUBLIC] }, replies: options.replies ?? {} },
    clock,
    {
      ...(options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
      ...(options.failLookups !== undefined ? { failLookups: options.failLookups } : {}),
    },
  );
  const pacing = memoryPacingStore();
  const playbook = memoryPlaybookStore();
  const state = { mode: options.mode ?? ('ignore' as RobotsMode) };
  const fetcher = createFetcher({
    network: net.network,
    jars: new CookieJars(),
    pacing,
    playbook,
    robotsMode: () => state.mode,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    ...options.deps,
  });
  const request = (url: string, extra: Partial<FetcherRequest> = {}): FetcherRequest => ({
    url,
    rung: 'http',
    pageKind: 'product',
    deadline: T0 + 10 * HOUR,
    signal: new AbortController().signal,
    ...extra,
  });
  /** Starts the request, runs the clock until nothing is pending, returns the result. */
  const get = async (url: string, extra: Partial<FetcherRequest> = {}): Promise<FetcherResult> => {
    const pending = fetcher.get(request(url, extra));
    await clock.runAll();
    return pending;
  };
  return { clock, net, pacing, playbook, state, fetcher, request, get };
}

const temps: TempDatabase[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) t.dispose();
});

describe('pacing through the fetcher', () => {
  it('spaces 50 concurrent requests to one host by the jittered interval, in arrival order, one in flight', async () => {
    const randoms = Array.from({ length: 50 }, (_, i) => (i * 0.61) % 1);
    const replies: Record<string, PageReply> = {};
    for (let i = 0; i < 50; i++) replies[`https://shop.test/p/${i}`] = ok();
    const s = setup({ replies, latencyMs: 700, deps: { random: sequence(randoms) } });
    const all = Array.from({ length: 50 }, (_, i) =>
      s.fetcher.get(s.request(`https://shop.test/p/${i}`)),
    );
    await s.clock.runAll();
    const results = await Promise.all(all);
    expect(results.every((r) => r.outcome.kind === 'ok')).toBe(true);
    const starts = s.net.exchanges;
    expect(starts.map((e) => e.url)).toEqual(
      Array.from({ length: 50 }, (_, i) => `https://shop.test/p/${i}`),
    );
    expect(s.net.maxInFlightPerHost).toBe(1);
    const gaps = starts.slice(1).map((e, i) => e.at - (starts[i]?.at ?? 0));
    expect(gaps).toEqual(randoms.slice(0, 49).map((r) => jitteredGap(() => r)));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2_125);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(3_250);
    expect(starts[0]?.at).toBe(T0);
  });

  it('lets 12 hosts start at once and makes the 13th wait for a place in the pool', async () => {
    const dns: Record<string, string[]> = {};
    const replies: Record<string, PageReply> = {};
    for (let i = 0; i < 14; i++) {
      dns[`h${i}.test`] = [PUBLIC];
      replies[`https://h${i}.test/`] = ok();
    }
    const s = setup({ dns, replies, latencyMs: 1_000 });
    const all = Array.from({ length: 14 }, (_, i) =>
      s.fetcher.get(s.request(`https://h${i}.test/`)),
    );
    await s.clock.runAll();
    await Promise.all(all);
    const at = s.net.exchanges.map((e) => [e.host, e.at - T0]);
    expect(at.slice(0, 12).every(([, t]) => t === 0)).toBe(true);
    expect(at.slice(12)).toEqual([
      ['h12.test', 1_000],
      ['h13.test', 1_000],
    ]);
    expect(s.net.maxInFlight).toBe(12);
  });

  it('does not burn the host for a request that failed before sending', async () => {
    const s = setup({
      replies: { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() },
      failLookups: 1,
    });
    const first = await s.get('https://shop.test/a');
    expect(first.outcome).toEqual({ kind: 'network_error', rung: 'http', code: 'EAI_AGAIN' });
    expect(s.pacing.rows.size).toBe(0);
    const second = await s.get('https://shop.test/b');
    expect(second.outcome.kind).toBe('ok');
    expect(s.net.exchanges.map((e) => e.at)).toEqual([T0]);
  });

  it('does not burn the host for a guard refusal', async () => {
    const s = setup({
      dns: { 'shop.test': [PUBLIC], 'lan.test': ['192.168.1.4'] },
      replies: {
        'https://shop.test/a': { status: 302, headers: [['location', 'https://lan.test/x']] },
        'https://shop.test/b': ok(),
      },
    });
    const lan = await s.get('https://lan.test/');
    expect(lan.outcome).toMatchObject({ kind: 'refused_by_policy', reason: 'private_address' });
    expect(s.pacing.rows.has('lan.test')).toBe(false);
    // A refusal after a redirect did reach the network: the first hop was sent.
    const redirected = await s.get('https://shop.test/a');
    expect(redirected.outcome).toMatchObject({ reason: 'private_address' });
    expect(s.pacing.rows.get('shop.test')).toBe(T0 + GAP);
  });

  it('refuses at once, with when the host opens, a request that cannot start before its deadline', async () => {
    const s = setup({ replies: { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() } });
    await s.get('https://shop.test/a');
    const pending = s.fetcher.get(s.request('https://shop.test/b', { deadline: T0 + GAP }));
    const result = await pending;
    expect(result.outcome).toEqual({
      kind: 'refused_by_policy',
      rung: 'http',
      reason: 'host_limit',
    });
    expect(result.closedUntil).toBe(T0 + GAP);
    expect(s.net.lookups).toEqual(['shop.test']);
    expect(s.clock.pending).toBe(0);
  });

  it('ends a request whose deadline passes while it queues as host_limit', async () => {
    const s = setup({
      replies: { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() },
      latencyMs: 5_000,
    });
    const first = s.fetcher.get(s.request('https://shop.test/a'));
    const second = s.fetcher.get(s.request('https://shop.test/b', { deadline: T0 + 4_000 }));
    await s.clock.runAll();
    expect((await first).outcome.kind).toBe('ok');
    expect((await second).outcome).toMatchObject({ reason: 'host_limit' });
    expect(s.net.exchanges).toHaveLength(1);
  });

  it('pushes the next start to Retry-After, or a minute when the 429 gave none', async () => {
    const s = setup({
      replies: {
        'https://shop.test/a': { status: 429, headers: [['retry-after', '30']] },
        'https://shop.test/b': { status: 429 },
        'https://shop.test/c': ok(),
      },
    });
    expect((await s.get('https://shop.test/a')).outcome).toEqual({
      kind: 'rate_limited',
      rung: 'http',
      retryAfterMs: 30_000,
    });
    expect(s.pacing.rows.get('shop.test')).toBe(T0 + 30_000);
    await s.get('https://shop.test/b');
    expect(s.net.exchanges[1]?.at).toBe(T0 + 30_000);
    expect(s.pacing.rows.get('shop.test')).toBe(T0 + 30_000 + RATE_LIMITED_DEFAULT_PAUSE_MS);
    expect(s.playbook.entries.size).toBe(0);
    await s.get('https://shop.test/c');
    expect(s.net.exchanges[2]?.at).toBe(T0 + 30_000 + RATE_LIMITED_DEFAULT_PAUSE_MS);
  });

  it('after a restart on the same database, the first request waits for the stored next start', async () => {
    const temp = tempDatabase();
    temps.push(temp);
    const clock = new FakeClock(T0);
    const replies = { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() };
    const before = temp.open();
    const s1 = setup({
      clock,
      replies,
      deps: { pacing: sqlitePacingStore(before), playbook: sqlitePlaybookStore(before) },
    });
    expect((await s1.get('https://shop.test/a')).outcome.kind).toBe('ok');
    before.close();

    const after = temp.open();
    const s2 = setup({
      clock,
      replies,
      deps: { pacing: sqlitePacingStore(after), playbook: sqlitePlaybookStore(after) },
    });
    const result = await s2.get('https://shop.test/b');
    expect(result.outcome.kind).toBe('ok');
    expect(s2.net.exchanges[0]?.at).toBe(T0 + GAP);
    expect(sqlitePlaybookStore(after).read('shop.test', 'product')?.lastOutcome).toBe('ok');
  });
});

describe('the playbook through the fetcher', () => {
  const walled: PageReply = { status: 403, body: ['denied'] };

  it('records a wall and does not hammer it: the rung is refused until the back-off ends', async () => {
    const s = setup({
      replies: {
        'https://shop.test/p': walled,
        'https://shop.test/q': ok(),
        'https://shop.test/products/q.js': ok('{}'),
      },
    });
    expect((await s.get('https://shop.test/p')).outcome.kind).toBe('wall');
    expect(s.playbook.read('shop.test', 'product')).toMatchObject({
      rung: 'http',
      lastOutcome: 'wall',
      attempts: 1,
      backoffUntil: T0 + 5 * MIN,
    });
    const refused = await s.get('https://shop.test/q');
    expect(refused.outcome).toEqual({
      kind: 'refused_by_policy',
      rung: 'http',
      reason: 'host_limit',
    });
    expect(refused.closedUntil).toBe(T0 + 5 * MIN);
    expect(s.net.exchanges).toHaveLength(1);
    // Another page kind, and the api rung, are not closed by it.
    const search = await s.get('https://shop.test/q', { pageKind: 'search' });
    expect(search.outcome.kind).toBe('ok');
    const api = await s.get('https://shop.test/products/q.js', { rung: 'api', pageKind: 'api' });
    expect(api.outcome.kind).toBe('ok');

    await s.clock.advance(5 * MIN);
    const again = await s.get('https://shop.test/q');
    expect(again.outcome.kind).toBe('ok');
    expect(s.playbook.read('shop.test', 'product')).toMatchObject({
      lastOutcome: 'ok',
      attempts: 0,
      backoffUntil: null,
      expiresAt: s.clock.now() - 0 + 24 * HOUR,
    });
  });

  it('leaves the playbook alone on 404, 429, 5xx, 401, 402, network errors and refusals', async () => {
    const s = setup({
      dns: { 'shop.test': [PUBLIC], 'lan.test': ['10.1.2.3'] },
      replies: {
        'https://shop.test/ok': ok(),
        'https://shop.test/404': { status: 404 },
        'https://shop.test/410': { status: 410 },
        'https://shop.test/429': { status: 429, headers: [['retry-after', '0']] },
        'https://shop.test/500': { status: 500 },
        'https://shop.test/401': { status: 401 },
        'https://shop.test/402': { status: 402 },
        'https://shop.test/big': { status: 200, body: ['x'.repeat(2_000)] },
      },
    });
    await s.get('https://shop.test/ok');
    const hint = s.playbook.read('shop.test', 'product');
    expect(hint?.lastOutcome).toBe('ok');
    for (const path of ['404', '410', '429', '500', '401', '402']) {
      const result = await s.get(`https://shop.test/${path}`);
      expect(result.outcome.kind).not.toBe('ok');
      expect(s.playbook.read('shop.test', 'product')).toEqual(hint);
    }
    expect((await s.get('https://shop.test/big', { maxBodyBytes: 100 })).outcome).toMatchObject({
      reason: 'body_size',
    });
    expect((await s.get('https://shop.test/missing')).outcome.kind).toBe('network_error');
    expect(s.playbook.read('shop.test', 'product')).toEqual(hint);
    await s.get('https://lan.test/');
    expect(s.playbook.read('lan.test', 'product')).toBeNull();
  });

  it('never improves on a failed read, and a 404 after a wall changes nothing', async () => {
    const s = setup({
      replies: {
        'https://shop.test/wall': { status: 403 },
        'https://shop.test/gone': { status: 404 },
      },
    });
    await s.get('https://shop.test/wall');
    const entry = s.playbook.read('shop.test', 'product');
    await s.clock.advance(5 * MIN);
    await s.get('https://shop.test/gone');
    expect(s.playbook.read('shop.test', 'product')).toEqual(entry);
    await s.get('https://shop.test/wall');
    expect(s.playbook.read('shop.test', 'product')).toMatchObject({ attempts: 2 });
  });

  it('returns the result when the playbook cannot be written, and reports it', async () => {
    const errors: unknown[] = [];
    const memory = memoryPlaybookStore();
    const failing: PlaybookStore = {
      read: (host, kind) => memory.read(host, kind),
      write: () => {
        throw new Error('disk full');
      },
    };
    const s = setup({
      replies: { 'https://shop.test/p': ok() },
      deps: { playbook: failing, onStoreError: (e) => errors.push(e) },
    });
    expect((await s.get('https://shop.test/p')).outcome.kind).toBe('ok');
    expect(errors).toHaveLength(1);
  });
});

describe('robots.txt through the fetcher', () => {
  const RULES = 'User-agent: *\nDisallow: /cart\n';
  const robotsFetches = (s: ReturnType<typeof setup>) =>
    s.net.exchanges.filter((e) => e.url.endsWith('/robots.txt')).length;

  it('ignore: never asks for robots.txt', async () => {
    const s = setup({ replies: { 'https://shop.test/cart': ok() } });
    const result = await s.get('https://shop.test/cart');
    expect(result.outcome.kind).toBe('ok');
    expect(result.robots).toBeNull();
    expect(robotsFetches(s)).toBe(0);
  });

  it('report: returns the verdict beside the result and goes ahead; paced; cached for a day', async () => {
    const s = setup({
      mode: 'report',
      replies: {
        'https://shop.test/robots.txt': robotsTxt(RULES),
        'https://shop.test/cart': ok(),
        'https://shop.test/p': ok(),
      },
    });
    const cart = await s.get('https://shop.test/cart');
    expect(cart.outcome.kind).toBe('ok');
    expect(cart.robots).toEqual({
      mode: 'report',
      robotsUrl: 'https://shop.test/robots.txt',
      state: 'parsed',
      verdict: 'disallowed',
      outcome: { kind: 'ok', rung: 'http' },
      cached: false,
    });
    // robots.txt went through pacing like any other request.
    expect(s.net.exchanges.map((e) => [e.url, e.at - T0])).toEqual([
      ['https://shop.test/robots.txt', 0],
      ['https://shop.test/cart', GAP],
    ]);
    const p = await s.get('https://shop.test/p');
    expect(p.robots).toMatchObject({ verdict: 'allowed', cached: true });
    expect(robotsFetches(s)).toBe(1);
    // robots.txt is not a page kind: the playbook holds only the page.
    expect([...s.playbook.entries.keys()]).toEqual(['shop.test product']);
  });

  it('respect: refuses a disallowed URL without requesting it', async () => {
    const s = setup({
      mode: 'respect',
      replies: {
        'https://shop.test/robots.txt': robotsTxt(RULES),
        'https://shop.test/p': ok(),
      },
    });
    const cart = await s.get('https://shop.test/cart/1');
    expect(cart.outcome).toEqual({ kind: 'refused_by_policy', rung: 'http', reason: 'robots' });
    expect(cart.robots?.verdict).toBe('disallowed');
    expect(s.net.exchanges.map((e) => e.url)).toEqual(['https://shop.test/robots.txt']);
    expect((await s.get('https://shop.test/p')).outcome.kind).toBe('ok');
  });

  const cases: [string, PageReply | undefined, string, boolean][] = [
    ['404', { status: 404 }, 'unavailable', true],
    ['401', { status: 401 }, 'unavailable', true],
    ['503', { status: 503 }, 'unreachable', false],
    ['429', { status: 429 }, 'unreachable', false],
    ['403 challenge', { status: 403, body: ['User-agent: *\nDisallow:\n'] }, 'challenged', true],
    ['HTML at 200', ok('<!doctype html><title>Shop</title>'), 'not_robots', true],
  ];
  for (const [name, reply, state, goes] of cases) {
    it(`respect: robots.txt ${name} is ${state}, and the request ${goes ? 'goes ahead' : 'is refused'}`, async () => {
      const s = setup({
        mode: 'respect',
        replies: { 'https://shop.test/robots.txt': reply ?? ok(), 'https://shop.test/p': ok() },
      });
      const result = await s.get('https://shop.test/p');
      expect(result.robots?.state).toBe(state);
      if (goes) {
        expect(result.outcome.kind).toBe('ok');
      } else {
        expect(result.outcome).toEqual({
          kind: 'refused_by_policy',
          rung: 'http',
          reason: 'robots',
        });
        expect(s.net.exchanges.map((e) => e.url)).toEqual(['https://shop.test/robots.txt']);
      }
    });
  }

  it('respect: a network error on robots.txt ends the request with it, and is not cached', async () => {
    const s = setup({
      mode: 'respect',
      failLookups: 1,
      replies: { 'https://shop.test/robots.txt': robotsTxt(''), 'https://shop.test/p': ok() },
    });
    const first = await s.get('https://shop.test/p');
    expect(first.outcome).toEqual({ kind: 'network_error', rung: 'http', code: 'EAI_AGAIN' });
    expect(first.robots).toMatchObject({ state: 'failed', verdict: 'unknown' });
    expect(s.net.exchanges).toHaveLength(0);
    const second = await s.get('https://shop.test/p');
    expect(second.outcome.kind).toBe('ok');
    expect(second.robots).toMatchObject({ state: 'parsed', cached: false });
  });

  it('report: a network error on robots.txt is reported and the request goes ahead', async () => {
    const s = setup({
      mode: 'report',
      failLookups: 1,
      replies: { 'https://shop.test/p': ok() },
    });
    const result = await s.get('https://shop.test/p');
    expect(result.outcome.kind).toBe('ok');
    expect(result.robots).toMatchObject({ state: 'failed', verdict: 'unknown' });
  });

  it('asks the setting on every request', async () => {
    const s = setup({
      replies: { 'https://shop.test/robots.txt': robotsTxt(RULES), 'https://shop.test/cart': ok() },
    });
    expect((await s.get('https://shop.test/cart')).outcome.kind).toBe('ok');
    s.state.mode = 'respect';
    expect((await s.get('https://shop.test/cart')).outcome).toMatchObject({ reason: 'robots' });
    s.state.mode = 'ignore';
    expect((await s.get('https://shop.test/cart')).robots).toBeNull();
  });
});

describe('the budget', () => {
  it('refuses the request after the last, counting only requests that reached the network', async () => {
    const s = setup({
      replies: { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() },
      failLookups: 1,
    });
    const budget = createRequestBudget(2);
    expect((await s.get('https://shop.test/a', { budget })).outcome.kind).toBe('network_error');
    expect(budget.used).toBe(0);
    expect((await s.get('https://shop.test/a', { budget })).outcome.kind).toBe('ok');
    expect((await s.get('https://shop.test/b', { budget })).outcome.kind).toBe('ok');
    const over = await s.get('https://shop.test/b', { budget });
    expect(over.outcome).toEqual({ kind: 'refused_by_policy', rung: 'http', reason: 'budget' });
    expect(s.net.exchanges).toHaveLength(2);
    expect(budget.used).toBe(2);
  });

  it('caps exchanges across robots and redirects while preserving the separate logical budget', async () => {
    const s = setup({
      mode: 'report',
      replies: {
        'https://shop.test/robots.txt': robotsTxt(''),
        'https://shop.test/a': { status: 302, headers: [['location', '/b']] },
        'https://shop.test/b': { status: 302, headers: [['location', '/c']] },
        'https://shop.test/c': ok(),
      },
    });
    const wireBudget = createRequestBudget(3);
    const budget = createRequestBudget(2);
    const result = await s.get('https://shop.test/a', { budget, wireBudget });
    expect(result.outcome).toEqual({ kind: 'refused_by_policy', rung: 'http', reason: 'budget' });
    expect(s.net.exchanges.map((e) => e.url)).toEqual([
      'https://shop.test/robots.txt',
      'https://shop.test/a',
      'https://shop.test/b',
    ]);
    expect(wireBudget.used).toBe(3);
    expect(budget.used).toBe(2);
    expect((await s.get('https://shop.test/c')).outcome.kind).toBe('ok');
  });

  it('does not charge the exchange limit on a failed lookup', async () => {
    const s = setup({ failLookups: 1, replies: { 'https://shop.test/a': ok() } });
    const wireBudget = createRequestBudget(1);
    expect((await s.get('https://shop.test/a', { wireBudget })).outcome.kind).toBe('network_error');
    expect(wireBudget.used).toBe(0);
    expect((await s.get('https://shop.test/a', { wireBudget })).outcome.kind).toBe('ok');
    expect(wireBudget.used).toBe(1);
  });

  it('counts robots.txt as a request', async () => {
    const s = setup({
      mode: 'report',
      replies: { 'https://shop.test/robots.txt': robotsTxt(''), 'https://shop.test/a': ok() },
    });
    const budget = createRequestBudget(1);
    const result = await s.get('https://shop.test/a', { budget });
    expect(result.outcome).toMatchObject({ reason: 'budget' });
    expect(result.robots?.state).toBe('parsed');
    expect(s.net.exchanges.map((e) => e.url)).toEqual(['https://shop.test/robots.txt']);
  });

  it('is checked under concurrency: two requests, one left', async () => {
    const s = setup({
      dns: { 'a.test': [PUBLIC], 'b.test': [PUBLIC] },
      replies: { 'https://a.test/': ok(), 'https://b.test/': ok() },
      latencyMs: 100,
    });
    const budget = createRequestBudget(1);
    const both = [
      s.fetcher.get(s.request('https://a.test/', { budget })),
      s.fetcher.get(s.request('https://b.test/', { budget })),
    ];
    await s.clock.runAll();
    const outcomes = (await Promise.all(both)).map((r) => r.outcome.kind);
    expect(outcomes.sort()).toEqual(['ok', 'refused_by_policy']);
    expect(s.net.exchanges).toHaveLength(1);
  });
});

describe('before any request', () => {
  it('lets the guard refuse a URL it does not accept, with no lookup and no connection', async () => {
    const s = setup();
    expect((await s.get('ftp://shop.test/x')).outcome).toMatchObject({ reason: 'scheme' });
    expect((await s.get('https://user@shop.test/x')).outcome).toMatchObject({ reason: 'url_form' });
    expect(s.net.lookups).toEqual([]);
    expect(s.net.exchanges).toEqual([]);
  });

  it('ends an aborted request, or one past its deadline, without a request', async () => {
    const s = setup({ replies: { 'https://shop.test/a': ok() } });
    expect((await s.get('https://shop.test/a', { signal: AbortSignal.abort() })).outcome).toEqual({
      kind: 'network_error',
      rung: 'http',
      code: 'ABORT_ERR',
    });
    expect((await s.get('https://shop.test/a', { deadline: T0 })).outcome).toEqual({
      kind: 'network_error',
      rung: 'http',
      code: 'ETIMEDOUT',
    });
    expect(s.net.lookups).toEqual([]);
  });

  it('aborts a request waiting for its host', async () => {
    const s = setup({
      replies: { 'https://shop.test/a': ok(), 'https://shop.test/b': ok() },
    });
    await s.get('https://shop.test/a');
    const controller = new AbortController();
    const pending = s.fetcher.get(s.request('https://shop.test/b', { signal: controller.signal }));
    await s.clock.advance(1_000);
    controller.abort();
    await s.clock.flush();
    expect((await pending).outcome).toEqual({
      kind: 'network_error',
      rung: 'http',
      code: 'ABORT_ERR',
    });
    expect(s.net.exchanges).toHaveLength(1);
  });

  it('refuses an unknown rung, page kind or robots mode', async () => {
    const s = setup();
    await expect(
      s.fetcher.get(s.request('https://shop.test/', { rung: 'browser' as 'http' })),
    ).rejects.toThrow(RangeError);
    await expect(
      s.fetcher.get(s.request('https://shop.test/', { pageKind: 'cart' as PageKind })),
    ).rejects.toThrow();
    s.state.mode = 'obey' as RobotsMode;
    await expect(s.fetcher.get(s.request('https://shop.test/'))).rejects.toThrow(RangeError);
  });
});

describe('bindReaderGet', () => {
  it('is a ReaderContext get: api requests are page kind api, pages the bound kind', async () => {
    const s = setup({
      replies: { 'https://shop.test/p': ok(), 'https://shop.test/products/p.js': { status: 403 } },
    });
    // The shape of ReaderContext.get (packages/sources/src/read/contract.ts).
    const get: (request: {
      readonly url: string;
      readonly rung: 'api' | 'http';
      readonly referer?: string;
    }) => Promise<PageResult> = bindReaderGet(s.fetcher, {
      pageKind: 'product',
      deadline: T0 + HOUR,
      signal: new AbortController().signal,
    });
    const page = get({ url: 'https://shop.test/p', rung: 'http', referer: 'https://shop.test/' });
    await s.clock.runAll();
    expect((await page).outcome.kind).toBe('ok');
    const api = get({ url: 'https://shop.test/products/p.js', rung: 'api' });
    await s.clock.runAll();
    expect((await api).outcome.kind).toBe('wall');
    expect(s.playbook.read('shop.test', 'product')?.lastOutcome).toBe('ok');
    expect(s.playbook.read('shop.test', 'api')).toMatchObject({ rung: 'api', lastOutcome: 'wall' });
  });
});
