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

  it('leaves routes decided without the classifier alone', () => {
    const net = route({
      outcome: { kind: 'network_error', code: 'ENOTFOUND' },
      evidence: { finalUrl: 'https://x.example/', signals: ['inherited:robots'], hops: 0 },
    });
    expect(reclassifyRoute(net)).toBe(net);
  });
});
