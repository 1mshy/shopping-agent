// S§4.2 User intent. Save first (S§2.9): nothing here needs a price, a product or a store.
import type {
  MinorUnitCurrency,
  ReferenceKind,
  SearchIntent,
  SearchMode,
  SearchRunStatus,
  WatchKind,
  WatchListingAddedBy,
  WatchListingRole,
  WatchLookupState,
} from '@agentic-dasher/shared';
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { listing } from './catalogue.ts';
import { run } from './operations.ts';
import { id, profileId, timestamp } from './profile.ts';

export const watch = sqliteTable(
  'watch',
  {
    id: id(),
    profileId: profileId(),
    kind: text('kind').$type<WatchKind>().notNull(),
    input: text('input').notNull(),
    /** Null until the request is interpreted. */
    spec: text('spec_json', { mode: 'json' }).$type<SearchIntent>(),
    market: text('market').notNull(),
    /** Adopted from the first real read (S§5.8). */
    currency: text('currency').$type<MinorUnitCurrency>(),
    rules: text('rules_json', { mode: 'json' }).notNull(),
    referencePrice: integer('reference_price'),
    referenceKind: text('reference_kind').$type<ReferenceKind>(),
    cooldownS: integer('cooldown_s').notNull(),
    createdAt: timestamp('created_at').notNull(),
    // Migration 0002. Status is derived: archived when archivedAt is set, else paused when
    // pausedAt is set, else active.
    pausedAt: timestamp('paused_at'),
    archivedAt: timestamp('archived_at'),
    /** `url:` + normalised link, or `query:` + case-folded name; unique among unarchived watches. */
    dedupeKey: text('dedupe_key'),
    /** When the restock rule was last switched on; null while it is off. */
    restockEnabledAt: timestamp('restock_enabled_at'),
    /** Save first (S§2.9): the durable lookup, and the watch's daily re-discovery. */
    lookupState: text('lookup_state').$type<WatchLookupState>(),
    lookupQueuedAt: timestamp('lookup_queued_at'),
    lookupDueAt: timestamp('lookup_due_at'),
    lookupAttempts: integer('lookup_attempts'),
    lookupError: text('lookup_error'),
  },
  (t) => [
    unique().on(t.id, t.profileId),
    uniqueIndex('watch_dedupe_key_idx')
      .on(t.profileId, t.dedupeKey)
      .where(sql`${t.archivedAt} is null`),
    index('watch_lookup_due_idx').on(t.lookupDueAt).where(sql`${t.lookupDueAt} is not null`),
  ],
);

export const watchListing = sqliteTable(
  'watch_listing',
  {
    id: id(),
    profileId: profileId(),
    watchId: integer('watch_id').notNull(),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listing.id, { onDelete: 'restrict' }),
    role: text('role').$type<WatchListingRole>().notNull(),
    addedBy: text('added_by').$type<WatchListingAddedBy>().notNull(),
  },
  (t) => [
    unique().on(t.watchId, t.listingId),
    foreignKey({
      columns: [t.watchId, t.profileId],
      foreignColumns: [watch.id, watch.profileId],
    }).onDelete('cascade'),
    index('watch_listing_listing_idx').on(t.listingId),
  ],
);

export const searchRun = sqliteTable(
  'search_run',
  {
    id: id(),
    profileId: profileId(),
    /** Null until interpreted: a search is saved before any call (S§2.9). */
    intent: text('intent_json', { mode: 'json' }).$type<SearchIntent>(),
    mode: text('mode').$type<SearchMode>().notNull(),
    budget: text('budget_json', { mode: 'json' }).notNull(),
    status: text('status').$type<SearchRunStatus>().notNull(),
    coverage: text('coverage_json', { mode: 'json' }),
    result: text('result_json', { mode: 'json' }),
    runId: integer('run_id'),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.profileId],
      foreignColumns: [run.id, run.profileId],
    }).onDelete('restrict'),
    index('search_run_run_idx').on(t.runId),
  ],
);
