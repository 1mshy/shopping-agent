// The ordinary name-watch route, discovery, and the next sweep share a real SQLite database.
// Only the store search and the read are scripted.
import { listingFingerprint } from '@agentic-dasher/core';
import { schema } from '@agentic-dasher/db';
import type { WatchView } from '@agentic-dasher/shared';
import { eq } from 'drizzle-orm';
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

async function create(input = name) {
  const response = await app.request('/watches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, targetPrice: { amountMinor: 12_000, currency: 'CAD' } }),
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

async function sweep(listingId: number, evidence: Parameters<typeof readOf>[0] = {}) {
  const read = readOf({
    title: 'ZX100',
    identifiers: { sku: 'retailer-230', brand: 'Acme', mpn: 'ZX100', gtin: null, externalId: null },
    ...evidence,
  });
  return checkListing(
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
      candidate = { ...result, sku, brand: null, mpn: null };
      expect(listingOf(await create())).toMatchObject({
        listingId: listing.listingId,
        role: 'candidate',
      });
    },
  );

  it('rediscovery and evaluation use the identity fields from an interpreted watch', async () => {
    const watchId = await create();
    // Optional stored interpretation on an existing watch adds a must-have to the typed name.
    tmp.db.orm
      .update(schema.watch)
      .set({
        spec: {
          name,
          kind: 'exact',
          brand: 'Acme',
          model: null,
          mpn: null,
          gtin: null,
          packQuantity: null,
          mustHave: [{ attribute: 'colour', value: 'White' }],
          substitutes: [],
          conditions: ['new'],
          fulfilment: ['delivery'],
          currency: 'CAD',
          location: { country: 'CA', postalCode: null },
          budget: null,
        },
      })
      .where(eq(schema.watch.id, watchId))
      .run();
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

  it('a person can restore a previously wrong match even when the identifiers change', async () => {
    const watchId = await create();
    const listingId = listingOf(watchId).listingId;
    service.setListingRole(PROFILE, watchId, listingId, 'wrong_match');
    // Simulate an existing installation with a person override keyed on the store and SKU.
    const legacy = listingFingerprint({
      store: result.storeHost,
      title: result.title,
      sku: result.sku,
      url: result.url,
      variant: {},
    });
    tmp.db.orm
      .update(schema.matchVerdict)
      .set({ listingFp: legacy })
      .where(eq(schema.matchVerdict.decidedBy, 'person'))
      .run();
    service.archive(PROFILE, watchId);
    candidate = { ...result, sku: 'new-sku' };
    const again = await create();
    expect(listingOf(again).role).toBe('candidate');
    service.setListingRole(PROFILE, again, listingId, 'track');
    candidate = { ...candidate, brand: 'Different', mpn: null };
    await relookup(again);
    expect(listingOf(again).role).toBe('tracked');
    await sweep(listingId);
    expect(eventsOf(tmp.db)).toMatchObject([{ watchId: again }]);
  });

  it('contradictory identifiers on the first direct read hold the target alert', async () => {
    candidate = { ...result, title: '' };
    const watchId = await create();
    const listing = listingOf(watchId);
    expect(listing.role).toBe('tracked');
    const checked = await sweep(listing.listingId, {
      title: 'NotBrand X999 replacement',
      identifiers: {
        sku: 'other-sku',
        brand: 'NotBrand',
        mpn: 'X999',
        gtin: null,
        externalId: null,
      },
    });
    expect(eventsOf(tmp.db)).toEqual([]);
    expect(checked.outcome).toMatchObject({
      kind: 'read',
      evaluations: [{ watchId, flags: ['unconfirmed'], price: { silence: 'unconfirmed_listing' } }],
    });
  });

  it('an interrupted check resumes with the direct identity evidence that accompanied its price', async () => {
    candidate = { ...result, title: '' };
    const watchId = await create();
    const { listingId } = listingOf(watchId);
    const different = readOf({
      title: 'NotBrand X999',
      identifiers: {
        sku: 'other-sku',
        brand: 'NotBrand',
        mpn: 'X999',
        gtin: null,
        externalId: null,
      },
    });
    const crashing = depsOf(
      tmp,
      clock,
      async () => ({
        kind: 'read',
        read: different,
        methods: [],
        candidates: different.candidates,
      }),
      [],
      {
        hooks: {
          afterObservationWritten: () => {
            throw new Error('interrupted');
          },
        },
      },
    );
    await expect(checkListing(crashing, listingId, { force: true })).rejects.toThrow('interrupted');
    tmp.db.close();
    tmp.db = TempDb.open(tmp.file);
    const resumed = await sweep(listingId);
    expect(resumed.resumed).toMatchObject([{ watchId, price: { silence: 'unconfirmed_listing' } }]);
    expect(eventsOf(tmp.db)).toMatchObject([{ watchId, observationId: 2 }]);
  });

  it('another watch finding a different display title leaves the first watch able to alert', async () => {
    const watchId = await create();
    const listing = listingOf(watchId);
    candidate = { ...result, title: 'ZX100 updated product display' };
    const cookware = await create('Acme cookware');
    expect(listingOf(cookware).listingId).toBe(listing.listingId);
    expect(listingOf(watchId).title).toBe(listing.title);
    await sweep(listing.listingId);
    expect(eventsOf(tmp.db)).toMatchObject([{ listingId: listing.listingId, watchId }]);
  });

  it('an identifier-only exact hit stays confirmed when its first read supplies a title', async () => {
    candidate = { ...result, title: '' };
    const watchId = await create();
    const listing = listingOf(watchId);
    expect(listing.role).toBe('tracked');
    await sweep(listing.listingId);
    expect(eventsOf(tmp.db)).toMatchObject([{ watchId }]);
    candidate = { ...result, brand: 'Other', mpn: 'QX200' };
    await relookup(watchId);
    expect(listingOf(watchId).role).toBe('candidate');
  });

  it.each([' ', result.url])(
    'a matching URL with placeholder title %s and no identifiers stays unconfirmed',
    async (title) => {
      candidate = { ...result, title, brand: null, mpn: null, sku: null };
      expect(listingOf(await create()).role).toBe('candidate');
    },
  );

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
