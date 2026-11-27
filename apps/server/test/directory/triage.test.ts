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
import { createStoreDirectory } from '../../src/directory/triage.ts';
import { checkListing } from '../../src/sweep/index.ts';
import {
  CA,
  Clock,
  depsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  MIN,
  readOf,
  TempDb,
} from '../sweep/harness.ts';

let tmp: TempDb;
beforeEach(() => {
  tmp = new TempDb();
});
afterEach(() => tmp.dispose());
const origin = 'https://shop.example';
const home = `${origin}/`;
const body = (content: string): PageReply => ({
  status: 200,
  headers: [['content-type', 'text/html']],
  body: [
    `<html><body>${content}<p>Welcome to our local community centre. Please browse our meeting schedule and calendar of activities.</p></body></html>`,
  ],
});

function setup() {
  const clock = new Clock();
  const storeId = insertStore(tmp.db, {
    host: 'shop.example',
    platform: 'unknown',
    trustTier: 'caution',
  });
  tmp.db.orm
    .update(schema.store)
    .set({ isShop: 'unknown', trustReasons: ['operator'] })
    .run();
  const replies: Record<string, PageReply> = {
    [home]: body(''),
    [`${home}search/suggest.json?q=a&resources%5Btype%5D=product&resources%5Blimit%5D=1`]: {
      status: 404,
    },
    [`${home}.well-known/ucp`]: { status: 404 },
    [`${home}sitemap.xml`]: { status: 404 },
    [`${home}llms.txt`]: { status: 404 },
  };
  const net = scriptedNetwork({ dns: { 'shop.example': ['93.184.216.34'] }, replies });
  const fetcher = createFetcher({
    network: net.network,
    classify: classifyResponse,
    jars: new CookieJars(),
    pacing: memoryPacingStore(),
    playbook: memoryPlaybookStore(),
    robotsMode: () => 'ignore',
    now: clock.now,
    random: () => 0.5,
    sleep: async (ms) => clock.advance(ms),
  });
  const directory = () => createStoreDirectory({ db: tmp.db, fetcher, now: clock.now });
  const request = () => ({
    storeId,
    market: CA,
    deadline: clock.now() + 100_000,
    signal: new AbortController().signal,
  });
  const row = () => tmp.db.orm.select().from(schema.store).get();
  return { clock, storeId, replies, net, directory, request, row, fetcher };
}

it('reads a storefront once and keeps its typed market evidence through a database restart and other markets', async () => {
  const h = setup();
  h.replies[home] = body('<div itemscope itemtype="https://schema.org/Product">Kettle</div>');
  const run = () => h.directory().fingerprint(h.request());
  const first = await run();
  expect(first).toMatchObject({
    kind: 'fresh',
    isShop: 'yes',
    evidence: { market: CA, productMarkup: true, productSitemap: false, wireRequests: 5 },
  });
  expect(h.net.hops).toHaveLength(5);
  expect(h.row()).toMatchObject({
    host: 'shop.example',
    source: 'pasted',
    trustTier: 'caution',
    trustReasons: ['operator'],
    isShop: 'yes',
    fingerprintedAt: h.clock.iso(),
  });
  tmp.db.close();
  tmp.db = TempDb.open(tmp.file);
  expect(await run()).toEqual({ ...first, kind: 'cached' });
  expect(h.net.hops).toHaveLength(5);
  const french = { ...CA, language: 'fr-CA' };
  expect(await h.directory().fingerprint({ ...h.request(), market: french })).toMatchObject({
    kind: 'fresh',
    evidence: { market: french },
  });
  expect(h.net.hops).toHaveLength(10);
  expect(await run()).toEqual({ ...first, kind: 'cached' });
  expect(h.net.hops).toHaveLength(10);
  h.clock.advance(30 * 24 * 60 * MIN);
  expect(await run()).toMatchObject({ kind: 'fresh', isShop: 'yes' });
  expect(h.net.hops).toHaveLength(15);
});

it('records absent shop evidence only after inspecting the home, platform endpoint and sitemap', async () => {
  const h = setup();
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    kind: 'fresh',
    isShop: 'no',
    evidence: { productMarkup: false, productSitemap: false, platform: 'unknown', wireRequests: 5 },
  });
  expect(h.row()?.isShop).toBe('no');
});

it('keeps a refused probe unknown and retries after the short expiry', async () => {
  const h = setup();
  h.replies[home] = { status: 429 };
  const first = await h.directory().fingerprint(h.request());
  expect(first).toMatchObject({
    kind: 'fresh',
    isShop: 'unknown',
    evidence: {
      productMarkup: null,
      productSitemap: null,
      probes: [{ probe: 'home', outcome: 'rate_limited' }],
      wireRequests: 1,
    },
  });
  expect(await h.directory().fingerprint(h.request())).toEqual({ ...first, kind: 'cached' });
  expect(h.net.hops).toHaveLength(1);
  h.clock.advance(24 * 60 * MIN);
  h.replies[home] = body('');
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    kind: 'fresh',
    isShop: 'no',
    evidence: { wireRequests: 5 },
  });
  expect(h.net.hops).toHaveLength(6);
});

