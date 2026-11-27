import { type Database, schema } from '@agentic-dasher/db';
import type { Fetcher } from '@agentic-dasher/fetch';
import {
  CountryCode,
  FetchOutcomeKind,
  IsShop,
  LanguageTag,
  MinorUnitCurrency,
  StorePlatform,
} from '@agentic-dasher/shared';
import {
  FINGERPRINT_MAX_REQUESTS,
  fingerprintStore,
  type Market,
  type StoreFingerprint,
} from '@agentic-dasher/sources';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const longExpiry = 30 * 24 * 60 * 60_000;
const retryAfter = 15 * 60_000;
const marketSchema = z.strictObject({
  country: CountryCode,
  currency: MinorUnitCurrency,
  language: LanguageTag,
});
const optionalFlag = z.boolean().nullable();
const optionalRoute = z.string().nullable();
const evidenceSchema = z.strictObject({
  market: marketSchema,
  platform: StorePlatform,
  platformEvidence: z
    .enum(['home_markup', 'prior_read', 'shopify_suggest', 'woo_store_api', 'magento_graphql'])
    .nullable(),
  magentoGeneration: z.union([z.literal(1), z.literal(2)]).nullable(),
  predictiveSearch: optionalFlag,
  productMarkup: optionalFlag,
  productSitemap: optionalFlag,
  llmsTxt: optionalFlag,
  ucpCatalogEndpoint: optionalRoute,
  searchAction: optionalRoute,
  openSearchTemplate: optionalRoute,
  wireRequests: z.int().min(0).max(FINGERPRINT_MAX_REQUESTS),
  probes: z
    .array(
      z.strictObject({
        probe: z.enum(['home', 'platform', 'ucp', 'opensearch', 'sitemap', 'llms']),
        outcome: z.union([FetchOutcomeKind, z.literal('other_storefront')]),
      }),
    )
    .max(FINGERPRINT_MAX_REQUESTS),
});
const recordSchema = z.strictObject({
  version: z.literal(1),
  at: z.int(),
  classification: IsShop,
  evidence: evidenceSchema,
});

function classify(e: StoreFingerprint): IsShop {
  if (
    (e.platform !== 'unknown' && e.platform !== 'other') ||
    e.productMarkup ||
    e.productSitemap ||
    e.ucpCatalogEndpoint
  )
    return 'yes';
  // A successful HTTP response from an arbitrary URL is insufficient to establish that a
  // platform is absent. A missing platform endpoint, readable home and missing product
  // sitemap together provide negative evidence.
  return e.productMarkup === false &&
    e.productSitemap === false &&
    e.probes.some((p) => p.probe === 'platform' && p.outcome === 'not_found')
    ? 'no'
    : 'unknown';
}

type Store = typeof schema.store.$inferSelect;
type RecordEntry = z.infer<typeof recordSchema>;

function unexpired(value: unknown, now: number): Record<string, RecordEntry> {
  const records: Record<string, RecordEntry> = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return records;
  for (const [key, entry] of Object.entries(value)) {
    const result = recordSchema.safeParse(entry);
    if (!result.success) continue;
    const r = result.data;
    const complete =
      r.classification !== 'unknown' &&
      r.evidence.probes.every((p) => p.outcome === 'ok' || p.outcome === 'not_found');
    const age = now - r.at;
    if (age >= 0 && age < (complete ? longExpiry : retryAfter)) records[key] = r;
  }
  return records;
}
function knownShop(row: Store): boolean {
  const cache = row.fingerprint;
  return (
    row.isShop === 'yes' &&
    (row.lastOkAt !== null ||
      cache === null ||
      (typeof cache === 'object' && 'confirmedShop' in cache && cache.confirmedShop === true))
  );
}

export interface DirectoryRequest {
  storeId: number;
  market: Market;
  origin?: string;
  deadline: number;
  signal: AbortSignal;
}
export type DirectoryFingerprint =
  | { kind: 'fresh' | 'cached'; isShop: IsShop; evidence: StoreFingerprint }
  | { kind: 'missing' | 'blocked' | 'cancelled' };

export function createStoreDirectory({
  db,
  fetcher,
  now = Date.now,
}: {
  db: Database;
  fetcher: Fetcher;
  now?: () => number;
}) {
  const store = schema.store;

  async function fingerprint(request: DirectoryRequest): Promise<DirectoryFingerprint> {
    const row = db.orm.select().from(store).where(eq(store.id, request.storeId)).get();
    if (!row) return { kind: 'missing' };
    if (row.trustTier === 'blocked') return { kind: 'blocked' };
    if (request.signal.aborted || now() >= request.deadline) return { kind: 'cancelled' };
    const origin = new URL(request.origin ?? `https://${row.host}`);
    if (
      origin.hostname !== row.host ||
      origin.href !== `${origin.origin}/` ||
      !/^https?:$/.test(origin.protocol)
    )
      throw new RangeError('Expected the stored storefront origin');
    const market = marketSchema.parse(request.market);
    const key = JSON.stringify([
      origin.origin,
      row.marketPrefix,
      market.country,
      market.currency,
      market.language,
    ]);
    const cached = unexpired(row.fingerprint, now())[key];
    if (cached)
      return {
        kind: 'cached',
        isShop: knownShop(row) ? 'yes' : cached.classification,
        evidence: cached.evidence,
      };
    const evidence = await fingerprintStore(
      {
        origin: origin.origin,
        marketPrefix: row.marketPrefix,
        market,
        ...(row.lastOkAt !== null ? { platform: row.platform } : {}),
      },
      fetcher,
      request,
    );
    if (request.signal.aborted) return { kind: 'cancelled' };
    return db.orm.transaction(
      (tx): DirectoryFingerprint => {
        // A read or trust override can complete while the remote requests are in flight.
        const current = tx.select().from(store).where(eq(store.id, row.id)).get();
        if (!current || current.host !== row.host || current.marketPrefix !== row.marketPrefix)
          return { kind: 'missing' };
        if (current.trustTier === 'blocked') return { kind: 'blocked' };
        const at = now();
        const confirmed = knownShop(current);
        const classification = classify(evidence);
        const isShop = confirmed ? 'yes' : classification;
        const records = unexpired(current.fingerprint, at);
        tx.update(store)
          .set({
            isShop,
            fingerprintedAt: new Date(at).toISOString(),
            fingerprint: {
              ...records,
              confirmedShop: confirmed,
              [key]: { version: 1, at, classification, evidence },
            },
            ...(current.platform === 'unknown' && evidence.platform !== 'unknown'
              ? { platform: evidence.platform, platformEvidence: evidence.platformEvidence }
              : {}),
          })
          .where(eq(store.id, current.id))
          .run();
        return { kind: 'fresh', isShop, evidence };
      },
      { behavior: 'immediate' },
    );
  }
  return { fingerprint };
}
