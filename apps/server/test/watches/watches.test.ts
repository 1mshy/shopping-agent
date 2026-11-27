// The watch service and its routes on a real temporary SQLite file, with an injected clock. No
// network anywhere: `discover` and `onListingsDue` are scripted and record what they saw.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Database,
  DEFAULT_PROFILE_ID,
  ensureDefaultProfile,
  migrate,
  openDatabase,
  schema,
} from '@agentic-dasher/db';
import type { WatchDetail, WatchView } from '@agentic-dasher/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Candidate,
  createWatchRoutes,
  createWatchService,
  type Discover,
  LOOKUP_MAX_ATTEMPTS,
  NO_DISCOVERY_SOURCE,
  type UserMarketSetting,
  WATCH_LOOKUP_JOB_NAME,
  type WatchService,
  watchLookupJob,
} from '../../src/watches/index.ts';

const T0 = Date.parse('2026-11-25T09:00:00.000Z');
const T0_ISO = '2026-11-25T09:00:00.000Z';
const CA: UserMarketSetting = { country: 'CA', currency: 'CAD', language: 'en' };

let dir: string;
let file: string;
let db: Database;
let clock: { ms: number };
let market: UserMarketSetting | null;
let due: { at: number; watches: number }[];
let discover: Discover | undefined;
let refreshes: number;
let service: WatchService;
let app: ReturnType<typeof createWatchRoutes>;

function open(path: string): Database {
  const d = openDatabase(path);
  migrate(d);
  ensureDefaultProfile(d);
  return d;
}

function build(): void {
  service = createWatchService({
    db,
    now: () => clock.ms,
    market: () => market,
    onListingsDue: () => {
      due.push({ at: clock.ms, watches: countWatchesCommitted() });
    },
    ...(discover ? { discover: (r) => (discover as Discover)(r) } : {}),
  });
  app = createWatchRoutes({
    db,
    watches: service,
    refresh: () => {
      refreshes++;
      return { runId: 7, joined: refreshes > 1 };
    },
  });
}

