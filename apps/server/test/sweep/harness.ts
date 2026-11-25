// Shared by the sweep tests: a real temporary SQLite file, the rows the watches unit would have
// written (store, listing, listing_check, watch, watch_listing), an injected clock, and scripted
// reads in place of the ladder. No network: the fetcher refuses every call.
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
import type { Fetcher } from '@agentic-dasher/fetch';
import type { FetchOutcome } from '@agentic-dasher/shared';
import type { ListingRead, ListingReadResult, Market } from '@agentic-dasher/sources';
import { eq } from 'drizzle-orm';
import type { ReadListingFn, SweepDeps } from '../../src/sweep/index.ts';
import type { SweepLogRecord } from '../../src/sweep/log.ts';

export const PROFILE = DEFAULT_PROFILE_ID;
export const T0 = Date.parse('2026-11-20T09:00:00.000Z');
export const MIN = 60_000;
export const CA: Market = { country: 'CA', currency: 'CAD', language: 'en' };

export class TempDb {
  readonly dir = mkdtempSync(join(tmpdir(), 'dasher-sweep-'));
  readonly file = join(this.dir, 'agentic-dasher.db');
  db: Database;
  constructor() {
    this.db = TempDb.open(this.file);
  }
  static open(file: string): Database {
    const db = openDatabase(file);
    migrate(db);
    ensureDefaultProfile(db);
    return db;
  }
  dispose(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export class Clock {
  ms = T0;
  now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
  iso(): string {
    return new Date(this.ms).toISOString();
  }
}

/** A fetcher that must never be reached: the scripted reads do not call it. */
export const noNetwork: Fetcher = {
  get: async () => {
    throw new Error('the network is not reachable in these tests');
  },
};

let hostSeq = 0;

export function insertStore(
  db: Database,
  options: {
    host?: string;
    trustTier?: 'known' | 'caution' | 'blocked';
    platform?: 'shopify' | 'unknown';
  } = {},
): number {
  hostSeq += 1;
  return db.orm
    .insert(schema.store)
    .values({
      host: options.host ?? `shop${hostSeq}.example.ca`,
      marketPrefix: '',
      platform: options.platform ?? 'shopify',
      platformEvidence: null,
      country: 'CA',
      baseCurrency: 'CAD',
      markets: null,
      shipsTo: null,
      searchRoute: null,
      readRoute: null,
      identifiersOffered: null,
      isShop: 'yes',
      trustTier: options.trustTier ?? 'known',
      trustReasons: [],
      source: 'pasted',
      fingerprintedAt: null,
      consecutiveErrors: 0,
      lastOkAt: null,
      lastErrorAt: null,
      lastError: null,
    })
    .returning()
    .get().id;
}

export function insertListing(
  db: Database,
  clock: Clock,
  options: {
    storeId: number;
    url?: string;
    currency?: 'CAD' | 'USD' | 'unknown';
    condition?: 'new' | 'unknown';
  },
): number {
  const at = clock.iso();
  const id = db.orm
    .insert(schema.listing)
    .values({
      productId: null,
      storeId: options.storeId,
      channel: 'retail',
      urlCanonical: options.url ?? `https://store${options.storeId}.example.ca/products/widget`,
      externalId: null,
      sku: null,
      sellerId: null,
      sellerKind: 'first_party',
      condition: options.condition ?? 'new',
      currency: options.currency ?? 'unknown',
      title: 'Widget',
      variant: {},
      trackable: true,
      firstSeenAt: at,
      lastSeenAt: at,
      goneAt: null,
      consecutiveErrors: 0,
    })
    .returning()
    .get().id;
  db.orm
    .insert(schema.listingCheck)
    .values({
      listingId: id,
      nextCheckAt: at,
      lastReadAt: null,
      firstErrorAt: null,
      lastError: null,
    })
    .run();
  return id;
}

let watchSeq = 0;

export function insertWatch(
  db: Database,
  clock: Clock,
  options: {
    rules?: Record<string, unknown>;
    restock?: boolean;
    paused?: boolean;
    archived?: boolean;
    cooldownS?: number;
  } = {},
): number {
  watchSeq += 1;
  const at = clock.iso();
  return db.orm
    .insert(schema.watch)
    .values({
      profileId: PROFILE,
      kind: 'product',
      input: `https://example.ca/w/${watchSeq}`,
      spec: null,
      market: 'CA',
      currency: null,
      rules: options.rules ?? {},
      referencePrice: null,
      referenceKind: null,
      cooldownS: options.cooldownS ?? 43_200,
      createdAt: at,
      pausedAt: options.paused ? at : null,
      archivedAt: options.archived ? at : null,
      dedupeKey: `url:https://example.ca/w/${watchSeq}`,
      restockEnabledAt: options.restock ? at : null,
      lookupState: 'done',
      lookupQueuedAt: at,
      lookupDueAt: null,
      lookupAttempts: 1,
      lookupError: null,
    })
    .returning()
    .get().id;
}

export function follow(
  db: Database,
  watchId: number,
  listingId: number,
  addedBy: 'user' | 'discovery' = 'user',
): void {
  db.orm
    .insert(schema.watchListing)
    .values({ profileId: PROFILE, watchId, listingId, role: 'tracked', addedBy })
    .run();
}

export function readOf(overrides: Partial<ListingRead> = {}): ListingRead {
  const sticker = overrides.sticker === undefined ? 10_000 : overrides.sticker;
  return {
    method: 'platform_json',
    rung: 'api',
    title: 'Widget',
    identifiers: { brand: null, gtin: null, mpn: null, sku: null, externalId: null },
    variant: {},
    condition: 'new',
    currency: 'CAD',
    sticker,
    referenceClaimed: null,
    coupon: null,
    memberPrice: null,
    shipping: null,
    shippingStatus: 'unknown',
    taxIncluded: null,
    unitPrice: null,
    unit: null,
    availability: 'in',
    candidates:
      sticker === null
        ? []
        : [
            {
              method: overrides.method ?? 'platform_json',
              confidence: 0.9,
              value: (sticker / 100).toFixed(2),
            },
          ],
    ...overrides,
  };
}

export type Scripted =
  | {
      readonly price: number | null;
      readonly availability?: 'in' | 'out';
      readonly path?: 'json_ld';
    }
  | { readonly fail: FetchOutcome['kind'] | 'no_price' };

export function resultOf(step: Scripted): ListingReadResult {
  if ('fail' in step) {
    if (step.fail === 'no_price') {
      return {
        kind: 'failed',
        reason: 'no_price',
        detail: 'scripted',
        fetch: null,
        methods: [],
        candidates: [{ method: 'json_ld', confidence: 0.2, value: 'call for price' }],
      };
    }
    const fetch =
      step.fail === 'network_error'
        ? ({ kind: 'network_error', rung: 'http', code: 'ECONNRESET' } as const)
        : step.fail === 'rate_limited'
          ? ({ kind: 'rate_limited', rung: 'http', retryAfterMs: null } as const)
          : step.fail === 'refused_by_policy'
            ? ({ kind: 'refused_by_policy', rung: 'http', reason: 'robots' } as const)
            : step.fail === 'wall'
              ? ({ kind: 'wall', rung: 'http', vendor: null, mode: 'access_denied' } as const)
              : ({ kind: step.fail, rung: 'http' } as FetchOutcome);
    return {
      kind: 'failed',
      reason: 'fetch_failed',
      detail: 'scripted',
      fetch,
      methods: [],
      candidates: [],
    };
  }
  const read = readOf({
    sticker: step.price,
    availability: step.availability ?? 'in',
    ...(step.path === 'json_ld' ? { method: 'json_ld', rung: 'http' } : {}),
  });
  return { kind: 'read', read, methods: [], candidates: read.candidates };
}

/** Scripted reads by URL: each call takes the next step of that URL's script. */
export class Script {
  readonly steps = new Map<string, Scripted[]>();
  readonly calls: string[] = [];
  push(url: string, ...steps: Scripted[]): this {
    this.steps.set(url, [...(this.steps.get(url) ?? []), ...steps]);
    return this;
  }
  readonly read: ReadListingFn = async (request) => {
    this.calls.push(request.url);
    const step = this.steps.get(request.url)?.shift();
    if (step === undefined) throw new Error(`no scripted read left for ${request.url}`);
    return resultOf(step);
  };
}

export function depsOf(
  tmp: TempDb,
  clock: Clock,
  read: ReadListingFn,
  logs: SweepLogRecord[] = [],
  extra: Partial<SweepDeps> = {},
): SweepDeps {
  return {
    db: tmp.db,
    fetcher: noNetwork,
    now: clock.now,
    market: () => CA,
    readListing: read,
    endpointReaders: [],
    logger: (r) => logs.push(r),
    ...extra,
  };
}

export function eventsOf(db: Database) {
  return db.orm.select().from(schema.notificationEvent).orderBy(schema.notificationEvent.id).all();
}

export function observationsOf(db: Database, listingId: number) {
  return db.orm
    .select()
    .from(schema.priceObservation)
    .where(eq(schema.priceObservation.listingId, listingId))
    .orderBy(schema.priceObservation.id)
    .all();
}

export function watchRow(db: Database, id: number) {
  return db.orm.select().from(schema.watch).where(eq(schema.watch.id, id)).get();
}

export function listingRow(db: Database, id: number) {
  return db.orm.select().from(schema.listing).where(eq(schema.listing.id, id)).get();
}

export function checkRow(db: Database, id: number) {
  return db.orm
    .select()
    .from(schema.listingCheck)
    .where(eq(schema.listingCheck.listingId, id))
    .get();
}

export function storeRow(db: Database, id: number) {
  return db.orm.select().from(schema.store).where(eq(schema.store.id, id)).get();
}
