// The read model the watches routes and the UI show (S§5.8, S§5.12, S§2 invariants 10 and 11): a
// listing's remembered read state and the price it shows with its freshness, and a watch's best
// price, its listings and its last alert of each kind with its delivery status. Read only; every
// rule is the pure one of packages/core (showWatchPrice, gateOnDelivery), never re-derived here.
import {
  type DeliveryGatingDecision,
  gateOnDelivery,
  type ListingReadState,
  type ShownPrice,
  showWatchPrice,
} from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import {
  MinorUnitCurrency,
  type Money,
  type ReadFailureCause,
  type ReferenceKind,
} from '@agentic-dasher/shared';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  type AlertDeliveryStatus,
  deliveryStatus,
  gatingDeliveries,
  type LastAcceptedAlert,
  lastAcceptedAlert,
} from '../notify/index.ts';
import { CODE_ONLY_VERSIONS, identityOf, type VerdictVersions } from './identity.ts';
import {
  checkOf,
  latestEventOf,
  latestObservation,
  listingById,
  observationById,
  trackedMembers,
  watchById,
} from './rows.ts';

export interface ListingState {
  readonly listingId: number;
  /** What packages/core `applyRead` and `showWatchPrice` take for this listing. */
  readonly state: ListingReadState;
  /** The listing's price as shown: `current`, `stale` (kept after failed reads) or `none`. */
  readonly shown: ShownPrice;
  readonly lastReadAt: string | null;
  readonly nextCheckAt: string | null;
  readonly consecutiveErrors: number;
  readonly lastError: ReadFailureCause | null;
  readonly firstErrorAt: string | null;
}

/** The listing's read state, or null when the listing does not exist. */
export function listingState(db: Database, listingId: number): ListingState | null {
  const listing = listingById(db, listingId);
  if (listing === undefined) return null;
  const check = checkOf(db, listingId);
  const o = schema.priceObservation;
  const priced = db.orm
    .select()
    .from(o)
    .where(and(eq(o.listingId, listingId), ne(o.currency, 'unknown')))
    .orderBy(desc(o.observedAt), desc(o.id))
    .all()
    .find((r) => r.effective !== null);
  const known = db.orm
    .select({ availability: o.availability })
    .from(o)
    .where(and(eq(o.listingId, listingId), ne(o.availability, 'unknown')))
    .orderBy(desc(o.observedAt), desc(o.id))
    .limit(1)
    .get();
  const latest = latestObservation(db, listingId);
  const currency = priced === undefined ? null : MinorUnitCurrency.safeParse(priced.currency);
  // last_read_at trails an observation whose evaluation did not finish (check.ts); the observation
  // is still the latest read.
  const checkRead = check?.lastReadAt ?? null;
  const lastReadAt =
    latest !== undefined && (checkRead === null || latest.observedAt > checkRead)
      ? latest.observedAt
      : checkRead;
  const failed = listing.consecutiveErrors > 0;
  const state: ListingReadState = {
    lastPrice:
      priced !== undefined && currency?.success && priced.effective !== null
        ? {
            price: { amountMinor: priced.effective, currency: currency.data },
            observationId: priced.id,
            observedAt: priced.observedAt,
          }
        : null,
    lastKnownAvailability: known?.availability ?? 'unknown',
    lastReadAt,
    lastReadFailed: failed,
    consecutiveErrors: listing.consecutiveErrors,
  };
  const shown: ShownPrice =
    state.lastPrice === null
      ? { freshness: 'none' }
      : (showWatchPrice({
          watchCurrency: state.lastPrice.price.currency,
          listings: [{ listingId, state }],
        }).best?.shown ?? { freshness: 'none' });
  return {
    listingId,
    state,
    shown,
    lastReadAt,
    nextCheckAt: check?.nextCheckAt ?? null,
    consecutiveErrors: listing.consecutiveErrors,
    lastError: check?.lastError ?? null,
    firstErrorAt: check?.firstErrorAt ?? null,
  };
}

export interface AlertState {
  readonly eventId: number;
  readonly createdAt: string;
  readonly listingId: number | null;
  readonly observationId: number | null;
  /** The observation's effective price; null when it has none. */
  readonly price: Money | null;
  readonly status: AlertDeliveryStatus;
  /** packages/core gateOnDelivery's answer; null when the alert has no price to gate on. */
  readonly gating: DeliveryGatingDecision | null;
}

