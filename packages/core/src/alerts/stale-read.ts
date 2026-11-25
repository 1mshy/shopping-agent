// Stale and failed reads (S§2 invariant 10: "A failed read never refreshes a price, never alerts,
// and never overwrites the last known state"; S§6 gate "stale shown as current"). Two pure
// decisions: what one read does to a listing's remembered state, and which price a watch shows as
// current. The corpus area `stale-read` is their definition of done.
//
// Readings chosen where the corpus leaves a choice:
// - A price is `current` exactly when the listing's latest read produced it: the last read did not
//   fail and was taken at the price's own `observedAt`. Anything else is `stale`.
// - An observed read with no price (sold out, no figure) writes an observation, resets the error
//   streak and runs the alert rules (restock needs to see `out`), but keeps the last price, which
//   is then older than the latest read and shown `stale`.
// - A read older than the listing's last read is refused (RangeError): applying it would overwrite
//   newer state. A read at the same instant is applied after it.
// - `showWatchPrice` orders: current and not known out of stock first; then not known out of stock;
//   then the rest; within a tier by price, then current before stale, then input order.
import type {
  Availability,
  Id,
  MinorUnitCurrency,
  Money,
  ReadFailureCause,
  ReadMethod,
  Rung,
  Timestamp,
} from '@agentic-dasher/shared';
import { assertCount, assertMinor, assertPriceMoney, timestampMs } from './exact.ts';

/** The last price read from the listing, with the observation it came from. */
export interface LastPrice {
  readonly price: Money;
  readonly observationId: Id;
  readonly observedAt: Timestamp;
}

/** What the engine remembers about one listing between reads (S§4.1 listing and listing_check). */
export interface ListingReadState {
  /** Never replaced by a failed read. */
  readonly lastPrice: LastPrice | null;
  /** Last known stock; a failed read or an `unknown` read leaves it as it was. */
  readonly lastKnownAvailability: Availability;
  /** `listing_check.last_read_at`: the latest attempt, observed or failed. */
  readonly lastReadAt: Timestamp | null;
  readonly lastReadFailed: boolean;
  /** S§4.1 listing.consecutive_errors; above zero exactly when `lastReadFailed`. */
  readonly consecutiveErrors: number;
}

/** One read of a listing, as the reader returns it. */
export type ListingReadResult =
  | {
      readonly kind: 'observed';
      readonly observationId: Id;
      readonly at: Timestamp;
      /** A read in currency `unknown` carries no Money, so it is not this shape. */
      readonly currency: MinorUnitCurrency;
      /** Integer minor units; null for an out-of-stock read with no price. */
      readonly price: number | null;
      readonly availability: Availability;
      readonly readPath: ReadMethod;
      readonly rung: Rung;
    }
  | {
      readonly kind: 'failed';
      readonly at: Timestamp;
      readonly cause: ReadFailureCause;
      readonly rung: Rung;
    };

/** How a price is shown: from the latest read (`current`), older and labelled (`stale`), or none. */
export type ShownPrice =
  | {
      readonly freshness: 'current' | 'stale';
      readonly price: Money;
      /** When the price was read: never the time of a later failed read. */
      readonly asOf: Timestamp;
      readonly availability: Availability;
    }
  | { readonly freshness: 'none' };

export interface ApplyReadInput {
  /** Null for a listing never read before. */
  readonly state: ListingReadState | null;
  readonly read: ListingReadResult;
}

export interface ApplyReadResult {
  readonly state: ListingReadState;
  /** A failed read writes no observation (S§4.1). */
  readonly writesObservation: boolean;
  /** Whether alert rules run on this read; a failed read never alerts (S§2.10). */
  readonly evaluatesAlerts: boolean;
  /** How the listing's price is shown after this read. */
  readonly shown: ShownPrice;
}

export interface WatchPriceInput {
  readonly watchCurrency: MinorUnitCurrency;
  readonly listings: readonly { readonly listingId: Id; readonly state: ListingReadState }[];
}

export interface WatchPriceResult {
  /** The price the watch shows as its current best; null when no listing has one. */
  readonly best: { readonly listingId: Id; readonly shown: ShownPrice } | null;
}

function checkState(state: ListingReadState, what: string): void {
  assertCount(state.consecutiveErrors, `${what}.consecutiveErrors`);
  if (state.lastReadFailed !== state.consecutiveErrors > 0) {
    throw new RangeError(`${what}: lastReadFailed and consecutiveErrors disagree`);
  }
  const lastRead =
    state.lastReadAt === null ? null : timestampMs(state.lastReadAt, `${what}.lastReadAt`);
  if (state.lastPrice !== null) {
    assertPriceMoney(state.lastPrice.price, `${what}.lastPrice.price`);
    const priced = timestampMs(state.lastPrice.observedAt, `${what}.lastPrice.observedAt`);
    if (lastRead === null || priced > lastRead) {
      throw new RangeError(`${what}: the last price is newer than the last read`);
    }
  }
}