/** Read through a second connection: it sees only what is committed. */
function countWatchesCommitted(): number {
  const other = openDatabase(file);
  try {
    return other.orm.get<{ n: number }>(sql`select count(*) as n from watch`)?.n ?? 0;
  } finally {
    other.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dasher-watches-'));
  file = join(dir, 'agentic-dasher.db');
  db = open(file);
  clock = { ms: T0 };
  market = CA;
  due = [];
  discover = undefined;
  refreshes = 0;
  build();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function post(path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function patch(path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const LINK = 'https://shop.example.ca/products/printer?variant=blue';

async function createLink(input = LINK) {
  const r = await post('/watches', { input });
  return r.json.watch as WatchView;
}

describe('POST /watches by link (save first, S§2.9)', () => {
  it('writes exactly the watch, store, listing, link and due check', async () => {
    const r = await post('/watches', {
      input: 'shop.example.ca/products/printer?variant=blue&utm_source=mail',
    });
    expect(r.status).toBe(201);
    expect(r.json.created).toBe(true);
    const w = db.orm.select().from(schema.watch).all();
    expect(w).toEqual([
      {
        id: 1,
        profileId: DEFAULT_PROFILE_ID,
        kind: 'product',
        input: LINK,
        spec: null,
        market: 'CA',
        currency: null,
        rules: { targetPrice: null, dropBasisPoints: 500, restock: false },
        referencePrice: null,
        referenceKind: null,
        cooldownS: 43200,
        createdAt: T0_ISO,
        pausedAt: null,
        archivedAt: null,
        dedupeKey: `url:${LINK}`,
        restockEnabledAt: null,
        lookupState: 'done',
        lookupQueuedAt: T0_ISO,
        lookupDueAt: null,
        lookupAttempts: 1,
        lookupError: null,
      },
    ]);
    expect(db.orm.select().from(schema.store).all()).toEqual([
      {
        id: 1,
        host: 'shop.example.ca',
        marketPrefix: '',
        platform: 'unknown',
        platformEvidence: null,
        country: null,
        baseCurrency: 'unknown',
        markets: null,
        shipsTo: null,
        searchRoute: null,
        readRoute: null,
        identifiersOffered: null,
        isShop: 'unknown',
        trustTier: 'unverified',
        trustReasons: [],
        source: 'pasted',
        fingerprintedAt: null,
        fingerprint: null,
        consecutiveErrors: 0,
        lastOkAt: null,
        lastErrorAt: null,
        lastError: null,
      },
    ]);
    expect(db.orm.select().from(schema.listing).all()).toEqual([
      {
        id: 1,
        productId: null,
        storeId: 1,
        channel: 'retail',
        urlCanonical: LINK,
        externalId: null,
        sku: null,
        sellerId: null,
        sellerKind: 'first_party',
        condition: 'unknown',
        currency: 'unknown',
        title: LINK,
        variant: { variant: 'blue' },
        trackable: true,
        firstSeenAt: T0_ISO,
        lastSeenAt: T0_ISO,
        goneAt: null,
        consecutiveErrors: 0,
      },
    ]);
    expect(db.orm.select().from(schema.watchListing).all()).toEqual([
      { id: 1, profileId: 1, watchId: 1, listingId: 1, role: 'tracked', addedBy: 'user' },
    ]);
    expect(db.orm.select().from(schema.listingCheck).all()).toEqual([
      { listingId: 1, nextCheckAt: T0_ISO, lastReadAt: null, firstErrorAt: null, lastError: null },
    ]);
    // The sweep was told, after the watch was committed.
    expect(due).toEqual([{ at: T0, watches: 1 }]);
  });

  it('takes the Shopify market prefix from the path', async () => {
    await createLink('https://shop.example.com/en-ca/products/x');
    expect(db.orm.select({ p: schema.store.marketPrefix }).from(schema.store).get()?.p).toBe(
      '/en-ca',
    );
  });

  it('sets restock_enabled_at when the restock rule is on, with no default drop', async () => {
    const r = await post('/watches', { input: LINK, restock: true });
    const w = r.json.watch as WatchView;
    expect(w.rules).toEqual({ targetPrice: null, dropBasisPoints: null, restock: true });
    expect(w.restockEnabledAt).toBe(T0_ISO);
  });

  it('rewrites a pasted foreign storefront link to the user region before keying it', async () => {
    service = createWatchService({
      db,
      now: () => clock.ms,
      market: () => market,
      storefrontsFor: (host) =>
        host.endsWith('amazon.com') || host.endsWith('amazon.ca')
          ? {
              listingId: 'amazon_asin',
              storefronts: [
                { host: 'amazon.com', country: 'US', currency: 'USD' },
                { host: 'amazon.ca', country: 'CA', currency: 'CAD' },
              ],
            }
          : null,
    });
    const r = service.create(1, { input: 'https://www.amazon.com/Some-Slug/dp/B0ABCDEFGH?ref=x' });
    expect(r.watch.input).toBe('https://www.amazon.ca/dp/B0ABCDEFGH');
  });
});

describe('POST /watches by name', () => {
  it('saves a query watch and, with no discovery source, fails its lookup with that cause', async () => {
    const r = await post('/watches', { input: '  Bambu   Lab P1S ' });
    expect(r.status).toBe(201);
    const w = r.json.watch as WatchView;
    expect(w.kind).toBe('query');
    expect(w.input).toBe('Bambu Lab P1S');
    expect(w.currency).toBeNull();
    expect(w.lookup).toMatchObject({ state: 'failed', attempts: 1, error: NO_DISCOVERY_SOURCE });
    expect(due).toEqual([]);
  });

  it('asks discover only once the watch row is committed (save first)', async () => {
    const seen: number[] = [];
    discover = async () => {
      seen.push(countWatchesCommitted());
      return [] as Candidate[];
    };
    build();
    await post('/watches', { input: 'Bambu Lab P1S' });
    expect(seen).toEqual([1]);
  });

  it('retries a failed discovery with a growing delay, then ends failed', async () => {
    discover = async () => {
      throw new Error('directory unreachable');
    };
    build();
    const created = (await post('/watches', { input: 'X1 Carbon' })).json.watch as WatchView;
    let w = service.get(1, created.id).watch;
    expect(w.lookup).toMatchObject({
      state: 'queued',
      attempts: 1,
      error: 'directory unreachable',
    });
    expect(w.lookup?.dueAt).toBe('2026-11-25T09:01:00.000Z');
    // Not due yet: nothing happens.
    expect(await service.runDueLookups(new AbortController().signal)).toEqual({
      attempted: 0,
      done: 0,
    });
    clock.ms += 60_000;
    await service.runDueLookups(new AbortController().signal);
    w = service.get(1, created.id).watch;
    expect(w.lookup).toMatchObject({ state: 'queued', attempts: 2 });
    expect(w.lookup?.dueAt).toBe('2026-11-25T09:06:00.000Z');
    for (let i = 2; i < LOOKUP_MAX_ATTEMPTS; i++) {
      clock.ms += 7 * 3_600_000;
      await service.runDueLookups(new AbortController().signal);
    }
    w = service.get(1, created.id).watch;
    expect(w.lookup).toMatchObject({
      state: 'failed',
      attempts: LOOKUP_MAX_ATTEMPTS,
      dueAt: null,
      error: 'directory unreachable',
    });
  });
});

describe('duplicates', () => {
  it('returns the active watch, keeping its settings', async () => {
    const first = await createLink();
    const again = await post('/watches', { input: `${LINK}#reviews`, dropBasisPoints: 2000 });
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    const w = again.json.watch as WatchView;
    expect(w.id).toBe(first.id);
    expect(w.rules.dropBasisPoints).toBe(500);
    expect(db.orm.select().from(schema.watch).all()).toHaveLength(1);
  });

  it('reports a paused duplicate as paused', async () => {
    const first = await createLink();
    await patch(`/watches/${first.id}`, { paused: true });
    const again = await post('/watches', { input: LINK });
    expect((again.json.watch as WatchView).status).toBe('paused');
  });

  it('frees the key once archived: the same link is a new watch on the same listing', async () => {
    const first = await createLink();
    expect((await app.request(`/watches/${first.id}`, { method: 'DELETE' })).status).toBe(200);
    const again = await post('/watches', { input: LINK });
    expect(again.status).toBe(201);
    expect((again.json.watch as WatchView).id).not.toBe(first.id);
    expect(db.orm.select().from(schema.listing).all()).toHaveLength(1);
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBe(T0_ISO);
  });

  it('two watches on one link (two profiles) share one listing and one check', () => {
    db.orm.run(sql`insert into profile (id) values (2)`);
    const a = service.create(1, { input: LINK });
    const b = service.create(2, { input: LINK });
    return Promise.all([service.runLookup(a.watch.id), service.runLookup(b.watch.id)]).then(() => {
      expect(db.orm.select().from(schema.listing).all()).toHaveLength(1);
      expect(db.orm.select().from(schema.listingCheck).all()).toHaveLength(1);
      expect(db.orm.select().from(schema.watchListing).all()).toHaveLength(2);
    });
  });

  it('leaves an earlier next check alone when the listing is already scheduled', async () => {
    db.orm.run(sql`insert into profile (id) values (2)`);
    await createLink();
    db.orm.update(schema.listingCheck).set({ nextCheckAt: '2026-11-25T08:55:00.000Z' }).run();
    clock.ms += 60_000;
    const b = service.create(2, { input: LINK });
    await service.runLookup(b.watch.id);
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBe(
      '2026-11-25T08:55:00.000Z',
    );
  });
});

describe('refusals', () => {
  it.each([
    [{ input: ' ' }, 400, 'not_one_link_or_name'],
    [{ input: 'a\nb' }, 400, 'not_one_link_or_name'],
    [{ input: 'ftp://shop.example/x' }, 400, 'not_an_http_link'],
    [{ input: 'https://u:p@shop.example/x' }, 400, 'not_an_http_link'],
    [{ input: 'X1', dropBasisPoints: 0 }, 400, 'drop_out_of_range'],
    [
      { input: 'X1', targetPrice: { amountMinor: -1, currency: 'CAD' } },
      400,
      'target_not_positive',
    ],
    [{ input: 'X1', cooldownSeconds: 60 }, 400, 'cooldown_too_short'],
    [{ input: 'X1', profileId: 2 }, 400, 'invalid'],
    [{ input: 'X1', targetPrice: { amountMinor: 1.5, currency: 'CAD' } }, 400, 'invalid'],
    [{ input: 'X1', targetPrice: { amountMinor: 100, currency: 'unknown' } }, 400, 'invalid'],
  ])('%j answers %i %s', async (body, status, code) => {
    const r = await post('/watches', body);
    expect(r.status).toBe(status);
    expect((r.json.error as { code: string }).code).toBe(code);
    expect(db.orm.select().from(schema.watch).all()).toEqual([]);
  });

  it('refuses a body that is not JSON', async () => {
    const r = await post('/watches', '{not json');
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: { code: 'invalid' } });
  });

  it('refuses a watch while the market is not set (409)', async () => {
    market = null;
    const r = await post('/watches', { input: LINK });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: { code: 'market_not_set' } });
  });

  it('answers 404 for a watch or listing that does not exist', async () => {
    expect((await get('/watches/99')).status).toBe(404);
    expect((await get('/watches/abc')).status).toBe(404);
    expect((await patch('/watches/99', { paused: true })).status).toBe(404);
    expect((await get('/listings/99/history')).status).toBe(404);
  });
});

