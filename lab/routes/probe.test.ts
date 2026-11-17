// End-to-end probe tests against an in-process server on 127.0.0.1. Everything it serves is a
// hand-written fixture (./fixtures/README.md), not evidence about any real shop.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ListKind } from './outcome.ts';
import { Pacer } from './pacer.ts';
import { type ProbeConfig, probeDomain } from './probe.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
type Handler = (req: IncomingMessage, res: ServerResponse, port: number) => void;
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function serve(routes: Record<string, Handler | [number, string, string?]>): Promise<number> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const route = routes[path];
    const port = (server.address() as AddressInfo).port;
    if (typeof route === 'function') return route(req, res, port);
    const [status, body, type] = route ?? [404, '<html><title>Not found</title></html>'];
    res.writeHead(status, { 'content-type': type ?? 'text/html' }).end(body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

const config = (over: Partial<ProbeConfig> = {}): ProbeConfig => ({
  userAgent: 'agentic-dasher-lab/0.1 (route reachability probe)',
  maxRequests: 5,
  timeoutMs: 2000,
  maxBytes: 1_000_000,
  maxHops: 3,
  scheme: 'http',
  guard: { allowLoopback: true },
  pacer: new Pacer({ minGapMs: 0 }),
  ...over,
});
const probe = async (port: number, list: ListKind, over?: Partial<ProbeConfig>) =>
  probeDomain(`127.0.0.1:${port}`, list, config(over));
const JSON_T = 'application/json';
const ROBOTS: [number, string, string] = [200, 'User-agent: *\nDisallow: /search\n', 'text/plain'];

describe('probeDomain', () => {
  it('reads a valid Woo Store API answer and records the robots verdict', async () => {
    const port = await serve({
      '/robots.txt': [200, 'User-agent: *\nDisallow: /wp-json/\n', 'text/plain'],
      '/wp-json/wc/store/v1/products': [200, fixture('woo-products.json'), JSON_T],
    });
    const r = await probe(port, 'woocommerce');
    expect(r.robots.state).toBe('parsed');
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]).toMatchObject({
      route: 'woo_store_search',
      outcome: { kind: 'ok' },
      robots: 'disallowed',
      evidence: { status: 200, contentType: JSON_T },
    });
    expect(r.requests).toBe(2);
    expect(r.userAgent).toBe('agentic-dasher-lab/0.1 (route reachability probe)');
  });

  it('classifies a 200 HTML challenge on a JSON route as a wall', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/wp-json/wc/store/v1/products': [200, fixture('challenge.html')],
    });
    const r = await probe(port, 'woocommerce');
    expect(r.routes[0]?.outcome).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'challenge' });
    expect(r.routes[0]?.evidence).toMatchObject({
      validation: 'not_json',
      title: 'just a moment...',
      snippet: expect.stringContaining('<title>Just a moment...</title>'),
    });
  });

  it('takes the product handle from suggest.json and reads the product JSON', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/search/suggest.json': [200, fixture('shopify-suggest.json'), JSON_T],
      '/products/red-rain-coat.js': [200, fixture('shopify-product.json'), JSON_T],
    });
    const r = await probe(port, 'shopify');
    expect(r.routes.map((x) => [x.route, x.outcome.kind, x.robots])).toEqual([
      ['shopify_suggest', 'ok', 'disallowed'],
      ['shopify_product_js', 'ok', 'allowed'],
    ]);
    expect(r.routes[1]?.handleSource).toBe('suggest');
    expect(r.requests).toBe(3);
  });

  it('falls back to a product link on the home page when suggest.json gives no handle', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/search/suggest.json': [429, '{"message":"Too many requests"}', JSON_T],
      '/': [200, '<html><body><a href="/products/red-rain-coat?variant=1">Coat</a></body></html>'],
      '/products/red-rain-coat.js': [200, fixture('shopify-product.json'), JSON_T],
    });
    const r = await probe(port, 'shopify');
    expect(r.routes.map((x) => x.outcome.kind)).toEqual(['rate_limited', 'ok']);
    expect(r.routes[1]).toMatchObject({ handleSource: 'home', requests: 2 });
    expect(r.requests).toBe(4);
  });

  it('sends the Magento products query as GET and validates its shape', async () => {
    let query = '';
    const port = await serve({
      '/robots.txt': [404, 'nope'],
      '/graphql': (req, res) => {
        query = new URL(req.url ?? '', 'http://x').searchParams.get('query') ?? '';
        res.writeHead(200, { 'content-type': JSON_T }).end(fixture('magento-products.json'));
      },
    });
    const r = await probe(port, 'magento');
    expect(query).toContain('products(');
    expect(r.robots.state).toBe('absent');
    expect(r.routes[0]).toMatchObject({ outcome: { kind: 'ok' }, robots: 'allowed' });
  });

  it('discovers a JSON-LD SearchAction and an OpenSearch description on the home page', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/': [200, fixture('home.html')],
      '/opensearch.xml': [200, fixture('opensearch.xml'), 'application/opensearchdescription+xml'],
    });
    const r = await probe(port, 'searchaction');
    expect(r.routes.map((x) => [x.route, x.outcome.kind])).toEqual([
      ['home_searchaction', 'ok'],
      ['opensearch', 'ok'],
    ]);
    expect(r.routes[0]?.evidence.validation).toContain('{search_term_string}');
    expect(r.requests).toBe(3);
  });

  it('stops at a redirect to another site', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/wp-json/wc/store/v1/products': (_q, res, p) =>
        res.writeHead(302, { location: `http://localhost:${p}/elsewhere` }).end(),
    });
    const r = await probe(port, 'woocommerce');
    expect(r.routes[0]?.outcome.kind).toBe('off_site_redirect');
  });

  it('refuses a redirect to a private address', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/wp-json/wc/store/v1/products': (_q, res) =>
        res.writeHead(301, { location: 'http://10.0.0.1/admin' }).end(),
    });
    const r = await probe(port, 'woocommerce');
    expect(r.routes[0]?.outcome).toEqual({ kind: 'refused_by_policy', reason: 'private_address' });
    expect(r.requests).toBe(2);
  });

  it('refuses a body over the size cap', async () => {
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/wp-json/wc/store/v1/products': [200, `[${'"x",'.repeat(5000)}"x"]`, JSON_T],
    });
    const r = await probe(port, 'woocommerce', { maxBytes: 4096 });
    expect(r.routes[0]?.outcome).toEqual({ kind: 'refused_by_policy', reason: 'body_cap' });
  });

  it('times out, retries once, and reports a network error', async () => {
    let hits = 0;
    const port = await serve({
      '/robots.txt': ROBOTS,
      '/wp-json/wc/store/v1/products': () => {
        hits++;
      },
    });
    const r = await probe(port, 'woocommerce', { timeoutMs: 150 });
    expect(r.routes[0]?.outcome).toEqual({ kind: 'network_error', code: 'timeout' });
    expect(hits).toBe(2);
    expect(r.requests).toBe(3);
  });

  it('treats an unreachable robots.txt as disallow-all, per RFC 9309', async () => {
    const port = await serve({
      '/robots.txt': [503, 'down'],
      '/wp-json/wc/store/v1/products': [200, '[]', JSON_T],
    });
    const r = await probe(port, 'woocommerce');
    expect(r.robots.state).toBe('unreachable');
    expect(r.routes[0]).toMatchObject({ outcome: { kind: 'empty' }, robots: 'disallowed' });
  });

  it('enforces the per-domain request cap, counting robots.txt', async () => {
    const port = await serve({ '/robots.txt': ROBOTS });
    const r = await probe(port, 'shopify', { maxRequests: 1 });
    expect(r.requests).toBe(1);
    expect(r.routes.map((x) => x.outcome)).toEqual([
      { kind: 'skipped', reason: 'request_cap' },
      { kind: 'skipped', reason: 'request_cap' },
    ]);
  });
});