function shownOf(state: ListingReadState): ShownPrice {
  const last = state.lastPrice;
  if (last === null) return { freshness: 'none' };
  const current = !state.lastReadFailed && state.lastReadAt === last.observedAt;
  return {
    freshness: current ? 'current' : 'stale',
    price: { amountMinor: last.price.amountMinor, currency: last.price.currency },
    asOf: last.observedAt,
    availability: state.lastKnownAvailability,
  };
}

/**
 * What one read does to the listing's remembered state. A failed read keeps the last price and the
 * last known stock, counts the error, writes no observation, evaluates no alert, and leaves the kept
 * price shown `stale`. An observed read writes an observation, runs the alert rules, resets the
 * error streak, replaces the last price when it has one and keeps the last known stock when it says
 * `unknown`. Refuses with a RangeError an inconsistent state, a read older than the last read, a
 * malformed timestamp or a negative or unsafe amount.
 */
export function applyRead(input: ApplyReadInput): ApplyReadResult {
  const { state, read } = input;
  const at = timestampMs(read.at, 'read.at');
  if (state !== null) {
    checkState(state, 'state');
    if (state.lastReadAt !== null && at < Date.parse(state.lastReadAt)) {
      throw new RangeError('read: older than the last read of the listing');
    }
  }
  const lastPrice = state?.lastPrice ?? null;
  const lastKnown = state?.lastKnownAvailability ?? 'unknown';

  if (read.kind === 'failed') {
    const next: ListingReadState = {
      lastPrice,
      lastKnownAvailability: lastKnown,
      lastReadAt: read.at,
      lastReadFailed: true,
      consecutiveErrors: (state?.consecutiveErrors ?? 0) + 1,
    };
    return { state: next, writesObservation: false, evaluatesAlerts: false, shown: shownOf(next) };
  }
  if (read.kind !== 'observed') throw new TypeError('read: unknown read kind');

  if (read.price !== null) assertMinor(read.price, 'read.price');
  const next: ListingReadState = {
    lastPrice:
      read.price === null
        ? lastPrice
        : {
            price: { amountMinor: read.price, currency: read.currency },
            observationId: read.observationId,
            observedAt: read.at,
          },
    lastKnownAvailability: read.availability === 'unknown' ? lastKnown : read.availability,
    lastReadAt: read.at,
    lastReadFailed: false,
    consecutiveErrors: 0,
  };
  return { state: next, writesObservation: true, evaluatesAlerts: true, shown: shownOf(next) };
}

/**
 * The price a watch shows as its current best, among listings whose last price is in the watch's
 * currency: the cheapest current price not known to be out of stock; failing that, the cheapest
 * remembered price, preferring one not known to be out of stock, shown with its own freshness. A
 * stale price is never shown as current. Refuses with a RangeError an inconsistent listing state.
 */
export function showWatchPrice(input: WatchPriceInput): WatchPriceResult {
  type Ranked = {
    readonly listingId: Id;
    readonly shown: Extract<ShownPrice, { freshness: 'current' | 'stale' }>;
    readonly tier: number;
  };
  let best: Ranked | null = null;
  for (const [i, listing] of input.listings.entries()) {
    checkState(listing.state, `listings[${i}].state`);
    const shown = shownOf(listing.state);
    if (shown.freshness === 'none' || shown.price.currency !== input.watchCurrency) continue;
    const notOut = shown.availability !== 'out';
    const tier = shown.freshness === 'current' && notOut ? 0 : notOut ? 1 : 2;
    const candidate: Ranked = { listingId: listing.listingId, shown, tier };
    if (best === null || ahead(candidate, best)) best = candidate;
  }
  return { best: best === null ? null : { listingId: best.listingId, shown: best.shown } };
}

function ahead(
  a: {
    readonly tier: number;
    readonly shown: { readonly price: Money; readonly freshness: string };
  },
  b: {
    readonly tier: number;
    readonly shown: { readonly price: Money; readonly freshness: string };
  },
): boolean {
  if (a.tier !== b.tier) return a.tier < b.tier;
  if (a.shown.price.amountMinor !== b.shown.price.amountMinor) {
    return a.shown.price.amountMinor < b.shown.price.amountMinor;
  }
  return a.shown.freshness === 'current' && b.shown.freshness === 'stale';
}
