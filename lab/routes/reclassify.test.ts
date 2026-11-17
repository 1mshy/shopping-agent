// Synthetic stored results (not from any run): re-classification reads only the evidence.
import { describe, expect, it } from 'vitest';
import type { DomainResult, RouteResult } from './outcome.ts';
import { changes, reclassifyResult, reclassifyRoute } from './reclassify.ts';

const route = (over: Partial<RouteResult>): RouteResult => ({
  route: 'woo_store_search',
  url: 'https://x.example/wp-json/wc/store/v1/products?search=a&per_page=1',
  outcome: { kind: 'invalid_payload' },
  robots: 'allowed',
  requests: 1,
  evidence: { signals: [], hops: 0 },
  ...over,
});
const host = (routes: RouteResult[]): DomainResult => ({
  v: 2,
  list: 'woocommerce',
  domain: 'x.example',
  userAgent: 'ua',
  startedAt: '2026-11-17T00:00:00.000Z',
  ms: 1,
  origin: 'https://x.example',
  requests: 2,
  robots: { state: 'parsed', outcome: 'ok' },
  routes,
});

describe('reclassify', () => {
  it('re-derives the outcome and signals from the stored classifier input', () => {
    const stale = route({
      evidence: {
        status: 404,
        finalUrl: 'https://x.example/wp-json/wc/store/v1/products',
        contentType: 'text/html',
        bytes: 900,
        headers: { 'content-type': 'text/html' },
        markers: ['html:woocommerce'],
        valid: false,
        validation: 'not_json',
        signals: [],
        hops: 0,
      },
    });
    const r = reclassifyRoute(stale);
    expect(r.outcome).toEqual({ kind: 'not_found' });
    expect(r.evidence.signals).toEqual(['platform:wordpress']);
    const before = host([stale]);
    expect(changes([before], [reclassifyResult(before)])).toEqual([
      'woocommerce woo_store_search x.example: {"kind":"invalid_payload"} -> {"kind":"not_found"}',
    ]);
  });

  it('keeps a valid answer ok or empty by its stored item count', () => {
    const ev = {
      status: 200,
      finalUrl: 'https://x.example/',
      headers: { 'content-type': 'application/json' },
      markers: [],
      signals: [],
      hops: 0,
    };
    expect(reclassifyRoute(route({ evidence: { ...ev, valid: true, items: 0 } })).outcome).toEqual({
      kind: 'empty',
    });
    expect(reclassifyRoute(route({ evidence: { ...ev, valid: true, items: 2 } })).outcome).toEqual({
      kind: 'ok',
    });
  });

  it('re-reads body markers from the stored snippet and host evidence from robots.txt', () => {
    const magentoErrorPage = route({
      route: 'magento_graphql',
      outcome: { kind: 'not_platform' },
      evidence: {
        status: 404,
        finalUrl: 'https://x.example/graphql?query=x',
        contentType: 'text/html',
        bytes: 700,
        headers: { 'content-type': 'text/html' },
        markers: [],
        valid: false,
        validation: 'not_json',
        snippet:
          '<!doctype html> <html> <head> <title>Error 404: Not Found</title> <base href="https&#x3A;&#x2F;&#x2F;x.example&#x2F;errors&#x2F;default&#x2F;" />',
        signals: [],
        hops: 0,
      },
    });
    expect(reclassifyRoute(magentoErrorPage).outcome).toEqual({ kind: 'not_found' });

    const bare404 = route({
      route: 'magento_graphql',
      outcome: { kind: 'not_platform' },
      evidence: {
        status: 404,
        finalUrl: 'https://x.example/graphql?query=x',
        headers: { 'content-type': 'text/html' },
        markers: [],
        valid: false,
        validation: 'not_json',
        signals: [],
        hops: 0,
      },
    });
    const h = host([bare404]);
    h.robots = {
      state: 'unreachable',
      status: 500,
      outcome: 'server_error',
      evidence: {
        status: 500,
        finalUrl: 'https://x.example/robots.txt',
        contentType: 'text/html',
        headers: { 'content-type': 'text/html' },
        markers: [],
        valid: false,
        validation: 'robots',
        snippet: '<html><head><base href="https://x.example/errors/default/" /></head>',
        signals: [],
        hops: 0,
      },
    };
    expect(reclassifyResult(h).routes[0]?.outcome).toEqual({ kind: 'not_found' });
  });

  it('turns a walled robots.txt into no verdict, whatever its status', () => {
    const h = host([route({ robots: 'allowed' })]);
    h.robots = {
      state: 'absent',
      status: 403,
      outcome: 'forbidden',
      evidence: {
        status: 403,
        finalUrl: 'https://x.example/robots.txt',
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
        markers: [],
        valid: false,
        validation: 'robots',
        signals: [],
        hops: 0,
      },
    };
    const after = reclassifyResult(h);
    expect(after.robots).toMatchObject({ state: 'unknown', outcome: 'wall' });
    expect(after.routes[0]?.robots).toBe('unknown');
  });

  it('leaves routes decided without the classifier alone', () => {
    const net = route({
      outcome: { kind: 'network_error', code: 'ENOTFOUND' },
      evidence: { finalUrl: 'https://x.example/', signals: ['inherited:robots'], hops: 0 },
    });
    expect(reclassifyRoute(net)).toBe(net);
  });
});
