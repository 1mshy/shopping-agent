import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertProfileUrl,
  buildSearchBody,
  LAB_USER_AGENT,
  REQUEST_HEADERS,
  searchCatalog,
} from './client.ts';
import {
  CAPABILITIES_INCOMPATIBLE_BODY,
  DISCOVERY_FAILURE_BODY,
  RATE_LIMIT_BODY,
  SEARCH_OK_BODY,
} from './fixtures.ts';

// A real-looking but never-contacted profile URL: the fake server below does not fetch it.
const PROFILE = 'https://profiles.agentic-dasher.test/agent-profile.json';

describe('buildSearchBody (shape from [GC] search_catalog example)', () => {
  it('builds a tools/call with meta.ucp-agent.profile beside catalog', () => {
    const body = buildSearchBody({ query: 'trail shoes', country: 'CA', currency: 'CAD' }, PROFILE);
    expect(body).toEqual({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 1,
      params: {
        name: 'search_catalog',
        arguments: {
          meta: { 'ucp-agent': { profile: PROFILE } },
          catalog: {
            query: 'trail shoes',
            context: { address_country: 'CA', currency: 'CAD' },
            pagination: { limit: 20 },
          },
        },
      },
    });
  });

  it('adds filters.ships_to only when asked', () => {
    const body = buildSearchBody(
      { query: 'q', country: 'DE', currency: 'EUR', limit: 5, shipsTo: true },
      PROFILE,
      7,
    );
    expect(body.id).toBe(7);
    expect(body.params.arguments.catalog.filters).toEqual({ ships_to: { country: 'DE' } });
    expect(body.params.arguments.catalog.pagination).toEqual({ limit: 5 });
  });

  it('rejects bad market codes and limits outside 1..50', () => {
    expect(() =>
      buildSearchBody({ query: 'q', country: 'ca', currency: 'CAD' }, PROFILE),
    ).toThrow();
    expect(() => buildSearchBody({ query: 'q', country: 'CA', currency: 'CA' }, PROFILE)).toThrow();
    expect(() =>
      buildSearchBody({ query: 'q', country: 'CA', currency: 'CAD', limit: 51 }, PROFILE),
    ).toThrow();
    expect(() =>
      buildSearchBody({ query: ' ', country: 'CA', currency: 'CAD' }, PROFILE),
    ).toThrow();
  });

  it('sends the MCP Accept header and an honest User-Agent', () => {
    expect(REQUEST_HEADERS.accept).toBe('application/json, text/event-stream');
    expect(REQUEST_HEADERS['user-agent']).toBe(LAB_USER_AGENT);
    expect(LAB_USER_AGENT).not.toMatch(/@|\.local|localhost/);
  });
});

describe('assertProfileUrl', () => {
  it('accepts a plain https URL', () => {
    expect(assertProfileUrl(PROFILE)).toBe(PROFILE);
  });
  it.each([
    'http://profiles.agentic-dasher.test/p.json',
    'https://example.com/p.json',
    'https://profiles.example/p.json',
    'https://localhost/p.json',
    'https://127.0.0.1/p.json',
    'https://host.test/PLACEHOLDER.json',
    'https://user:pw@host.test/p.json',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertProfileUrl(url)).toThrow();
  });
});

type Reply = { status: number; headers?: Record<string, string>; body: string };
let reply: Reply = { status: 200, body: '{}' };
let lastRequest: { headers: IncomingMessage['headers']; body: string } | null = null;
let server: Server;
let endpoint = '';

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      lastRequest = { headers: req.headers, body };
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ucp/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const PARAMS = { query: 'runner', country: 'CA', currency: 'CAD' } as const;
const search = () => searchCatalog(PARAMS, { profileUrl: PROFILE, endpoint });