describe('PATCH /watches/:id', () => {
  it('changes rules; restock on sets and off clears restock_enabled_at', async () => {
    const w = await createLink();
    clock.ms += 1000;
    let r = await patch(`/watches/${w.id}`, { restock: true, dropBasisPoints: 1000 });
    expect(r.status).toBe(200);
    let v = r.json.watch as WatchView;
    expect(v.rules).toEqual({ targetPrice: null, dropBasisPoints: 1000, restock: true });
    expect(v.restockEnabledAt).toBe('2026-11-25T09:00:01.000Z');
    r = await patch(`/watches/${w.id}`, { restock: false, cooldownSeconds: 7200 });
    v = r.json.watch as WatchView;
    expect(v.restockEnabledAt).toBeNull();
    expect(v.cooldownSeconds).toBe(7200);
    // Every rule off: the intake default applies again.
    r = await patch(`/watches/${w.id}`, { dropBasisPoints: null });
    expect((r.json.watch as WatchView).rules.dropBasisPoints).toBe(500);
    r = await patch(`/watches/${w.id}`, { dropBasisPoints: 10000 });
    expect(r.status).toBe(400);
  });

  it('refuses a target or reference in another currency than the adopted one', async () => {
    const w = await createLink();
    let r = await patch(`/watches/${w.id}`, {
      referencePrice: { amountMinor: 100, currency: 'CAD' },
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: { code: 'no_currency_yet' } });
    db.orm.update(schema.watch).set({ currency: 'CAD' }).run();
    r = await patch(`/watches/${w.id}`, { targetPrice: { amountMinor: 9000, currency: 'USD' } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ error: { code: 'currency_mismatch' } });
    r = await patch(`/watches/${w.id}`, {
      referencePrice: { amountMinor: 45000, currency: 'CAD' },
    });
    expect((r.json.watch as WatchView).reference).toEqual({
      price: { amountMinor: 45000, currency: 'CAD' },
      kind: 'user_confirmed',
    });
    r = await patch(`/watches/${w.id}`, { referencePrice: null });
    expect((r.json.watch as WatchView).reference).toBeNull();
  });

  it('flags a target saved before the currency was adopted that differs from it', async () => {
    const r = await post('/watches', {
      input: LINK,
      targetPrice: { amountMinor: 9000, currency: 'USD' },
    });
    const w = r.json.watch as WatchView;
    expect(w.targetCurrencyMismatch).toBe(false);
    db.orm.update(schema.watch).set({ currency: 'CAD' }).run();
    expect(service.get(1, w.id).watch.targetCurrencyMismatch).toBe(true);
  });

  it('pause stops the listing being due; resume makes it due now; archive stops it', async () => {
    const w = await createLink();
    await patch(`/watches/${w.id}`, { paused: true });
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBeNull();
    clock.ms += 3_600_000;
    const r = await patch(`/watches/${w.id}`, { paused: false });
    expect((r.json.watch as WatchView).status).toBe('active');
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBe(
      '2026-11-25T10:00:00.000Z',
    );
    const del = await app.request(`/watches/${w.id}`, { method: 'DELETE' });
    expect(((await del.json()) as { watch: WatchView }).watch.status).toBe('archived');
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBeNull();
    expect((await patch(`/watches/${w.id}`, { paused: true })).status).toBe(409);
    expect(((await get('/watches')).json.watches as unknown[]).length).toBe(0);
    expect(((await get('/watches?includeArchived=1')).json.watches as unknown[]).length).toBe(1);
  });

  it('archiving one of two followers keeps the listing due', async () => {
    db.orm.run(sql`insert into profile (id) values (2)`);
    const a = await createLink();
    const b = service.create(2, { input: LINK });
    await service.runLookup(b.watch.id);
    service.archive(1, a.id);
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBe(T0_ISO);
  });
});

