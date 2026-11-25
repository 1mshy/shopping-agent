// Shared by the notify tests: a real temporary SQLite file, the records an alert rests on, a fake
// clock whose sleeps advance it at once, and local HTTP servers on 127.0.0.1 standing in for ntfy
// and a webhook. Nothing here talks to a real notification service.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { eq } from 'drizzle-orm';
import { createSecretBox, type SecretBox } from '../../src/secrets/index.ts';

export const PROFILE = DEFAULT_PROFILE_ID;
export const T0 = Date.parse('2026-11-17T09:30:00.000Z');

export class TempDb {
  readonly dir = mkdtempSync(join(tmpdir(), 'dasher-notify-'));
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
  /** A second connection to the same file (another process, as far as SQLite can tell). */
  another(): Database {
    return TempDb.open(this.file);
  }
  /** Closes the connection, as a stopped or crashed process would, and opens a new one. */
  restart(): Database {
    try {
      this.db.close();
    } catch {
      // already closed
    }
    this.db = TempDb.open(this.file);
    return this.db;
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

export const testSecrets = (): SecretBox => createSecretBox(randomBytes(32));

export class FakeClock {
  ms: number;
  readonly waits: number[] = [];
  constructor(start = T0) {
    this.ms = start;
  }
  now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
  /** The pass's injected sleep: records the wait and moves the clock, without waiting. */
  sleep = async (ms: number, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) throw signal.reason;
    this.waits.push(ms);
    this.ms += ms;
  };
}

/** Seeds a store, a listing, an observation of it and a watch: what a listing alert rests on. */
export function seedAlertRecords(
  db: Database,
  options: { trustTier?: 'known' | 'caution'; observations?: number } = {},
): { watchId: number; listingId: number; observationIds: number[] } {
  const o = db.orm;
  o.insert(schema.store)
    .values({
      host: 'shop.example.ca',
      marketPrefix: '',
      platform: 'shopify',
      platformEvidence: 'window.Shopify',
      country: 'CA',
      baseCurrency: 'CAD',
      markets: ['CA'],
      shipsTo: ['CA'],
      searchRoute: null,
      readRoute: 'platform_json',
      identifiersOffered: [],
      isShop: 'yes',
      trustTier: options.trustTier ?? 'known',
      trustReasons: [],
      source: 'read',
      fingerprintedAt: null,
      consecutiveErrors: 0,
      lastOkAt: null,
      lastErrorAt: null,
      lastError: null,
    })
    .run();
  const listing = o
    .insert(schema.listing)
    .values({
      productId: null,
      storeId: 1,
      channel: 'retail',
      urlCanonical: 'https://shop.example.ca/products/wh-1000xm5',
      externalId: null,
      sku: null,
      sellerId: null,
      sellerKind: 'first_party',
      condition: 'new',
      currency: 'CAD',
      title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
      variant: {},
      trackable: true,
      firstSeenAt: '2026-11-17T09:00:00.000Z',
      lastSeenAt: '2026-11-17T09:00:00.000Z',
      goneAt: null,
      consecutiveErrors: 0,
    })
    .returning()
    .get();
  const observationIds: number[] = [];
  for (let i = 0; i < (options.observations ?? 1); i++) {
    const effective = 39999 - i * 1000;
    observationIds.push(
      o
        .insert(schema.priceObservation)
        .values({
          listingId: listing.id,
          observedAt: new Date(T0 - 60_000 + i).toISOString(),
          currency: 'CAD',
          sticker: 44999,
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
          effective,
          landed: null,
          missingComponents: ['shipping'],
          availability: 'in',
          readPath: 'platform_json',
          rung: 'api',
          rawCandidates: [
            { method: 'platform_json', confidence: 0.95, value: String(effective / 100) },
          ],
        })
        .returning()
        .get().id,
    );
  }
  const watch = o
    .insert(schema.watch)
    .values({
      profileId: PROFILE,
      kind: 'product',
      input: 'https://shop.example.ca/products/wh-1000xm5',
      spec: null,
      market: 'CA',
      currency: 'CAD',
      rules: { dropPct: 5 },
      referencePrice: 44999,
      referenceKind: 'median_verified',
      cooldownS: 43200,
      createdAt: '2026-11-17T09:00:00.000Z',
      pausedAt: null,
      archivedAt: null,
      dedupeKey: 'url:https://shop.example.ca/products/wh-1000xm5',
      restockEnabledAt: null,
      lookupState: 'done',
      lookupQueuedAt: '2026-11-17T09:00:00.000Z',
      lookupDueAt: null,
      lookupAttempts: 1,
      lookupError: null,
    })
    .returning()
    .get();
  return { watchId: watch.id, listingId: listing.id, observationIds };
}

export function deliveriesOf(db: Database) {
  return db.orm.select().from(schema.delivery).orderBy(schema.delivery.id).all();
}

export function deliveryById(db: Database, id: number) {
  return db.orm.select().from(schema.delivery).where(eq(schema.delivery.id, id)).get();
}

export function eventsOf(db: Database) {
  return db.orm.select().from(schema.notificationEvent).all();
}

export interface Received {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  /** The status the fake answered. */
  status: number;
}

export interface Scripted {
  readonly status: number;
  readonly headers?: Record<string, string>;
  /** A body; `echo-auth` answers with the request's Authorization header (a leaky server). */
  readonly body?: string | 'echo-auth';
  /** Called before answering; awaited (to hold a request open). */
  readonly before?: () => Promise<void> | void;
}

/** A local HTTP server answering from a script, then 200. Records every request. */
export class FakeServer {
  readonly received: Received[] = [];
  readonly script: Scripted[] = [];
  #server: Server;
  url = '';
  constructor(script: Scripted[] = []) {
    this.script.push(...script);
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        const entry: Received = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          status: 0,
        };
        this.received.push(entry);
        const step = this.script.shift() ?? { status: 200, body: '{"id":"ok"}' };
        await step.before?.();
        entry.status = step.status;
        const body =
          step.body === 'echo-auth' ? String(req.headers.authorization ?? '') : (step.body ?? '');
        res.writeHead(step.status, step.headers ?? {});
        res.end(body);
      });
    });
  }
  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
    return this;
  }
  /** Requests the fake answered 2xx: the messages the channel accepted. */
  accepted(): Received[] {
    return this.received.filter((r) => r.status >= 200 && r.status < 300);
  }
  async stop(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}

/** A URL on 127.0.0.1 where nothing listens: connection refused. */
export async function refusedUrl(): Promise<string> {
  const s = await new FakeServer().start();
  const url = s.url;
  await s.stop();
  return url;
}
