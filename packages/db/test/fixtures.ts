// Shared by the db tests: a migrated in-memory database, introspection, and one realistic row per
// table that the contract tests insert, read back and parse with the Zod schemas.
import type { SearchIntent } from '@agentic-dasher/shared';
import { sql } from 'drizzle-orm';
import { type Database, migrate, openDatabase, schema } from '../src/index.ts';

export function migratedDb(): Database {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

/**
 * Runs a statement that must fail and returns why: Drizzle wraps the driver's error ("Failed
 * query: …") and keeps SQLite's message in `cause`, so both are returned.
 */
export function refusal(act: () => unknown): string {
  try {
    act();
  } catch (error) {
    const messages: string[] = [];
    for (let e: unknown = error; e instanceof Error; e = e.cause) messages.push(e.message);
    return messages.join(' <- ');
  }
  throw new Error('expected the statement to be refused, and it was accepted');
}

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export function tableNames(db: Database): string[] {
  return db.orm
    .all<{ name: string }>(
      sql`select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name`,
    )
    .map((r) => r.name);
}

export function columnsOf(db: Database, table: string): ColumnInfo[] {
  return db.orm.all<ColumnInfo>(sql`select * from pragma_table_xinfo(${table})`);
}

export interface ForeignKeyInfo {
  table: string;
  from: string[];
  to: string[];
  onDelete: string;
}

export function foreignKeysOf(db: Database, table: string): ForeignKeyInfo[] {
  const rows = db.orm.all<{
    id: number;
    table: string;
    from: string;
    to: string;
    on_delete: string;
  }>(sql`select * from pragma_foreign_key_list(${table}) order by id, seq`);
  const byId = new Map<number, ForeignKeyInfo>();
  for (const r of rows) {
    const fk = byId.get(r.id) ?? { table: r.table, from: [], to: [], onDelete: r.on_delete };
    fk.from.push(r.from);
    fk.to.push(r.to);
    byId.set(r.id, fk);
  }
  return [...byId.values()];
}

export interface IndexInfo {
  name: string;
  origin: string;
  unique: boolean;
  partial: boolean;
  /** Key columns in order; an expression is '<expr>'. */
  columns: string[];
}

export function indexesOf(db: Database, table: string): IndexInfo[] {
  const list = db.orm.all<{ name: string; unique: number; origin: string; partial: number }>(
    sql`select * from pragma_index_list(${table})`,
  );
  return list.map((i) => ({
    name: i.name,
    origin: i.origin,
    unique: i.unique === 1,
    partial: i.partial === 1,
    columns: db.orm
      .all<{ name: string | null; key: number }>(
        sql`select * from pragma_index_xinfo(${i.name}) where key = 1 order by seqno`,
      )
      .map((c) => c.name ?? '<expr>'),
  }));
}

// Realistic rows. Timestamps are in the contract format; money is integer minor units (CAD) or
// nano-units (run cost, USD).

export const T0 = '2026-11-17T09:00:00.000Z';
export const T1 = '2026-11-17T09:30:00.250Z';

export const searchIntent: SearchIntent = {
  kind: 'exact',
  name: 'Sony WH-1000XM5',
  brand: 'Sony',
  model: 'WH-1000XM5',
  mustHave: [{ attribute: 'colour', value: 'black' }],
  substitutes: [],
  conditions: ['new', 'open_box'],
  packQuantity: null,
  fulfilment: ['delivery'],
  gtin: null,
  mpn: 'WH1000XM5/B',
  currency: 'CAD',
  location: { country: 'CA', postalCode: 'M5V 2T6' },
  budget: { amountMinor: 40000, currency: 'CAD' },
};

export const rows = {
  store: {
    id: 1,
    host: 'shop.example.ca',
    marketPrefix: '',
    platform: 'shopify',
    platformEvidence: 'window.Shopify',
    country: 'CA',
    baseCurrency: 'CAD',
    markets: ['CA'],
    shipsTo: ['CA', 'US'],
    searchRoute: 'shopify_suggest',
    readRoute: 'platform_json',
    identifiersOffered: ['gtin', 'sku'],
    isShop: 'yes',
    trustTier: 'known',
    trustReasons: ['tranco_top_1m'],
    source: 'read',
    fingerprintedAt: T0,
    consecutiveErrors: 0,
    lastOkAt: T1,
    lastErrorAt: null,
    lastError: null,
  } satisfies typeof schema.store.$inferInsert,
  listing: {
    id: 1,
    productId: null,
    storeId: 1,
    channel: 'retail',
    urlCanonical: 'https://shop.example.ca/products/wh-1000xm5',
    externalId: '8123456',
    sku: 'WH1000XM5/B',
    sellerId: null,
    sellerKind: 'first_party',
    condition: 'new',
    currency: 'CAD',
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
    variant: { Colour: 'Black' },
    trackable: true,
    firstSeenAt: T0,
    lastSeenAt: T1,
    goneAt: null,
    consecutiveErrors: 0,
  } satisfies typeof schema.listing.$inferInsert,
  observation: {
    id: 1,
    listingId: 1,
    observedAt: T1,
    currency: 'CAD',
    sticker: 44999,
    referenceClaimed: 49999,
    coupon: null,
    memberPrice: null,
    shipping: 0,
    shippingStatus: 'known',
    tax: null,
    taxIncluded: false,
    dutyEstimate: null,
    unitPrice: null,
    unit: null,
    effective: 44999,
    landed: 44999,
    missingComponents: [],
    availability: 'in',
    readPath: 'platform_json',
    rung: 'api',
    rawCandidates: [{ method: 'platform_json', confidence: 0.95, value: '449.99' }],
  } satisfies typeof schema.priceObservation.$inferInsert,
  verdict: {
    id: 1,
    specFp: 'spec:5f2c',
    listingFp: 'listing:1:WH1000XM5/B',
    relation: 'variant',
    differingAttrs: ['colour'],
    decidedBy: 'model',
    matcherVersion: 'm1',
    promptVersion: 'judge-1',
    modelId: 'gpt-5-mini',
    decidedAt: T1,
  } satisfies typeof schema.matchVerdict.$inferInsert,
  watch: {
    id: 1,
    profileId: 1,
    kind: 'product',
    input: 'https://shop.example.ca/products/wh-1000xm5',
    spec: searchIntent,
    market: 'CA',
    currency: 'CAD',
    rules: { dropPct: 5 },
    referencePrice: 44999,
    referenceKind: 'median_verified',
    cooldownS: 43200,
    createdAt: T0,
    pausedAt: null,
    archivedAt: null,
    dedupeKey: 'url:https://shop.example.ca/products/wh-1000xm5',
    restockEnabledAt: null,
    lookupState: 'done',
    lookupQueuedAt: T0,
    lookupDueAt: null,
    lookupAttempts: 1,
    lookupError: null,
  } satisfies typeof schema.watch.$inferInsert,
  feedCard: {
    id: 1,
    profileId: 1,
    evidence: { because: 'watch', watchId: 1 },
  } satisfies typeof schema.feedCard.$inferInsert,
  channel: {
    id: 1,
    profileId: 1,
    type: 'in_app',
    config: {},
    secretEnc: null,
    name: 'In the app',
    createdAt: T0,
    disabledAt: null,
    removedAt: null,
  } satisfies typeof schema.channel.$inferInsert,
  run: {
    id: 77,
    profileId: 1,
    type: 'fast_search',
    status: 'completed',
    startedAt: '2026-11-17T10:00:00.000Z',
    endedAt: '2026-11-17T10:00:04.512Z',
    maxTurns: 2,
    deadlineMs: 60000,
    maxInputTokens: 30000,
    maxSpendNanos: 30_000_000,
    spendCurrency: 'USD',
    budgetHits: [],
    turns: 2,
    inputTokens: 4200,
    cacheReadInputTokens: 3000,
    cacheWriteInputTokens: 0,
    outputTokens: 610,
    reasoningOutputTokens: 128,
    costSource: 'provider',
    costNanos: 412_350,
    costCurrency: 'USD',
  } satisfies typeof schema.run.$inferInsert,
  chatStep: {
    id: 1,
    runId: 77,
    profileId: 1,
    index: 0,
    operationName: 'chat',
    startedAt: '2026-11-17T10:00:00.010Z',
    endedAt: '2026-11-17T10:00:02.300Z',
    payload: { request: { messages: 2 }, response: { choices: 1 } },
    role: 'planner',
    promptVersion: 'planner-1',
    providerName: 'openrouter',
    requestModel: 'openai/gpt-5-mini',
    responseModel: 'openai/gpt-5-mini-2026-08-07',
    responseId: 'gen-123',
    finishReasons: ['stop'],
    inputTokens: 2100,
    cacheReadInputTokens: 1500,
    cacheWriteInputTokens: 0,
    outputTokens: 300,
    reasoningOutputTokens: 64,
    costSource: 'provider',
    costNanos: 206_175,
    costCurrency: 'USD',
    toolName: null,
    toolCallId: null,
    refusal: null,
  } satisfies typeof schema.runStep.$inferInsert,
  toolStep: {
    id: 2,
    runId: 77,
    profileId: 1,
    index: 1,
    operationName: 'execute_tool',
    startedAt: '2026-11-17T10:00:02.400Z',
    endedAt: '2026-11-17T10:00:02.410Z',
    payload: null,
    role: null,
    promptVersion: null,
    providerName: null,
    requestModel: null,
    responseModel: null,
    responseId: null,
    finishReasons: null,
    inputTokens: null,
    cacheReadInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    costSource: null,
    costNanos: null,
    costCurrency: null,
    toolName: 'create_watch',
    toolCallId: 'call_1',
    refusal: {
      code: 'budget_exceeded',
      whatTheEngineSaw: 'the watch limit for this run was reached',
      hint: 'finish with what you have',
    },
  } satisfies typeof schema.runStep.$inferInsert,
  priceDrop: {
    id: 1,
    profileId: 1,
    key: 'price_drop:watch:1:observation:1',
    kind: 'price_drop',
    createdAt: T1,
    watchId: 1,
    listingId: 1,
    observationId: 1,
    feedCardId: null,
    runId: null,
    text: null,
  } satisfies typeof schema.notificationEvent.$inferInsert,
  pendingDelivery: {
    id: 1,
    profileId: 1,
    eventId: 1,
    channelId: 1,
    state: 'pending',
    attempts: 0,
    outcome: null,
    nextAttemptAt: T1,
    acceptedAt: null,
  } satisfies typeof schema.delivery.$inferInsert,
  // Migration 0002.
  hostPacing: {
    host: 'shop.example.ca',
    nextStartAt: '2026-11-17T09:30:02.875Z',
  } satisfies typeof schema.hostPacing.$inferInsert,
  domainRegistration: {
    domain: 'example.ca',
    registeredAt: '2004-03-11T00:00:00.000Z',
    fetchedAt: T0,
  } satisfies typeof schema.domainRegistration.$inferInsert,
  listingCheck: {
    listingId: 1,
    nextCheckAt: '2026-11-17T10:00:00.250Z',
    lastReadAt: T1,
    firstErrorAt: null,
    lastError: null,
  } satisfies typeof schema.listingCheck.$inferInsert,
  job: {
    id: 1,
    name: 'sweep',
    cron: '*/30 * * * *',
    nextRunAt: '2026-11-17T10:00:00.000Z',
    deadlineMs: 600000,
    networkGate: true,
    retryAt: null,
  } satisfies typeof schema.job.$inferInsert,
  jobRun: {
    id: 1,
    jobId: 1,
    status: 'completed',
    startedAt: T0,
    endedAt: '2026-11-17T09:00:41.120Z',
    reason: 'slot',
    coalescedSlots: 1,
    detail: { listingsRead: 20, failedReads: { wall: 1 } },
  } satisfies typeof schema.jobRun.$inferInsert,
  ownerPassword: {
    profileId: 1,
    passwordHash:
      '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$qL3xv0pPCXxYyHnT3i7Ff8wQ4mX0vX3ZB1zZ0kq9b8s',
    setAt: T0,
  } satisfies typeof schema.ownerPassword.$inferInsert,
  session: {
    id: 1,
    profileId: 1,
    tokenHash: 'a3f1c2d4e5b6978877665544332211ffeeddccbbaa99887766554433221100aa',
    createdAt: T0,
    expiresAt: '2026-12-17T09:00:00.000Z',
    lastSeenAt: T1,
  } satisfies typeof schema.session.$inferInsert,
};

/** Profiles 1 and 2 and one row of every parent the contract tests point at. */
export function seed(db: Database): void {
  const o = db.orm;
  o.insert(schema.profile)
    .values([{ id: 1 }, { id: 2 }])
    .run();
  o.insert(schema.store).values(rows.store).run();
  o.insert(schema.listing).values(rows.listing).run();
  o.insert(schema.priceObservation).values(rows.observation).run();
  o.insert(schema.watch).values(rows.watch).run();
  o.insert(schema.feedCard).values(rows.feedCard).run();
  o.insert(schema.channel).values(rows.channel).run();
  o.insert(schema.run).values(rows.run).run();
}