it.each(['home', 'sitemap'])('keeps an unreadable %s document unknown', async (doc) => {
  const h = setup();
  h.replies[doc === 'home' ? home : `${home}sitemap.xml`] = {
    status: 200,
    headers: [['content-type', 'text/plain']],
    body: ['This is plain text rather than useful catalogue data.'],
  };
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    kind: 'fresh',
    isShop: 'unknown',
  });
});

it('retains a direct-price shop after an evidence-free inspection and when a cached result is reused', async () => {
  const h = setup();
  tmp.db.orm
    .update(schema.store)
    .set({ isShop: 'yes', lastOkAt: h.clock.iso(), readRoute: 'json_ld', searchRoute: 'adapter' })
    .run();
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    kind: 'fresh',
    isShop: 'yes',
    evidence: { productMarkup: false, productSitemap: false },
  });
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    kind: 'cached',
    isShop: 'yes',
  });
  expect(h.row()).toMatchObject({
    isShop: 'yes',
    source: 'pasted',
    trustTier: 'caution',
    trustReasons: ['operator'],
    readRoute: 'json_ld',
    searchRoute: 'adapter',
  });
});

it('honours a block set during a probe and rejects a mismatched origin before a request', async () => {
  const h = setup();
  await expect(
    h.directory().fingerprint({ ...h.request(), origin: 'https://elsewhere.example' }),
  ).rejects.toThrow(/origin/);
  expect(h.net.hops).toHaveLength(0);
  const pending = h.directory().fingerprint(h.request());
  tmp.db.orm.update(schema.store).set({ trustTier: 'blocked' }).run();
  expect(await pending).toEqual({ kind: 'blocked' });
  expect(h.row()).toMatchObject({
    trustTier: 'blocked',
    fingerprintedAt: null,
    fingerprint: null,
    isShop: 'unknown',
  });
  const count = h.net.hops.length;
  expect(await h.directory().fingerprint(h.request())).toEqual({ kind: 'blocked' });
  expect(h.net.hops).toHaveLength(count);
});

it.each([null, 10000])(
  'keeps direct-price proof separate from health after a sweep with sticker %s',
  async (sticker) => {
    const h = setup();
    h.replies[home] = body('<div itemscope itemtype="https://schema.org/Product">Kettle</div>');
    expect(await h.directory().fingerprint(h.request())).toMatchObject({ isShop: 'yes' });
    const url = `${home}p/kettle`;
    const listingId = insertListing(tmp.db, h.clock, { storeId: h.storeId, url });
    follow(tmp.db, insertWatch(tmp.db, h.clock), listingId);
    h.replies[url] = body('Kettle availability');
    const sweep = await checkListing(
      depsOf(
        tmp,
        h.clock,
        async (req, _readers, ctx) => {
          const page = await ctx.get({ url: req.url, rung: 'http' });
          expect(page.outcome.kind).toBe('ok');
          const read = readOf({
            sticker,
            availability: sticker === null ? 'out' : 'in',
            method: 'json_ld',
            rung: 'http',
          });
          return { kind: 'read', read, methods: [], candidates: read.candidates };
        },
        [],
        { fetcher: h.fetcher },
      ),
      listingId,
      { force: true },
    );
    expect(sweep.outcome.kind).toBe('read');
    expect(h.row()?.lastOkAt).not.toBeNull();
    h.clock.advance(31 * 24 * 60 * MIN);
    h.replies[home] = body('');
    expect(await h.directory().fingerprint(h.request())).toMatchObject({
      kind: 'fresh',
      isShop: sticker === null ? 'no' : 'yes',
      evidence: { platform: 'unknown', productMarkup: false, productSitemap: false },
    });
  },
);

it('replaces a platform learned from an expired fingerprint when the storefront moves', async () => {
  const h = setup();
  h.replies[home] = body('<meta name="generator" content="Shopify">');
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    evidence: { platform: 'shopify' },
  });
  expect(h.row()?.platform).toBe('shopify');
  h.clock.advance(31 * 24 * 60 * MIN);
  h.replies[home] = body('<meta name="generator" content="WooCommerce">');
  h.replies[`${home}wp-json/wc/store/v1/products?per_page=1`] = { status: 404 };
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    evidence: { platform: 'woo' },
  });
  expect(h.row()?.platform).toBe('woo');
});

it('only reuses direct platform evidence at its recorded origin', async () => {
  const h = setup();
  tmp.db.orm
    .update(schema.store)
    .set({
      platform: 'shopify',
      platformEvidence: `direct_read ${origin}`,
      lastOkAt: h.clock.iso(),
    })
    .run();
  const foreign = 'http://shop.example';
  for (const [url, reply] of Object.entries(h.replies))
    h.replies[url.replace(origin, foreign)] = reply;
  expect(await h.directory().fingerprint({ ...h.request(), origin: foreign })).toMatchObject({
    isShop: 'no',
    evidence: { platform: 'unknown', platformEvidence: null },
  });
  expect(await h.directory().fingerprint(h.request())).toMatchObject({
    isShop: 'yes',
    evidence: { platform: 'shopify', platformEvidence: 'prior_read' },
  });
  expect(h.row()).toMatchObject({ platform: 'shopify', platformEvidence: `direct_read ${origin}` });
});
