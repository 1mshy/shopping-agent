// The sweep's SQL side: the rows it reads and the transaction it writes in. Every read here is of
// tables other units own; the sweep writes price_observation, listing, listing_check, store health,
// watch reference and lookup columns, and (through the outbox) notification_event and delivery.
import { type Database, schema } from '@agentic-dasher/db';
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

export type ListingRow = typeof schema.listing.$inferSelect;
export type StoreRow = typeof schema.store.$inferSelect;
export type CheckRow = typeof schema.listingCheck.$inferSelect;
export type WatchRow = typeof schema.watch.$inferSelect;
export type WatchListingRow = typeof schema.watchListing.$inferSelect;
export type ObservationRow = typeof schema.priceObservation.$inferSelect;

/**
 * Runs `fn` in a `BEGIN IMMEDIATE` transaction: the write lock is taken before the first read, so
 * two writers on one database file (two sweeps, a sweep and a route) decide one after the other.
 * `fn` is synchronous, so nothing else in this process runs in between either.
 */
export function immediate<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
  return result;
}

/** A watch is active when neither archived nor paused (S§4.2: the status is derived). */
const active = (w: typeof schema.watch) => and(isNull(w.archivedAt), isNull(w.pausedAt));

export function listingById(db: Database, id: number): ListingRow | undefined {
  return db.orm.select().from(schema.listing).where(eq(schema.listing.id, id)).get();
}

export function storeById(db: Database, id: number): StoreRow | undefined {
  return db.orm.select().from(schema.store).where(eq(schema.store.id, id)).get();
}

export function checkOf(db: Database, listingId: number): CheckRow | undefined {
  return db.orm
    .select()
    .from(schema.listingCheck)
    .where(eq(schema.listingCheck.listingId, listingId))
    .get();
}

export function watchById(db: Database, id: number): WatchRow | undefined {
  return db.orm.select().from(schema.watch).where(eq(schema.watch.id, id)).get();
}

export function observationById(db: Database, id: number): ObservationRow | undefined {
  return db.orm
    .select()
    .from(schema.priceObservation)
    .where(eq(schema.priceObservation.id, id))
    .get();
}

/** The active watches that follow the listing with role `tracked`, by id. */
export function activeTrackingWatchIds(db: Database, listingId: number): number[] {
  const { watch, watchListing } = schema;
  return db.orm
    .select({ id: watch.id })
    .from(watchListing)
    .innerJoin(watch, eq(watch.id, watchListing.watchId))
    .where(
      and(eq(watchListing.listingId, listingId), eq(watchListing.role, 'tracked'), active(watch)),
    )
    .orderBy(asc(watch.id))
    .all()
    .map((r) => r.id);
}

/** SQL: the listing (by its id column) is followed by at least one active watch with role tracked. */
export function trackedSql(listingIdColumn: typeof schema.listingCheck.listingId) {
  const { watch, watchListing } = schema;
  return sql`exists (select 1 from ${watchListing} join ${watch} on ${watch.id} = ${watchListing.watchId}
    where ${watchListing.listingId} = ${listingIdColumn} and ${watchListing.role} = 'tracked'
    and ${watch.archivedAt} is null and ${watch.pausedAt} is null)`;
}

export interface Member {
  readonly link: WatchListingRow;
  readonly listing: ListingRow;
  readonly store: StoreRow;
  readonly check: CheckRow | undefined;
}

/** The listings a watch follows with role `tracked`, with their store and check rows. */
export function trackedMembers(db: Database, watchId: number): Member[] {
  const { watchListing, listing, store, listingCheck } = schema;
  return db.orm
    .select({ link: watchListing, listing, store, check: listingCheck })
    .from(watchListing)
    .innerJoin(listing, eq(listing.id, watchListing.listingId))
    .innerJoin(store, eq(store.id, listing.storeId))
    .leftJoin(listingCheck, eq(listingCheck.listingId, listing.id))
    .where(and(eq(watchListing.watchId, watchId), eq(watchListing.role, 'tracked')))
    .orderBy(asc(listing.id))
    .all()
    .map((r) => ({
      link: r.link,
      listing: r.listing,
      store: r.store,
      check: r.check ?? undefined,
    }));
}

/**
 * A listing's observations from `sinceIso` up to and including `upTo` (by time, then id), the
 * `limit` most recent, returned oldest first.
 */
export function historyOf(
  db: Database,
  listingId: number,
  options: {
    readonly sinceIso: string;
    readonly upTo: ObservationRow | null;
    readonly limit: number;
  },
): ObservationRow[] {
  const o = schema.priceObservation;
  const { upTo } = options;
  const until =
    upTo === null
      ? undefined
      : or(
          sql`${o.observedAt} < ${upTo.observedAt}`,
          and(eq(o.observedAt, upTo.observedAt), lte(o.id, upTo.id)),
        );
  return db.orm
    .select()
    .from(o)
    .where(and(eq(o.listingId, listingId), gte(o.observedAt, options.sinceIso), until))
    .orderBy(desc(o.observedAt), desc(o.id))
    .limit(options.limit)
    .all()
    .reverse();
}

/** The listing's latest observation (by time, then id), or undefined. */
export function latestObservation(db: Database, listingId: number): ObservationRow | undefined {
  const o = schema.priceObservation;
  return db.orm
    .select()
    .from(o)
    .where(eq(o.listingId, listingId))
    .orderBy(desc(o.observedAt), desc(o.id))
    .limit(1)
    .get();
}

/** The latest observation of the listing that has an effective price in `currency`. */
export function latestPricedIn(
  db: Database,
  listingId: number,
  currency: string,
): ObservationRow | undefined {
  const o = schema.priceObservation;
  return db.orm
    .select()
    .from(o)
    .where(
      and(
        eq(o.listingId, listingId),
        sql`${o.currency} = ${currency}`,
        sql`${o.effective} is not null`,
      ),
    )
    .orderBy(desc(o.observedAt), desc(o.id))
    .limit(1)
    .get();
}

/** The newest event of the watch and kind (by id), or undefined. */
export function latestEventOf(
  db: Database,
  watchId: number,
  kind: 'price_drop' | 'restock',
): typeof schema.notificationEvent.$inferSelect | undefined {
  const e = schema.notificationEvent;
  return db.orm
    .select()
    .from(e)
    .where(and(eq(e.watchId, watchId), eq(e.kind, kind)))
    .orderBy(desc(e.id))
    .limit(1)
    .get();
}