export interface WatchListingState extends ListingState {
  /** May alert for this watch (identity.ts): a pasted link, or an `exact` verdict. */
  readonly confirmed: boolean;
  readonly condition: string;
  /** `condition_unknown`, `unconfirmed`, `marked_wrong`, `store_caution`, `store_blocked`. */
  readonly flags: readonly string[];
}

export interface WatchState {
  readonly watchId: number;
  readonly status: 'active' | 'paused' | 'archived';
  readonly currency: MinorUnitCurrency | null;
  readonly reference: { readonly price: Money; readonly kind: ReferenceKind } | null;
  /** showWatchPrice over the tracked listings in the watch's currency. */
  readonly best: { readonly listingId: number; readonly shown: ShownPrice } | null;
  readonly listings: readonly WatchListingState[];
  /** The newest event of each kind, whatever its delivery. */
  readonly lastAlert: {
    readonly price_drop: AlertState | null;
    readonly restock: AlertState | null;
  };
  /** The last alert of each kind a channel accepted (the cooldown and watermark rest on these). */
  readonly lastAccepted: {
    readonly price_drop: LastAcceptedAlert | null;
    readonly restock: LastAcceptedAlert | null;
  };
}

function alertState(
  db: Database,
  watchId: number,
  kind: 'price_drop' | 'restock',
): AlertState | null {
  const event = latestEventOf(db, watchId, kind);
  if (event === undefined) return null;
  const deliveries = gatingDeliveries(db, event.id);
  const obs = event.observationId === null ? undefined : observationById(db, event.observationId);
  const currency = obs === undefined ? null : MinorUnitCurrency.safeParse(obs.currency);
  const price: Money | null =
    obs !== undefined && obs.effective !== null && currency?.success
      ? { amountMinor: obs.effective, currency: currency.data }
      : null;
  return {
    eventId: event.id,
    createdAt: event.createdAt,
    listingId: event.listingId,
    observationId: event.observationId,
    price,
    status: deliveryStatus(deliveries),
    gating:
      price === null || event.observationId === null
        ? null
        : gateOnDelivery({
            alert: { kind, observationId: event.observationId, price },
            deliveries,
          }),
  };
}

/** The watch's state for the UI, or null when the watch does not exist. */
export function watchState(
  db: Database,
  watchId: number,
  versions: VerdictVersions = CODE_ONLY_VERSIONS,
): WatchState | null {
  const watch = watchById(db, watchId);
  if (watch === undefined) return null;
  const listings: WatchListingState[] = [];
  for (const m of trackedMembers(db, watchId)) {
    const s = listingState(db, m.listing.id);
    if (s === null) continue;
    const identity = identityOf(db, {
      watch,
      link: m.link,
      listing: m.listing,
      store: m.store,
      versions,
    });
    const flags: string[] = [];
    if (m.listing.condition === 'unknown') flags.push('condition_unknown');
    if (!identity.confirmed) flags.push('unconfirmed');
    if (identity.markedWrong) flags.push('marked_wrong');
    if (m.store.trustTier === 'caution') flags.push('store_caution');
    if (m.store.trustTier === 'blocked') flags.push('store_blocked');
    listings.push({ ...s, confirmed: identity.confirmed, condition: m.listing.condition, flags });
  }
  const currency = watch.currency;
  const best =
    currency === null
      ? null
      : showWatchPrice({
          watchCurrency: currency,
          listings: listings
            .filter((l) => l.confirmed && !l.flags.includes('store_blocked'))
            .map((l) => ({ listingId: l.listingId, state: l.state })),
        }).best;
  const q = (kind: 'price_drop' | 'restock') =>
    lastAcceptedAlert(db, { profileId: watch.profileId, watchId, kind });
  return {
    watchId,
    status: watch.archivedAt !== null ? 'archived' : watch.pausedAt !== null ? 'paused' : 'active',
    currency,
    reference:
      watch.referencePrice !== null && watch.referenceKind !== null && currency !== null
        ? { price: { amountMinor: watch.referencePrice, currency }, kind: watch.referenceKind }
        : null,
    best,
    listings,
    lastAlert: {
      price_drop: alertState(db, watchId, 'price_drop'),
      restock: alertState(db, watchId, 'restock'),
    },
    lastAccepted: { price_drop: q('price_drop'), restock: q('restock') },
  };
}
