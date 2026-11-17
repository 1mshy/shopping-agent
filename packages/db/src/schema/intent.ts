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
} from '@agentic-dasher/shared';
import { foreignKey, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
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
  },
  (t) => [unique().on(t.id, t.profileId)],
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
    intent: text('intent_json', { mode: 'json' }).$type<SearchIntent>().notNull(),
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
  ],
);
