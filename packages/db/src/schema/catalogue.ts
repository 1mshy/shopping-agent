// S§4.1 Catalogue and observations: what the engine read, shared by every profile (no profile_id).
import type {
  Availability,
  Condition,
  Currency,
  DecidedBy,
  IdentifierKind,
  IsoCurrencyCode,
  IsShop,
  ListingChannel,
  ListingCurrency,
  MatchRelation,
  PageKind,
  PlaybookOutcomeKind,
  PriceComponent,
  RawCandidate,
  ReadFailureCause,
  ReadMethod,
  Rung,
  SearchRoute,
  SellerKind,
  ShippingStatus,
  StorePlatform,
  StoreSource,
  TrustTier,
} from '@agentic-dasher/shared';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { id, timestamp } from './profile.ts';

export const store = sqliteTable(
  'store',
  {
    id: id(),
    host: text('host').notNull(),
    /** '' when the storefront has no market prefix. */
    marketPrefix: text('market_prefix').notNull(),
    platform: text('platform').$type<StorePlatform>().notNull(),
    platformEvidence: text('platform_evidence'),
    country: text('country'),
    baseCurrency: text('base_currency').$type<Currency>().notNull(),
    markets: text('markets_json', { mode: 'json' }),
    shipsTo: text('ships_to_json', { mode: 'json' }),
    searchRoute: text('search_route').$type<SearchRoute>(),
    readRoute: text('read_route').$type<ReadMethod>(),
    identifiersOffered: text('identifiers_offered', { mode: 'json' }).$type<IdentifierKind[]>(),
    isShop: text('is_shop').$type<IsShop>().notNull(),
    trustTier: text('trust_tier').$type<TrustTier>().notNull(),
    trustReasons: text('trust_reasons_json', { mode: 'json' }).notNull(),
    source: text('source').$type<StoreSource>().notNull(),
    fingerprintedAt: timestamp('fingerprinted_at'),
    // Health fields (migration 0002). consecutiveErrors is null only on a store written before
    // 0002; a new store starts at 0.
    consecutiveErrors: integer('consecutive_errors'),
    lastOkAt: timestamp('last_ok_at'),
    lastErrorAt: timestamp('last_error_at'),
    lastError: text('last_error').$type<ReadFailureCause>(),
    fingerprint: text('fingerprint_json', { mode: 'json' }),
  },
  (t) => [unique().on(t.host, t.marketPrefix)],
);

export const hostAccess = sqliteTable(
  'host_access',
  {
    id: id(),
    host: text('host').notNull(),
    pageKind: text('page_kind').$type<PageKind>().notNull(),
    rung: text('rung').$type<Rung>().notNull(),
    lastOutcome: text('last_outcome').$type<PlaybookOutcomeKind>().notNull(),
    wallVendor: text('wall_vendor'),
    expiresAt: timestamp('expires_at'),
    backoffUntil: timestamp('backoff_until'),
    attempts: integer('attempts').notNull(),
  },
  (t) => [unique().on(t.host, t.pageKind)],
);

export const product = sqliteTable(
  'product',
  {
    id: id(),
    familyId: integer('family_id'),
    brand: text('brand'),
    model: text('model'),
    mpn: text('mpn'),
    gtin14: text('gtin14'),
    title: text('title').notNull(),
    category: text('category'),
    attributes: text('attributes_json', { mode: 'json' }),
  },
  (t) => [uniqueIndex('product_gtin14_idx').on(t.gtin14)],
);

