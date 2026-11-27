// The ordinary name-watch route, discovery, and the next sweep share a real SQLite database.
// Only the store search and the read are scripted.
import { schema } from '@agentic-dasher/db';
import type { WatchView } from '@agentic-dasher/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkListing } from '../../src/sweep/index.ts';
import { type Candidate, createWatchRoutes, createWatchService } from '../../src/watches/index.ts';
import { CA, Clock, depsOf, eventsOf, PROFILE, readOf, TempDb } from '../sweep/harness.ts';

const name = 'Acme ZX100';
const result: Candidate = {
  url: 'https://shop.example.ca/products/acme-zx100',
  storeHost: 'shop.example.ca',
  marketPrefix: '',
  title: 'ZX100',
  brand: 'Acme',
  mpn: 'ZX100',
  sku: 'retailer-230',
  gtin: null,
  variant: {},
};

let tmp: TempDb;
let clock: Clock;
let candidate: Candidate;
let service: ReturnType<typeof createWatchService>;
let app: ReturnType<typeof createWatchRoutes>;
beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  candidate = result;
  service = createWatchService({
    db: tmp.db,
    now: clock.now,
    market: () => CA,
    discover: async () => [candidate],
  });
  app = createWatchRoutes({
    db: tmp.db,
    watches: service,
    refresh: () => ({ runId: 1, joined: false }),
  });
});
afterEach(() => tmp.dispose());

async function create() {
  const response = await app.request('/watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: name, targetPrice: { amountMinor: 12_000, currency: 'CAD' } }),
  });
  expect(response.status).toBe(201);
  const { watch } = (await response.json()) as { watch: WatchView };
  return watch.id;
}

function listingOf(watchId: number) {
  const listing = service.get(PROFILE, watchId).listings[0];
  if (!listing) throw new Error('expected one discovery result');
  return listing;
}

async function relookup(watchId: number) {
  tmp.db.orm
    .update(schema.watch)
    .set({ lookupState: 'queued', lookupDueAt: clock.iso() })
    .where(eq(schema.watch.id, watchId))
    .run();
  await service.runLookup(watchId);
}

async function sweep(listingId: number) {
  const read = readOf({
    title: 'ZX100',
    identifiers: { sku: 'retailer-230', brand: 'Acme', mpn: 'ZX100', gtin: null, externalId: null },
  });
  await checkListing(
    depsOf(tmp, clock, async () => ({
      kind: 'read',
      read,
      methods: [],
      candidates: read.candidates,
    })),
    listingId,
    { force: true },
  );
}

describe('name-watch identity between discovery, the owner, and the sweep', () => {
  it.each(['retailer-230', null])(
    'an exact search result (search SKU %s) remains confirmed when its target is read',
    async (sku) => {
      candidate = { ...result, sku };
      const watchId = await create();
      const listing = listingOf(watchId);
      expect(listing.role).toBe('tracked');
      // Existing name watches have a null stored intent.
      tmp.db.orm.update(schema.watch).set({ spec: null }).where(eq(schema.watch.id, watchId)).run();
      await sweep(listing.listingId);
      expect(eventsOf(tmp.db)).toMatchObject([
        { kind: 'price_drop', watchId, listingId: listing.listingId },
      ]);
    },
  );

  it.each(['retailer-230', 'changed-sku', null])(
    'a wrong-match survives rediscovery of the same listing with SKU %s',
    async (sku) => {
      const watchId = await create();
      const listing = listingOf(watchId);
      const marked = await app.request(
        `/watches/${watchId}/listings/${listing.listingId}/wrong-match`,
        { method: 'POST' },
      );
      expect(marked.status).toBe(200);
      service.archive(PROFILE, watchId);
      candidate = { ...result, sku, brand: null, mpn: null, title: result.title };
      expect(listingOf(await create())).toMatchObject({
        listingId: listing.listingId,
        role: 'candidate',
      });
    },
  );

  it('rediscovery and evaluation use the identity fields from an interpreted watch', async () => {
    const watchId = await create();
    // Optional stored interpretation on an existing watch adds a must-have to the typed name.
    tmp.db.orm.run(
      sql`update watch set spec_json = ${JSON.stringify({
        name,
        brand: 'Acme',
        mustHave: [{ attribute: 'colour', value: 'White' }],
      })} where id = ${watchId}`,
    );
    candidate = { ...result, variant: { Colour: 'Black' } };
    await relookup(watchId);
    expect(listingOf(watchId).role).toBe('candidate');
    candidate = { ...result, variant: { Colour: 'White' } };
    await relookup(watchId);
    const listing = listingOf(watchId);
    expect(listing.role).toBe('tracked');
    await sweep(listing.listingId);
    expect(eventsOf(tmp.db)).toMatchObject([{ watchId }]);
  });

  it('a matching URL with no title or identifiers stays unconfirmed', async () => {
    candidate = { ...result, title: ' ', brand: null, mpn: null, sku: null };
    expect(listingOf(await create()).role).toBe('candidate');
  });

  it('changed identifier evidence updates the discovery-owned role in both directions', async () => {
    const watchId = await create();
    expect(listingOf(watchId).role).toBe('tracked');
    candidate = { ...result, brand: 'WidgetCo', mpn: 'QX200' };
    await relookup(watchId);
    expect(listingOf(watchId)).toMatchObject({ role: 'candidate', nextCheckAt: null });
    candidate = result;
    await relookup(watchId);
    expect(listingOf(watchId).role).toBe('tracked');
    await sweep(listingOf(watchId).listingId);
    expect(eventsOf(tmp.db)).toMatchObject([{ watchId }]);
  });
});
