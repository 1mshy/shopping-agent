// The summariser's arithmetic on hand-made result lines (no request, no real host).
import { describe, expect, it } from 'vitest';
import type { Outcome } from '../routes/outcome.ts';
import type { ClientResult, HostResult } from './result.ts';
import {
  onlyOne,
  overlap,
  predecessorTable,
  renderMarkdown,
  requestStats,
  tabulate,
} from './summarise.ts';
import type { ClientId } from './transport.ts';

const W: Outcome = { kind: 'wall', vendor: 'akamai', mode: 'block' };
const OK: Outcome = { kind: 'ok' };
const NO: Outcome = { kind: 'invalid_payload' };

function host(
  key: string,
  outcomes: Partial<Record<ClientId, Outcome>>,
  opts: {
    strategy?: string;
    rung?: 'http' | 'browser';
    source?: 'lab' | 'playbook';
    requests?: number;
  } = {},
): HostResult {
  const order = Object.keys(outcomes) as ClientId[];
  const results: ClientResult[] = order.map((client, position) => ({
    client,
    library: client,
    version: '1.0.0',
    profile: 'p',
    position,
    startedAt: '2026-11-18T10:00:00.000Z',
    ms: 100,
    requests: opts.requests ?? 1,
    outcome: outcomes[client] as Outcome,
    evidence: { signals: [], hops: 0 },
    chain: [],
    facts: {},
  }));
  return {
    v: 1,
    key,
    host: `${key}.example`,
    url: `https://${key}.example/p`,
    source: opts.source ?? 'lab',
    group: 'a',
    predecessor: {
      playbook: opts.strategy ? { strategy: opts.strategy, date: '2026-10-20' } : null,
      read: opts.rung
        ? {
            rung: opts.rung,
            method: `${opts.rung}:json-ld`,
            report: 'r.json',
            date: '2026-10-23',
            sameUrl: true,
          }
        : null,
      lab: null,
    },
    order,
    startedAt: '2026-11-18T10:00:00.000Z',
    ms: 9000,
    requests: results.reduce((s, x) => s + x.requests, 0),
    results,
  };
}

const RESULTS = [
  host('a', { fetch: OK, impit: OK, wreq: OK }, { strategy: 'http', rung: 'http' }),
  host('b', { fetch: W, impit: OK, wreq: NO }, { strategy: 'http', rung: 'browser', requests: 2 }),
  host('c', { impit: W, wreq: OK, fetch: W }, { strategy: 'browser', source: 'playbook' }),
  host('d', { wreq: NO, fetch: NO, impit: NO }, {}),
];

describe('tabulate', () => {
  it('counts outcomes, walls by vendor and requests per client', () => {
    const rows = Object.fromEntries(tabulate(RESULTS).map((r) => [r.client, r]));
    expect(rows.fetch).toMatchObject({
      n: 4,
      counts: { ok: 1, wall: 2, invalid_payload: 1 },
      requests: 5,
    });
    expect(rows.impit).toMatchObject({ n: 4, counts: { ok: 2, wall: 1, invalid_payload: 1 } });
    expect(rows.fetch?.walls).toEqual({ 'akamai/block': 2 });
    expect(rows.wreq).toMatchObject({ counts: { ok: 2, invalid_payload: 2 }, walls: {} });
  });
});

describe('overlap and onlyOne', () => {
  it('splits each pair into both, only A, only B and neither', () => {
    const pairs = overlap(RESULTS);
    expect(pairs.find((p) => p.a === 'fetch' && p.b === 'impit')).toEqual({
      a: 'fetch',
      b: 'impit',
      n: 4,
      both: 1,
      onlyA: 0,
      onlyB: 1,
      neither: 2,
    });
    expect(pairs.find((p) => p.a === 'impit' && p.b === 'wreq')).toMatchObject({
      both: 1,
      onlyA: 1,
      onlyB: 1,
      neither: 1,
    });
    for (const p of pairs) expect(p.both + p.onlyA + p.onlyB + p.neither).toBe(p.n);
  });
  it('lists hosts exactly one client reads', () => {
    expect(onlyOne(RESULTS)).toEqual({ impit: ['b'], wreq: ['c'] });
  });
});

describe('predecessorTable', () => {
  it('groups by playbook strategy and by the rung of the newest read', () => {
    const rows = predecessorTable(RESULTS);
    const get = (basis: string, value: string) =>
      rows.find((r) => r.basis === basis && r.value === value);
    expect(get('playbook', 'http')).toMatchObject({
      n: 2,
      readable: { fetch: 1, impit: 2, wreq: 1 },
      any: 2,
      dates: '2026-10-20 to 2026-10-20',
    });
    expect(get('playbook', 'browser')).toMatchObject({
      n: 1,
      readable: { impit: 0, wreq: 1 },
      any: 1,
    });
    expect(get('playbook', 'no entry')).toMatchObject({ n: 1, any: 0, dates: 'n/a' });
    expect(get('newest price read', 'none recorded')).toMatchObject({ n: 2 });
    const n = rows.filter((r) => r.basis === 'playbook').reduce((s, r) => s + r.n, 0);
    expect(n).toBe(RESULTS.length);
  });
});

describe('requestStats', () => {
  it('sums requests, finds the maxima and counts the order positions', () => {
    const s = requestStats(RESULTS);
    expect(s).toMatchObject({ hosts: 4, total: 15, maxPerHost: 6, maxPerClientOnHost: 2 });
    expect(s.histogram).toEqual([
      [3, 3],
      [6, 1],
    ]);
    expect(s.perClient).toEqual({ fetch: 5, impit: 5, wreq: 5 });
    expect(s.positions.fetch).toEqual([2, 1, 1]);
    expect(s.positions.wreq).toEqual([1, 1, 2]);
  });
});

describe('renderMarkdown', () => {
  it('renders every table with n beside each rate', () => {
    const md = renderMarkdown(RESULTS);
    expect(md).toContain('| fetch (fetch 1.0.0, p) | 4 | 1 (25.0%) | 2 (50.0%) | 1 (25.0%) | 5 |');
    expect(md).toContain('| all | 4 | 1 (25.0%) | 2 (50.0%) | 2 (50.0%) | 3 (75.0%) |');
    expect(md).toContain('Hosts: 4. HTTP requests: 15. Most requests to one host: 6');
  });
});