describe('searchCatalog against a local server (synthetic payloads)', () => {
  it('posts the built body with the lab headers', async () => {
    reply = { status: 200, body: SEARCH_OK_BODY };
    await search();
    expect(lastRequest?.headers['user-agent']).toBe(LAB_USER_AGENT);
    expect(lastRequest?.headers.accept).toBe('application/json, text/event-stream');
    expect(JSON.parse(lastRequest?.body ?? '')).toEqual(buildSearchBody(PARAMS, PROFILE));
  });

  it('keeps every offer, flags other currencies and keeps amounts as returned', async () => {
    reply = { status: 200, body: SEARCH_OK_BODY };
    const r = await search();
    if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}`);
    expect(r.status).toBe(200);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.productCount).toBe(3);
    expect(r.totalCount).toBe(142);
    expect(r.ucpVersion).toBe('2026-08-25');
    expect(r.offers).toHaveLength(6);
    expect(r.offers.map((o) => o.currencyMatch)).toEqual([
      'requested',
      'other',
      'missing',
      'requested',
      'requested',
      'missing',
    ]);
    const [first, usd, noPrice, huge, str, noVariant] = r.offers;
    expect(first?.price).toEqual({ amount: '8999', amountJsonType: 'number', currency: 'CAD' });
    expect(first?.url).toBe(
      'https://shop-a.example/products/runner?variant=1&_gsid=clk_x&utm_source=shopify&utm_medium=catalog',
    );
    expect(first?.urlFrom).toBe('variant');
    expect(first?.attributionParams).toEqual(['_gsid', 'utm_source', 'utm_medium']);
    expect(first?.checkoutUrl).toBe('https://shop-a.example/cart/1:1');
    expect(first?.merchant).toEqual({
      name: 'Shop A',
      domain: 'shop-a.example',
      id: 'gid://shopify/Shop/1',
    });
    expect(usd?.price?.currency).toBe('USD');
    expect(usd?.available).toBe(false);
    expect(noPrice?.price).toBeNull();
    expect(noPrice?.urlFrom).toBe('product');
    expect(huge?.price?.amount).toBe('12345678901234567890');
    expect(str?.price).toEqual({ amount: '4500', amountJsonType: 'string', currency: 'CAD' });
    expect(noVariant?.variantId).toBeNull();
    expect(noVariant?.productTitle).toBe('No Variants');
    expect(r.messages).toHaveLength(1);
  });

  it('reads an SSE reply', async () => {
    reply = {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: `event: message\ndata: ${SEARCH_OK_BODY.replace(/\n\s*/g, '')}\n\n`,
    };
    const r = await search();
    expect(r.ok && r.offers.length).toBe(6);
    expect(r.contentType).toBe('text/event-stream');
  });

  it('maps a JSON-RPC discovery failure', async () => {
    reply = { status: 424, body: DISCOVERY_FAILURE_BODY };
    const r = await search();
    if (r.ok) throw new Error('expected error');
    expect(r.error).toMatchObject({
      kind: 'jsonrpc',
      jsonrpcCode: -32001,
      ucpCode: 'profile_unreachable',
    });
    expect(r.status).toBe(424);
  });

  it('maps 429 with Retry-After and records rate-limit headers', async () => {
    reply = {
      status: 429,
      headers: { 'retry-after': '30', 'shopify-complexity-score': '18', 'x-other': '1' },
      body: RATE_LIMIT_BODY,
    };
    const r = await search();
    if (r.ok) throw new Error('expected error');
    expect(r.error).toMatchObject({ kind: 'rate_limited', retryAfter: '30', jsonrpcCode: -32000 });
    expect(r.rateLimitHeaders).toEqual({ 'retry-after': '30', 'shopify-complexity-score': '18' });
  });

  it('maps a UCP error result (capabilities_incompatible)', async () => {
    reply = { status: 200, body: CAPABILITIES_INCOMPATIBLE_BODY };
    const r = await search();
    expect(r.ok ? null : r.error).toMatchObject({
      kind: 'ucp_error',
      ucpCode: 'capabilities_incompatible',
    });
  });

  it('maps non-JSON, plain HTTP errors and odd shapes', async () => {
    reply = { status: 200, body: 'not json' };
    const bad = await search();
    expect(bad.ok ? null : bad.error.kind).toBe('invalid_json');
    reply = { status: 503, headers: { 'content-type': 'text/html' }, body: '<h1>down</h1>' };
    const http = await search();
    expect(http.ok ? null : http.error).toMatchObject({ kind: 'http', body: '<h1>down</h1>' });
    reply = { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{}}}' };
    const odd = await search();
    expect(odd.ok ? null : odd.error.kind).toBe('unexpected_shape');
  });

  it('maps a refused connection to a network error', async () => {
    const r = await searchCatalog(PARAMS, {
      profileUrl: PROFILE,
      endpoint: 'http://127.0.0.1:1/x',
    });
    expect(r.ok ? null : r.error.kind).toBe('network');
    expect(r.status).toBeNull();
  });
});