function observe(
  id: number,
  at: string,
  o: { sticker: number | null; effective?: number | null; availability?: 'in' | 'out' },
): void {
  db.orm
    .insert(schema.priceObservation)
    .values({
      id,
      listingId: 1,
      observedAt: at,
      currency: 'CAD',
      sticker: o.sticker,
      referenceClaimed: null,
      coupon: null,
      memberPrice: null,
      shipping: null,
      shippingStatus: 'unknown',
      tax: null,
      taxIncluded: null,
      dutyEstimate: null,
      unitPrice: null,
      unit: null,
      effective: o.effective ?? o.sticker,
      landed: null,
      missingComponents: o.sticker === null ? ['sticker', 'shipping', 'tax'] : ['shipping', 'tax'],
      availability: o.availability ?? 'in',
      readPath: 'json_ld',
      rung: 'http',
      rawCandidates: o.sticker === null ? [] : [{ method: 'json_ld', confidence: 0.9, value: '1' }],
    })
    .run();
}

describe('read views', () => {
  it('a never-read listing shows no price; a read one is current, then stale after a failure', async () => {
    const w = await createLink();
    let d = (await get(`/watches/${w.id}`)).json as unknown as WatchDetail;
    expect(d.listings).toHaveLength(1);
    expect(d.listings[0]).toMatchObject({
      role: 'tracked',
      addedBy: 'user',
      storeHost: 'shop.example.ca',
      trustTier: 'unverified',
      condition: 'unknown',
      conditionUnknown: true,
      price: null,
      freshness: 'none',
      availability: 'unknown',
      nextCheckAt: T0_ISO,
    });
    observe(1, '2026-11-25T09:30:00.000Z', { sticker: 44999, effective: 39999 });
    db.orm
      .update(schema.listingCheck)
      .set({ lastReadAt: '2026-11-25T09:30:00.000Z', nextCheckAt: '2026-11-25T10:00:00.000Z' })
      .run();
    d = (await get(`/watches/${w.id}`)).json as unknown as WatchDetail;
    expect(d.listings[0]).toMatchObject({
      price: {
        effective: { amountMinor: 39999, currency: 'CAD' },
        sticker: { amountMinor: 44999, currency: 'CAD' },
        observedAt: '2026-11-25T09:30:00.000Z',
      },
      freshness: 'current',
      availability: 'in',
    });
    db.orm
      .update(schema.listingCheck)
      .set({
        lastReadAt: '2026-11-25T10:00:00.000Z',
        firstErrorAt: '2026-11-25T10:00:00.000Z',
        lastError: 'wall',
      })
      .run();
    db.orm.update(schema.listing).set({ consecutiveErrors: 1 }).run();
    d = (await get(`/watches/${w.id}`)).json as unknown as WatchDetail;
    expect(d.listings[0]).toMatchObject({
      freshness: 'stale',
      lastError: 'wall',
      consecutiveErrors: 1,
      price: { effective: { amountMinor: 39999, currency: 'CAD' } },
    });
  });

  it('shows the last alert of each kind with its delivery status', async () => {
    const w = await createLink();
    observe(1, '2026-11-25T09:30:00.000Z', { sticker: 40000 });
    db.orm
      .insert(schema.channel)
      .values([
        {
          id: 1,
          profileId: 1,
          type: 'in_app',
          config: {},
          secretEnc: null,
          name: 'App',
          createdAt: T0_ISO,
          disabledAt: null,
          removedAt: null,
        },
        {
          id: 2,
          profileId: 1,
          type: 'ntfy',
          config: {},
          secretEnc: null,
          name: 'Phone',
          createdAt: T0_ISO,
          disabledAt: null,
          removedAt: null,
        },
      ])
      .run();
    db.orm
      .insert(schema.notificationEvent)
      .values({
        id: 1,
        profileId: 1,
        key: 'price_drop:1:1',
        kind: 'price_drop',
        createdAt: '2026-11-25T09:31:00.000Z',
        watchId: w.id,
        listingId: 1,
        observationId: 1,
        feedCardId: null,
        runId: null,
        text: null,
      })
      .run();
    const delivery = (id: number, channelId: number, accepted: boolean) => ({
      id,
      profileId: 1,
      eventId: 1,
      channelId,
      state: accepted ? ('accepted' as const) : ('pending' as const),
      attempts: accepted ? 1 : 0,
      outcome: accepted ? ('accepted' as const) : null,
      nextAttemptAt: accepted ? null : '2026-11-25T09:32:00.000Z',
      acceptedAt: accepted ? '2026-11-25T09:31:01.000Z' : null,
    });
    db.orm
      .insert(schema.delivery)
      .values([delivery(1, 1, true), delivery(2, 2, false)])
      .run();
    let v = service.get(1, w.id).watch;
    expect(v.lastAlerts.price_drop).toEqual({
      eventId: 1,
      createdAt: '2026-11-25T09:31:00.000Z',
      delivery: 'awaiting_delivery',
      acceptedAt: null,
      price: { amountMinor: 40000, currency: 'CAD' },
    });
    expect(v.lastAlerts.restock).toBeNull();
    db.orm
      .update(schema.delivery)
      .set({ state: 'failed', attempts: 1, outcome: 'failed', nextAttemptAt: null })
      .where(eq(schema.delivery.id, 2))
      .run();
    v = service.get(1, w.id).watch;
    expect(v.lastAlerts.price_drop?.delivery).toBe('undelivered');
    db.orm
      .update(schema.delivery)
      .set({ state: 'accepted', outcome: 'accepted', acceptedAt: '2026-11-25T09:40:00.000Z' })
      .where(eq(schema.delivery.id, 2))
      .run();
    v = service.get(1, w.id).watch;
    expect(v.lastAlerts.price_drop).toMatchObject({
      delivery: 'accepted',
      acceptedAt: '2026-11-25T09:40:00.000Z',
    });

    // The in-app feed shows the alert's message and the in-app delivery's state.
    const feed = (await get('/notifications')).json;
    expect(feed).toMatchObject({
      next: null,
      items: [
        {
          eventId: 1,
          kind: 'price_drop',
          watchId: w.id,
          listingId: 1,
          inApp: 'accepted',
          url: LINK,
        },
      ],
    });
    const item = (feed.items as { body: string }[])[0];
    expect(item?.body).toContain('400.00 CAD');
    expect((await get('/notifications?limit=0')).status).toBe(400);
  });

  it('pages the feed newest first', async () => {
    for (let i = 1; i <= 3; i++) {
      db.orm
        .insert(schema.notificationEvent)
        .values({
          id: i,
          profileId: 1,
          key: `system:${i}`,
          kind: 'system',
          createdAt: T0_ISO,
          watchId: null,
          listingId: null,
          observationId: null,
          feedCardId: null,
          runId: null,
          text: `notice ${i}`,
        })
        .run();
    }
    const first = (await get('/notifications?limit=2')).json;
    expect((first.items as { eventId: number }[]).map((i) => i.eventId)).toEqual([3, 2]);
    expect(first.next).toBe(2);
    const second = (await get('/notifications?limit=2&before=2')).json;
    expect((second.items as { eventId: number; inApp: null }[]).map((i) => i.eventId)).toEqual([1]);
    expect(second.next).toBeNull();
  });

  it('gives a listing history oldest first', async () => {
    await createLink();
    observe(2, '2026-11-25T10:00:00.000Z', { sticker: null, availability: 'out' });
    observe(1, '2026-11-25T09:30:00.000Z', { sticker: 44999 });
    const h = (await get('/listings/1/history')).json;
    expect(h).toEqual({
      listingId: 1,
      points: [
        {
          observationId: 1,
          observedAt: '2026-11-25T09:30:00.000Z',
          currency: 'CAD',
          effective: 44999,
          sticker: 44999,
          availability: 'in',
        },
        {
          observationId: 2,
          observedAt: '2026-11-25T10:00:00.000Z',
          currency: 'CAD',
          effective: null,
          sticker: null,
          availability: 'out',
        },
      ],
    });
  });
});

