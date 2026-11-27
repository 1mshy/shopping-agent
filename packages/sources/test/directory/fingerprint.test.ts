import {
  CookieJars,
  classifyResponse,
  createFetcher,
  memoryPacingStore,
  memoryPlaybookStore,
  type RobotsMode,
} from '@agentic-dasher/fetch';
import { describe, expect, it } from 'vitest';
import { type PageReply, scriptedNetwork } from '../../../fetch/test/page/net.ts';
import { fingerprintStore } from '../../src/directory/fingerprint.ts';

const origin = 'https://shop.example';
const market = { country: 'CA', currency: 'CAD', language: 'en' } as const;
const base = `${origin}/en-ca/`;
const html = `<html><head>
<meta name="generator" content="Shopify">
<link rel="search" type="application/opensearchdescription+xml" href="/os.xml">
<script type="application/ld+json">{"@type":"WebSite","potentialAction":{"@type":"SearchAction","target":{"urlTemplate":"/en-ca/search?q={search_term_string}"}}}</script>
</head><body><h2 itemscope itemtype="https://schema.org/Product">Synthetic kettle</h2></body></html>`;
const suggest = `${base}search/suggest.json?q=a&resources%5Btype%5D=product&resources%5Blimit%5D=1`;
const reply = (body: string, contentType = 'text/html'): PageReply => ({
  status: 200,
  body: [
    contentType === 'text/html'
      ? `${body}<p>Browse the catalog of kitchen equipment and home essentials from our example shop.</p>`
      : body,
  ],
  headers: [['content-type', contentType]],
});
const profile = {
  ucp: {
    version: '2026-08-25',
    capabilities: { 'dev.ucp.shopping.catalog.search': [{ version: '2026-08-25' }] },
    services: { 'dev.ucp.shopping': [{ transport: 'mcp', endpoint: `${origin}/catalog` }] },
  },
};
const records: Record<string, PageReply> = {
  [base]: reply(html),
  [suggest]: reply('{"resources":{"results":{"products":[]}}}', 'application/json'),
  [`${origin}/.well-known/ucp`]: reply(JSON.stringify(profile), 'application/json'),
  [`${origin}/os.xml`]: reply(
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><Url type="text/html" template="/en-ca/os?q={searchTerms}"/></OpenSearchDescription>',
    'application/xml',
  ),
  [`${origin}/sitemap.xml`]: reply(
    '<sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>',
    'application/xml',
  ),
  [`${origin}/llms.txt`]: reply('An unrelated string used as document content', 'text/plain'),
};
async function run(replies = records, robots: RobotsMode = 'ignore') {
  let now = 100_000;
  const net = scriptedNetwork({ dns: { 'shop.example': ['93.184.216.34'] }, replies });
  const fetcher = createFetcher({
    network: net.network,
    classify: classifyResponse,
    jars: new CookieJars(),
    pacing: memoryPacingStore(),
    playbook: memoryPlaybookStore(),
    robotsMode: () => robots,
    now: () => now,
    random: () => 0.5,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const result = await fingerprintStore({ origin, marketPrefix: '/en-ca', market }, fetcher, {
    deadline: now + 100_000,
    signal: new AbortController().signal,
  });
  return { result, urls: net.hops.map((h) => h.url) };
}

describe('fingerprintStore', () => {
  it('records typed evidence from one market in six guarded exchanges', async () => {
    const { result, urls } = await run();
    expect(urls).toEqual(Object.keys(records));
    expect(result).toMatchObject({
      market,
      platform: 'shopify',
      predictiveSearch: true,
      productMarkup: true,
      productSitemap: true,
      llmsTxt: true,
      ucpCatalogEndpoint: `${origin}/catalog`,
      searchAction: `${base}search?q={search_term_string}`,
      openSearchTemplate: `${base}os?q={searchTerms}`,
      wireRequests: 6,
    });
    expect(JSON.stringify(result)).not.toContain('unrelated string');
  });
  it('includes robots and redirected requests in the same six exchanges', async () => {
    const { result, urls } = await run(
      {
        ...records,
        [`${origin}/robots.txt`]: reply('User-agent: *\nAllow: /', 'text/plain'),
        [base]: { status: 302, headers: [['location', `${base}index`]] },
        [`${base}index`]: reply(html),
      },
      'respect',
    );
    expect(urls).toEqual([
      `${origin}/robots.txt`,
      base,
      `${base}index`,
      suggest,
      `${origin}/.well-known/ucp`,
      `${origin}/os.xml`,
    ]);
    expect(result).toMatchObject({
      platform: 'shopify',
      llmsTxt: null,
      productSitemap: null,
      wireRequests: 6,
    });
  });
  it('does not attribute a different market’s page or predictive-search response to this storefront', async () => {
    const foreign = `${origin}/en-us/`;
    const { result } = await run({
      ...records,
      [base]: { status: 302, headers: [['location', foreign]] },
      [foreign]: reply(html),
      [suggest]: { status: 302, headers: [['location', `${foreign}search/suggest.json`]] },
      [`${foreign}search/suggest.json`]: reply(
        '{"resources":{"results":{"products":[]}}}',
        'application/json',
      ),
    });
    expect(result).toMatchObject({
      platform: 'unknown',
      predictiveSearch: null,
      searchAction: null,
      productMarkup: null,
      wireRequests: 6,
    });
    expect(result.probes.slice(0, 2)).toEqual([
      { probe: 'home', outcome: 'other_storefront' },
      { probe: 'platform', outcome: 'other_storefront' },
    ]);
  });
  it('stops after a rate limit, leaving absent evidence unknown', async () => {
    const { result, urls } = await run({ [base]: { status: 429 } });
    expect(urls).toEqual([base]);
    expect(result).toMatchObject({
      platform: 'unknown',
      predictiveSearch: null,
      productMarkup: null,
      productSitemap: null,
      llmsTxt: null,
      wireRequests: 1,
    });
  });
  it.each([
    {
      markup: '<link rel="stylesheet" href="/skin/frontend/base/theme/main.css">',
      generation: 1,
      probes: 4,
    },
    { markup: '<script type="text/x-magento-init">{}</script>', generation: 2, probes: 5 },
  ])('records Magento $generation generation evidence', async ({ markup, generation, probes }) => {
    const gql = new URL('graphql', base);
    gql.searchParams.set('query', '{storeConfig{store_code}}');
    const { result, urls } = await run({
      ...records,
      [base]: reply(markup),
      [gql.href]: reply('{"data":{"storeConfig":{"store_code":"en_ca"}}}', 'application/json'),
    });
    expect(result).toMatchObject({
      platform: 'magento',
      magentoGeneration: generation,
      wireRequests: probes,
    });
    expect(urls.includes(gql.href)).toBe(generation === 2);
  });
  it('recognises Woo only after the WordPress shop endpoint gives a product response', async () => {
    const woo = `${base}wp-json/wc/store/v1/products?per_page=1`;
    const wp = reply('<meta name="generator" content="WordPress 7">');
    const { result } = await run({
      ...records,
      [base]: wp,
      [woo]: reply(
        '[{"name":"Kettle","permalink":"https://shop.example/en-ca/p/kettle","prices":{"currency_code":"CAD"}}]',
        'application/json',
      ),
    });
    expect(result).toMatchObject({
      platform: 'woo',
      platformEvidence: 'woo_store_api',
      wireRequests: 5,
    });
    const empty = await run({ ...records, [base]: wp, [woo]: reply('[]', 'application/json') });
    expect(empty.result.platform).toBe('unknown');
  });
  it('leaves off-site templates alone and respects an explicit negative predictive-search flag', async () => {
    const markup = `<script id="shopify-features" type="application/json">{"predictiveSearch":false}</script>
      <link rel="search" type="application/opensearchdescription+xml" href="https://elsewhere.example/os.xml">
      <script type="application/ld+json">{"@type":"SearchAction","target":"https://elsewhere.example/search?q={query}"}</script>`;
    const { result, urls } = await run({ ...records, [base]: reply(markup) });
    expect(result).toMatchObject({
      platform: 'shopify',
      predictiveSearch: false,
      searchAction: null,
      openSearchTemplate: null,
      wireRequests: 4,
    });
    expect(urls.every((u) => new URL(u).origin === origin)).toBe(true);
  });
});
