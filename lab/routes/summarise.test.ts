import { describe, expect, it } from 'vitest';
import type { DomainResult, Outcome, RobotsVerdict, RouteKind } from './outcome.ts';
import { pct, renderMarkdown, robotsCounterfactual, tabulate } from './summarise.ts';

// Synthetic records for the arithmetic only; not results from any run.
const result = (
  list: DomainResult['list'],
  routes: Array<[RouteKind, Outcome, RobotsVerdict]>,
): DomainResult => ({
  v: 1,
  list,
  domain: `${list}-${Math.random()}`,
  userAgent: 'ua',
  startedAt: '2026-11-17T00:00:00.000Z',
  ms: 1,
  origin: 'https://x.example',
  requests: routes.length + 1,
  robots: { state: 'parsed', outcome: 'ok' },
  routes: routes.map(([route, outcome, robots]) => ({
    route,
    url: 'https://x.example/',
    outcome,
    robots,
    requests: 1,
    evidence: { signals: [], hops: 0 },
  })),
});
const ok: Outcome = { kind: 'ok' };
const empty: Outcome = { kind: 'empty' };
const wall: Outcome = { kind: 'wall', vendor: 'cloudflare', mode: 'challenge' };

const results = [
  result('woocommerce', [['woo_store_search', ok, 'allowed']]),
  result('woocommerce', [['woo_store_search', empty, 'disallowed']]),
  result('woocommerce', [['woo_store_search', wall, 'disallowed']]),
  result('woocommerce', [['woo_store_search', { kind: 'not_platform' }, 'allowed']]),
];

describe('summariser', () => {
  it('counts outcomes per list and route with n', () => {
    expect(tabulate(results)).toEqual([
      {
        list: 'woocommerce',
        route: 'woo_store_search',
        n: 4,
        counts: { ok: 1, empty: 1, wall: 1, not_platform: 1 },
      },
    ]);
  });

  it('computes the robots respect counterfactual', () => {
    expect(robotsCounterfactual(results)).toEqual([
      {
        list: 'woocommerce',
        route: 'woo_store_search',
        n: 4,
        disallowed: 2,
        answered: 2,
        answeredUnderRespect: 1,
      },
    ]);
  });

  it('formats percentages to one decimal and guards n = 0', () => {
    expect(pct(1, 3)).toBe('33.3%');
    expect(pct(2, 4)).toBe('50.0%');
    expect(pct(0, 0)).toBe('n/a');
  });

  it('renders both tables with n in every row', () => {
    const md = renderMarkdown(results);
    expect(md).toContain('| woocommerce | woo_store_search | 4 | 2 (50.0%) |');
    expect(md).toContain(
      '| woocommerce | woo_store_search | 4 | 2 (50.0%) | 2 (50.0%) | 1 (25.0%) |',
    );
  });
});
