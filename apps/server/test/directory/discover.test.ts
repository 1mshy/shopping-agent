import { schema } from '@agentic-dasher/db';
import {
  CookieJars,
  classifyResponse,
  createFetcher,
  memoryPacingStore,
  memoryPlaybookStore,
} from '@agentic-dasher/fetch';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type PageReply, scriptedNetwork } from '../../../../packages/fetch/test/page/net.ts';
import { createDirectoryDiscovery } from '../../src/directory/discover.ts';
import { CA, Clock, insertStore, TempDb } from '../sweep/harness.ts';

let tmp: TempDb;
beforeEach(() => {
  tmp = new TempDb();
});
afterEach(() => tmp.dispose());

it('searches an eligible shop through the guarded directory and preserves a wall as a failed lookup', async () => {
  const origin = 'https://watch.example.ca';
  const clock = new Clock();
  insertStore(tmp.db, { host: 'watch.example.ca' });
  insertStore(tmp.db, { host: 'blocked.example.ca', trustTier: 'blocked' });
  const reply = (body: string, mime = 'application/json'): PageReply => ({
    status: 200,
    headers: [['content-type', mime]],
    body: [body],
  });
  const search = (q: string, limit: number) =>
    origin +
    '/search/suggest.json?' +
    new URLSearchParams({ q, 'resources[type]': 'product', 'resources[limit]': String(limit) });
  const name = 'Acme ZX100';
  const product = { title: name, handle: 'zx100', url: '/products/zx100', price: '1.00' };
  const response = reply(JSON.stringify({ resources: { results: { products: [product] } } }));
  const replies: Record<string, PageReply> = {
    [origin + '/']: reply(
      '<html><body><p>Welcome to our catalog of quality products. Browse accessories, apparel and hundreds of other great products.</p></body></html>',
      'text/html',
    ),
    [search('a', 1)]: response,
    [search(name, 10)]: response,
  };
  for (const path of ['/.well-known/ucp', '/sitemap.xml', '/llms.txt'])
    replies[origin + path] = { status: 404 };
  const net = scriptedNetwork({ dns: { 'watch.example.ca': ['93.184.216.34'] }, replies });
  const fetcher = createFetcher({
    network: net.network,
    classify: classifyResponse,
    jars: new CookieJars(),
    pacing: memoryPacingStore(),
    playbook: memoryPlaybookStore(),
    robotsMode: () => 'respect',
    now: clock.now,
    random: () => 0.5,
    sleep: async (ms) => clock.advance(ms),
  });
  replies[origin + '/robots.txt'] = { status: 404 };
  const discover = createDirectoryDiscovery({ db: tmp.db, fetcher, now: clock.now });
  const request = { name, market: CA, signal: new AbortController().signal };
  const found = await discover(request);
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ url: origin + '/products/zx100', title: name });
  expect(found[0]).not.toHaveProperty('price');
  expect(tmp.db.orm.select().from(schema.store).all()[0]?.searchRoute).toBe('shopify_suggest');
  expect(net.lookups).not.toContain('blocked.example.ca');
  replies[search(name, 10)] = { status: 429 };
  await expect(discover(request)).rejects.toThrow('Directory stores could not be read');
});

it('uses a declared fallback after unsupported Shopify search, and stops on a wall', async () => {
  const { searchStoreRoutes } = await import('../../src/directory/discover.ts');
  const { fakeContext } = await import('../../../../packages/sources/test/platform/fake.ts');
  const origin = 'https://shop.example';
  const input = { origin, marketPrefix: '', query: 'kettle', market: CA };
  const evidence = {
    market: CA,
    platform: 'shopify' as const,
    platformEvidence: 'home_markup' as const,
    magentoGeneration: null,
    predictiveSearch: true,
    productMarkup: true,
    productSitemap: null,
    llmsTxt: null,
    ucpCatalogEndpoint: null,
    searchAction: origin + '/find?name={searchTerms}',
    openSearchTemplate: null,
    wireRequests: 1,
    probes: [],
  };
  const endpoint =
    origin + '/search/suggest.json?q=kettle&resources%5Btype%5D=product&resources%5Blimit%5D=10';
  const html = origin + '/find?name=kettle';
  const replies = {
    [endpoint]: { status: 417 },
    [html]: { contentType: 'text/html', body: '<a href="/product/kettle">Kettle</a>' },
  };
  const { context, sent } = fakeContext(replies);
  expect(await searchStoreRoutes(input, evidence, context)).toMatchObject({
    route: 'search_action',
    result: { kind: 'results', candidates: [{ title: 'Kettle' }] },
  });
  expect(sent.map((r) => r.url)).toEqual([endpoint, html]);
  const wall = fakeContext({ ...replies, [endpoint]: { status: 429 } });
  expect(await searchStoreRoutes(input, evidence, wall.context)).toMatchObject({
    result: { kind: 'fetch_failed', outcome: { kind: 'rate_limited' } },
  });
  expect(wall.sent).toHaveLength(1);
});