describe('POST /refresh and the job', () => {
  it('answers 202 each time with what the trigger gave', async () => {
    const a = await post('/refresh', {});
    const b = await post('/refresh', {});
    expect(a).toEqual({ status: 202, json: { runId: 7, joined: false } });
    expect(b).toEqual({ status: 202, json: { runId: 7, joined: true } });
    expect(refreshes).toBe(2);
  });

  it('defines watch-lookup and runs due lookups', async () => {
    const created = service.create(1, { input: LINK });
    const job = watchLookupJob({ watches: service });
    expect(job).toMatchObject({
      name: WATCH_LOOKUP_JOB_NAME,
      cron: '* * * * *',
      networkGate: true,
    });
    const detail = await job.handler({
      signal: new AbortController().signal,
      runId: 1,
      reason: 'slot',
      coalescedSlots: 1,
      startedAt: T0_ISO,
      report: () => {},
    });
    expect(detail).toEqual({ attempted: 1, done: 1 });
    expect(service.get(1, created.watch.id).watch.lookup?.state).toBe('done');
  });

  it('a paused watch keeps its lookup queued until resumed', async () => {
    const created = service.create(1, { input: LINK });
    service.update(1, created.watch.id, { paused: true });
    expect(await service.runDueLookups(new AbortController().signal)).toEqual({
      attempted: 0,
      done: 0,
    });
    expect(db.orm.select().from(schema.listing).all()).toEqual([]);
  });
});

