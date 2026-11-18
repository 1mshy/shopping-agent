// Contract of stale and failed reads (S§2 invariant 10: "A failed read never refreshes a price,
// never alerts, and never overwrites the last known state"; S§6 gate "stale shown as current";
// predecessor service.py `_upsert_offer`, `list_tracked`, `price_history`). Two pure decisions:
// what one read does to a listing's remembered state, and which price a watch shows as current.
import type {
  Availability,
  FetchOutcomeKind,
  Id,
  MinorUnitCurrency,
  Money,
  ReadMethod,
  Rung,
  Timestamp,
} from '@agentic-dasher/shared';

/** The last price read from the listing, with the observation it came from. */
export interface LastPrice {
  readonly price: Money;
  readonly observationId: Id;
  readonly observedAt: Timestamp;
}

/** What the engine remembers about one listing between reads (S§4.1 listing, derived). */
export interface ListingReadState {
  /** Never replaced by a failed read. */
  readonly lastPrice: LastPrice | null;
  /** Last known stock; a failed read or an `unknown` read leaves it as it was. */
  readonly lastKnownAvailability: Availability;
  readonly lastReadAt: Timestamp | null;
  readonly lastReadFailed: boolean;
  /** S§4.1 listing.consecutive_errors. */
  readonly consecutiveErrors: number;
}

/** Proposed vocabulary: why a read failed (a non-ok fetch, or a page the reader got no price from). */
export type ReadFailureCause = Exclude<FetchOutcomeKind, 'ok'> | 'no_price' | 'multiple_prices';

export type ReadResult =
  | {
      readonly kind: 'observed';
      readonly observationId: Id;
      readonly at: Timestamp;
      /** Cases use known currencies only; a read in currency `unknown` carries no Money. */
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

/**
 * Proposed vocabulary. How a price is shown: `current` (from the listing's latest read), `stale`
 * (an older price, kept because later reads failed: shown only with that label), `none`.
 */
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
  readonly read: ReadResult;
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

/**
 * Subjects (Phase 1, packages/core).
 * `applyRead`: a failed read keeps `lastPrice` and `lastKnownAvailability`, sets `lastReadFailed`,
 * adds one to `consecutiveErrors`, writes no observation, evaluates no alert, and shows the kept
 * price as `stale`. An observed read with a price replaces `lastPrice`, resets the error streak and
 * is shown `current`; with availability `unknown` it keeps the last known stock.
 * `showWatchPrice`: among listings in the watch's currency, the cheapest current price not known to
 * be out of stock; failing that, the cheapest remembered price, preferring one not known to be out
 * of stock, shown with its own freshness. A stale price is never shown as current.
 */
export type ApplyRead = (input: ApplyReadInput) => ApplyReadResult;
export type ShowWatchPrice = (input: WatchPriceInput) => WatchPriceResult;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

interface CaseMeta {
  readonly id: string;
  readonly what: string;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}

export type StaleReadCase =
  | (CaseMeta & {
      readonly subject: 'applyRead';
      readonly input: ApplyReadInput;
      readonly expected: ApplyReadResult;
    })
  | (CaseMeta & {
      readonly subject: 'showWatchPrice';
      readonly input: WatchPriceInput;
      readonly expected: WatchPriceResult;
    });
