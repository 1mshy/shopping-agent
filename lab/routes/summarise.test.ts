import { describe, expect, it } from 'vitest';
import type { DomainResult, Outcome, RobotsVerdict, RouteKind } from './outcome.ts';
import {
  confirmedPlatform,
  pct,
  platformRates,
  renderMarkdown,
  robotsCounterfactual,
  tabulate,
} from './summarise.ts';

// Synthetic records for the arithmetic only; not results from any run.
const result = (
  list: DomainResult['list'],
  routes: Array<[RouteKind, Outcome, RobotsVerdict]>,
): DomainResult => ({
  v: 2,
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
        disallowedByRule: 2,
        disallowedUnreachable: 0,
        disallowedAnswered: 1,
        unknown: 0,
        answered: 2,
        answeredUnderRespect: 1,
      },
    ]);
  });

  it('separates robots refusals by rule from those by an unreachable robots.txt', () => {
    const down = result('woocommerce', [['woo_store_search', ok, 'disallowed']]);
    down.robots = { state: 'unreachable', outcome: 'network_error' };
    const [row] = robotsCounterfactual([...results, down]);
    expect(row).toMatchObject({
      disallowed: 3,
      disallowedByRule: 2,
      disallowedUnreachable: 1,
      disallowedAnswered: 2,
    });
  });

  it('gives platform-list rates with not_platform excluded and among confirmed hosts', () => {
    const signal = result('woocommerce', [['woo_store_search', wall, 'allowed']]);
    signal.robots.evidence = {
      status: 200,
      finalUrl: 'https://x.example/robots.txt',
      headers: { link: '<https://x.example/wp-json/>; rel="https://api.w.org/"' },
      markers: [],
      valid: true,
      items: 1,
      signals: [],
      hops: 0,
    };
    expect(confirmedPlatform(signal)).toBe(true);
    expect(confirmedPlatform(results[2] as DomainResult)).toBe(false);
    expect(platformRates([...results, signal])).toEqual([
      {
        list: 'woocommerce',
        route: 'woo_store_search',
        n: 5,
        notPlatform: 1,
        nExcl: 4,
        answersExcl: 2,
        nConfirmed: 3,
        answersConfirmed: 2,
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
      '| woocommerce | woo_store_search | 4 | 2 (50.0%) | 2 | 0 | 1 | 0 (0.0%) | 2 (50.0%) | 1 (25.0%) |',
    );
    expect(md).toContain(
      '| woocommerce | woo_store_search | 4 | 1 (25.0%) | 3 | 2 (66.7%) | 2 | 2 (100.0%) |',
    );
    expect(md).toContain('Most requests to one host: 2.');
  });
});