export const listing = sqliteTable(
  'listing',
  {
    id: id(),
    productId: integer('product_id').references(() => product.id, { onDelete: 'restrict' }),
    storeId: integer('store_id')
      .notNull()
      .references(() => store.id, { onDelete: 'restrict' }),
    channel: text('channel').$type<ListingChannel>().notNull(),
    urlCanonical: text('url_canonical').notNull(),
    externalId: text('external_id'),
    sku: text('sku'),
    sellerId: text('seller_id'),
    sellerKind: text('seller_kind').$type<SellerKind>().notNull(),
    condition: text('condition').$type<Condition>().notNull(),
    currency: text('currency').$type<ListingCurrency>().notNull(),
    title: text('title').notNull(),
    variant: text('variant_json', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    trackable: integer('trackable', { mode: 'boolean' }).notNull(),
    firstSeenAt: timestamp('first_seen_at').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull(),
    goneAt: timestamp('gone_at'),
    consecutiveErrors: integer('consecutive_errors').notNull(),
  },
  (t) => [unique().on(t.storeId, t.urlCanonical), index('listing_product_idx').on(t.productId)],
);

/** Append-only and kept forever: the migration's triggers refuse UPDATE, DELETE and REPLACE. */
export const priceObservation = sqliteTable(
  'price_observation',
  {
    id: id(),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listing.id, { onDelete: 'restrict' }),
    observedAt: timestamp('observed_at').notNull(),
    currency: text('currency').$type<ListingCurrency>().notNull(),
    sticker: integer('sticker'),
    referenceClaimed: integer('reference_claimed'),
    coupon: integer('coupon'),
    memberPrice: integer('member_price'),
    shipping: integer('shipping'),
    shippingStatus: text('shipping_status').$type<ShippingStatus>().notNull(),
    tax: integer('tax'),
    taxIncluded: integer('tax_included', { mode: 'boolean' }),
    dutyEstimate: integer('duty_estimate'),
    unitPrice: integer('unit_price'),
    unit: text('unit'),
    effective: integer('effective'),
    landed: integer('landed'),
    missingComponents: text('missing_components_json', { mode: 'json' })
      .$type<PriceComponent[]>()
      .notNull(),
    availability: text('availability').$type<Availability>().notNull(),
    readPath: text('read_path').$type<ReadMethod>().notNull(),
    rung: text('rung').$type<Rung>().notNull(),
    rawCandidates: text('raw_candidates_json', { mode: 'json' }).$type<RawCandidate[]>().notNull(),
  },
  (t) => [
    // The parent key of notification_event's (observation_id, listing_id).
    unique().on(t.id, t.listingId),
    index('price_observation_listing_time_idx').on(t.listingId, t.observedAt),
  ],
);

export const matchVerdict = sqliteTable(
  'match_verdict',
  {
    id: id(),
    specFp: text('spec_fp').notNull(),
    listingFp: text('listing_fp').notNull(),
    relation: text('relation').$type<MatchRelation>().notNull(),
    differingAttrs: text('differing_attrs_json', { mode: 'json' }).$type<string[]>().notNull(),
    decidedBy: text('decided_by').$type<DecidedBy>().notNull(),
    matcherVersion: text('matcher_version').notNull(),
    promptVersion: text('prompt_version'),
    modelId: text('model_id'),
    decidedAt: timestamp('decided_at').notNull(),
  },
  (t) => [
    uniqueIndex('match_verdict_cache_key_idx').on(
      t.specFp,
      t.listingFp,
      t.matcherVersion,
      sql`coalesce(${t.promptVersion}, '')`,
      sql`coalesce(${t.modelId}, '')`,
      t.decidedBy,
    ),
  ],
);

export const fxRate = sqliteTable(
  'fx_rate',
  {
    id: id(),
    base: text('base').$type<IsoCurrencyCode>().notNull(),
    quote: text('quote').$type<IsoCurrencyCode>().notNull(),
    /** A ratio, never an amount (S§2.2). */
    rate: real('rate').notNull(),
    source: text('source').notNull(),
    asOf: timestamp('as_of').notNull(),
  },
  (t) => [
    unique().on(t.base, t.quote, t.source, t.asOf),
    index('fx_rate_pair_idx').on(t.base, t.quote, t.asOf),
  ],
);

/**
 * When a listing is read next and how its recent reads went (S§5.8, migration 0002). Catalogue
 * data: a listing is read once for every watch that follows it. `nextCheckAt` is null while no
 * active watch tracks the listing; `firstErrorAt` and `lastError` describe the current run of
 * failed reads (a failed read writes no observation, S§2.10) and move with
 * `listing.consecutiveErrors`.
 */
export const listingCheck = sqliteTable(
  'listing_check',
  {
    listingId: integer('listing_id')
      .primaryKey()
      .references(() => listing.id, { onDelete: 'cascade' }),
    nextCheckAt: timestamp('next_check_at'),
    lastReadAt: timestamp('last_read_at'),
    firstErrorAt: timestamp('first_error_at'),
    lastError: text('last_error').$type<ReadFailureCause>(),
  },
  (t) => [
    index('listing_check_due_idx').on(t.nextCheckAt).where(sql`${t.nextCheckAt} is not null`),
  ],
);

/**
 * RDAP registration dates by registrable domain, cached forever (S§5.5, migration 0002). A null
 * `registeredAt` records that RDAP gave no registration date; a transient failure writes no row.
 */
export const domainRegistration = sqliteTable('domain_registration', {
  domain: text('domain').primaryKey(),
  registeredAt: timestamp('registered_at'),
  fetchedAt: timestamp('fetched_at').notNull(),
});

/** A lead from a community deal feed (S§5.3): the price stays text until a live read confirms it. */
export const dealFeedItem = sqliteTable('deal_feed_item', {
  id: id(),
  url: text('url').notNull(),
  merchant: text('merchant'),
  priceText: text('price_text'),
  votes: integer('votes'),
  expiresAt: timestamp('expires_at'),
});
