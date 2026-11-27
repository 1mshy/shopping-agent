import { schema } from '@agentic-dasher/db';
import type { Fetcher } from '@agentic-dasher/fetch';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkListing } from '../../src/sweep/index.ts';
import { createWatchRoutes, createWatchService } from '../../src/watches/index.ts';
import { CA, Clock, MIN, observationsOf, TempDb } from '../sweep/harness.ts';

let tmp: TempDb;
beforeEach(() => {
  tmp = new TempDb();
});
afterEach(() => tmp.dispose());

it('recognises the pasted storefront only after it yields a price, once across repeated reads', async () => {
  const { db } = tmp;
  const clock = new Clock();
  const deps = { db, now: clock.now, market: () => CA };
  const watches = createWatchService(deps);
  const routes = createWatchRoutes({
    ...deps,
    watches,
    refresh: () => ({ runId: 1, joined: false }),
  });
  const url = 'https://retailer.example/en-ca/products/kettle';
  const saved = await routes.request('/watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: url }),
  });
  expect(saved.status).toBe(201);
  const stores = () => db.orm.select().from(schema.store).all();
  const initial = stores();
  expect(initial).toMatchObject([
    { host: 'retailer.example', marketPrefix: '/en-ca', source: 'pasted', isShop: 'unknown' },
  ]);
  const listing = db.orm.select().from(schema.listing).get();
  if (!listing) throw new Error('watch lookup did not create a listing');
  let html = '<html><title>Kettle</title></html>';
  let pageUrl = url;
  const requests: string[] = [];
  const fetcher: Fetcher = {
    get: async (request) => {
      requests.push(request.url);
      // A same-host platform probe succeeds at HTTP level but supplies no product.
      const api = request.rung === 'api';
      const body = api ? '{}' : html;
      return {
        outcome: { kind: 'ok', rung: request.rung },
        robots: null,
        closedUntil: null,
        response: {
          status: 200,
          finalUrl: api ? request.url : pageUrl,
          headers: {},
          setCookies: [],
          contentType: api ? 'application/json' : 'text/html',
          text: body,
          body: new TextEncoder().encode(body),
        },
      };
    },
  };
  const check = () =>
    checkListing({ ...deps, fetcher, logger: () => {} }, listing.id, { force: true });
  expect((await check()).outcome.kind).toBe('failed');
  expect(stores()).toMatchObject([{ id: listing.storeId, isShop: 'unknown', lastOkAt: null }]);
  expect(observationsOf(db, listing.id)).toHaveLength(0);

  html =
    '<script type="application/ld+json">{"@type":"Product","name":"Kettle","offers":{"@type":"Offer","price":"39.99","priceCurrency":"CAD","availability":"https://schema.org/InStock"}}</script>';
  for (const redirected of [
    'https://elsewhere.example/en-ca/p/kettle',
    'https://retailer.example/en-us/p/kettle',
  ]) {
    clock.advance(30 * MIN);
    pageUrl = redirected;
    expect((await check()).outcome.kind).toBe('read');
    expect(stores()).toMatchObject([{ id: listing.storeId, isShop: 'unknown' }]);
  }
  expect(observationsOf(db, listing.id)).toHaveLength(2);

  pageUrl = url;
  for (let read = 1; read <= 2; read++) {
    clock.advance(30 * MIN);
    expect((await check()).outcome.kind).toBe('read');
    expect(stores()).toMatchObject([
      {
        id: listing.storeId,
        host: 'retailer.example',
        marketPrefix: '/en-ca',
        source: 'pasted',
        isShop: 'yes',
        readRoute: 'json_ld',
        lastOkAt: clock.iso(),
        fingerprintedAt: null,
        trustTier: 'unverified',
      },
    ]);
    expect(observationsOf(db, listing.id)).toHaveLength(read + 2);
  }
  expect(requests).toEqual(Array.from({ length: 5 }, () => [`${url}.js`, url]).flat());
});