describe('a query watch with scripted candidates', () => {
  const cand = (url: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({
    url,
    storeHost: URL.parse(url)?.hostname ?? '',
    marketPrefix: '',
    title,
    gtin: null,
    mpn: null,
    sku: null,
    brand: null,
    variant: {},
    ...extra,
  });
  const SCRIPT: Candidate[] = [
    cand('https://a.example/products/p1s', 'Bambu Lab P1S'),
    cand('https://a.example/products/p1s-nozzle', 'Bambu Lab P1S Hardened Steel Nozzle Kit'),
    cand('https://b.example/products/x1c', 'Bambu Lab X1 Carbon'),
  ];

  function linksOf(watchId: number) {
    return db.orm
      .select({ listingId: schema.watchListing.listingId, role: schema.watchListing.role })
      .from(schema.watchListing)
      .where(eq(schema.watchListing.watchId, watchId))
      .orderBy(schema.watchListing.listingId)
      .all();
  }

  it('tracks only what the rules call exact; the rest are candidates; verdicts are cached', async () => {
    discover = async () => SCRIPT;
    build();
    const w = (await post('/watches', { input: 'Bambu Lab P1S' })).json.watch as WatchView;
    expect(w.lookup).toMatchObject({ state: 'done', attempts: 1, error: null });
    expect(linksOf(w.id)).toEqual([
      { listingId: 1, role: 'tracked' },
      { listingId: 2, role: 'candidate' },
      { listingId: 3, role: 'candidate' },
    ]);
    const added = db.orm.select({ a: schema.watchListing.addedBy }).from(schema.watchListing).all();
    expect(added.every((r) => r.a === 'discovery')).toBe(true);
    // Only the tracked listing is due.
    expect(
      db.orm
        .select()
        .from(schema.listingCheck)
        .all()
        .map((c) => [c.listingId, c.nextCheckAt]),
    ).toEqual([[1, T0_ISO]]);
    const verdicts = db.orm.select().from(schema.matchVerdict).all();
    expect(verdicts).toHaveLength(3);
    expect(verdicts.filter((v) => v.relation === 'exact')).toHaveLength(1);
    expect(verdicts.every((v) => v.decidedBy === 'rules' || v.decidedBy === 'identifier')).toBe(
      true,
    );
    expect(due).toHaveLength(1);
  });

  it('caps the links: at most 2 per host and 25 hosts', async () => {
    const many: Candidate[] = [
      cand('https://a.example/p/1', 'Thing'),
      cand('https://a.example/p/2', 'Thing'),
      cand('https://a.example/p/3', 'Thing'),
      ...Array.from({ length: 30 }, (_, i) => cand(`https://h${i}.example/p`, 'Thing')),
      cand('javascript:alert(1)', 'Thing'),
    ];
    discover = async () => many;
    build();
    const w = (await post('/watches', { input: 'Thing' })).json.watch as WatchView;
    expect(linksOf(w.id)).toHaveLength(2 + 24);
    expect(db.orm.select({ h: schema.store.host }).from(schema.store).all()).toHaveLength(25);
  });

  it('wrong match excludes, writes a person verdict that wins, and appends an event', async () => {
    discover = async () => SCRIPT;
    build();
    const w = (await post('/watches', { input: 'Bambu Lab P1S' })).json.watch as WatchView;
    const r = await post(`/watches/${w.id}/listings/1/wrong-match`, {});
    expect(r.status).toBe(200);
    expect(r.json.listing).toMatchObject({ listingId: 1, role: 'excluded', addedBy: 'user' });
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBeNull();
    const person = db.orm
      .select()
      .from(schema.matchVerdict)
      .where(eq(schema.matchVerdict.decidedBy, 'person'))
      .all();
    expect(person).toHaveLength(1);
    expect(db.orm.select().from(schema.event).all()).toEqual([
      { id: 1, profileId: 1, kind: 'wrong_match', createdAt: T0_ISO },
    ]);
    // Another watch for the same name does not track it: the person's verdict wins.
    db.orm.run(sql`insert into profile (id) values (2)`);
    const other = service.create(2, { input: 'Bambu Lab P1S' });
    await service.runLookup(other.watch.id);
    expect(linksOf(other.watch.id)[0]).toEqual({ listingId: 1, role: 'candidate' });
    // Rediscovery for the first watch keeps the person's exclusion.
    db.orm
      .update(schema.watch)
      .set({ lookupState: 'queued', lookupDueAt: T0_ISO })
      .where(eq(schema.watch.id, w.id))
      .run();
    await service.runLookup(w.id);
    expect(linksOf(w.id)[0]).toEqual({ listingId: 1, role: 'excluded' });
  });

  it('exclude and track move the listing in and out of the sweep', async () => {
    const w = await createLink();
    let r = await post(`/watches/${w.id}/listings/1/exclude`, {});
    expect(r.json.listing).toMatchObject({ role: 'excluded' });
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBeNull();
    clock.ms += 60_000;
    r = await post(`/watches/${w.id}/listings/1/track`, {});
    expect(r.json.listing).toMatchObject({ role: 'tracked', addedBy: 'user' });
    expect(db.orm.select().from(schema.listingCheck).get()?.nextCheckAt).toBe(
      '2026-11-25T09:01:00.000Z',
    );
    expect((await post(`/watches/${w.id}/listings/99/track`, {})).status).toBe(404);
    expect((await post(`/watches/${w.id}/listings/1/delete`, {})).status).toBe(404);
  });
});

describe('listing view, deal verdict and diagnostics', () => {
  it('gives the listing with its deal verdict at now, and why tiers were not judged', async () => {
    app = createWatchRoutes({
      db,
      watches: service,
      refresh: () => ({ runId: 1, joined: false }),
      now: () => clock.ms,
      marketCountry: () => 'CA',
    });
    await createLink();
    let r = await get('/listings/1');
    expect(r.json).toMatchObject({ verdict: null, verdictRefusal: null });
    observe(1, '2026-11-25T09:30:00.000Z', { sticker: 44999 });
    db.orm.update(schema.listingCheck).set({ lastReadAt: '2026-11-25T09:30:00.000Z' }).run();
    clock.ms = Date.parse('2026-11-25T09:40:00.000Z');
    r = await get('/listings/1');
    expect(r.status).toBe(200);
    const body = r.json as {
      listing: { conditionUnknown: boolean };
      verdict: { listingId: number; unjudged: unknown[] } | null;
      verdictRefusal: unknown;
    };
    expect(body.listing.conditionUnknown).toBe(true);
    expect(body.verdictRefusal).toBeNull();
    expect(body.verdict?.listingId).toBe(1);
    expect(body.verdict?.unjudged.length).toBeGreaterThan(0);
    expect((await get('/listings/99')).status).toBe(404);
  });

  it('shows the scheduler health, recent job runs and the fetch playbook', async () => {
    app = createWatchRoutes({
      db,
      watches: service,
      refresh: () => ({ runId: 1, joined: false }),
      jobs: () => [],
    });
    db.orm
      .insert(schema.job)
      .values({
        id: 1,
        name: 'sweep',
        cron: '*/5 * * * *',
        nextRunAt: T0_ISO,
        deadlineMs: 60000,
        networkGate: true,
        retryAt: null,
      })
      .run();
    db.orm
      .insert(schema.jobRun)
      .values({
        id: 1,
        jobId: 1,
        status: 'completed',
        startedAt: T0_ISO,
        endedAt: T0_ISO,
        reason: 'slot',
        coalescedSlots: 1,
        detail: { listingsRead: 3 },
      })
      .run();
    db.orm
      .insert(schema.hostAccess)
      .values({
        id: 1,
        host: 'shop.example.ca',
        pageKind: 'product',
        rung: 'http',
        lastOutcome: 'wall',
        wallVendor: 'cloudflare',
        expiresAt: null,
        backoffUntil: T0_ISO,
        attempts: 2,
      })
      .run();
    expect((await get('/diagnostics/jobs')).json).toEqual({
      jobs: [],
      runs: [
        {
          id: 1,
          job: 'sweep',
          status: 'completed',
          reason: 'slot',
          startedAt: T0_ISO,
          endedAt: T0_ISO,
          coalescedSlots: 1,
          detail: { listingsRead: 3 },
        },
      ],
    });
    expect((await get('/diagnostics/fetch')).json).toMatchObject({
      rungs: ['api', 'http'],
      hosts: [{ host: 'shop.example.ca', lastOutcome: 'wall', attempts: 2 }],
    });
  });
});
