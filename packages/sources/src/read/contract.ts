// The reader contract (S§5.2 "Reader ladder"): what a reader is asked, what it answers, and the two
// shapes a reader has. Written once, before the readers, so the platform readers and the
// structured-data readers can be built side by side.
//
// A reader turns what a store says into what was read: amounts as integer minor units of the
// currency the store bills in, with every figure it saw kept as text (S§2.1, S§2.2, S§4.1). It
// never derives `effective` or `landed` (packages/core does), never converts a currency, never
// picks a default currency and never guesses between two prices: with no clear answer it says so.
import type { PageResponse, PageResult, ReaderGetRequest } from '@agentic-dasher/fetch';
import type {
  Availability,
  Condition,
  ListingCurrency,
  MinorUnitCurrency,
  PriceUnit,
  RawCandidate,
  ReadMethod,
  Rung,
  ShippingStatus,
  StorePlatform,
} from '@agentic-dasher/shared';

/** The user's market. It steers every read that can be steered (S§2.3). */
export interface Market {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  readonly currency: MinorUnitCurrency;
  /** BCP 47 language tag. */
  readonly language: string;
}

/** What the store directory knows about the store before the read. Any of it may be unknown. */
export interface StoreHints {
  readonly platform: StorePlatform;
  /** '' when the storefront has no market prefix (S§4.1 store.market_prefix). */
  readonly marketPrefix: string;
  /** ISO 3166-1 alpha-2, upper case; null when unknown. */
  readonly country: string | null;
  readonly baseCurrency: ListingCurrency;
  /** The storefront's locale (BCP 47) when a page or the platform declared one; null when unclear. */
  readonly locale: string | null;
}

/**
 * Which variant the caller wants priced (S§5.2 variant coupling). A reader attaches a price only
 * to the variant this selects, or, with no selector, to the variant the URL itself selects. It
 * never answers with a ProductGroup range, the cheapest option or the first variant instead.
 */
export interface VariantSelector {
  /** The platform's variant id (Shopify `?variant=`, a Woo variation id), as text. */
  readonly variantId?: string;
  readonly sku?: string;
  /** Option names and values as the store writes them ("Capacity": "2TB"). */
  readonly options?: Readonly<Record<string, string>>;
}

export interface ReadRequest {
  /** The listing URL to read. Already through intake normalisation and the regional rewrite. */
  readonly url: string;
  readonly market: Market;
  readonly store: StoreHints | null;
  readonly variant: VariantSelector | null;
}

/** What a reader may use besides its input. Bound to one read by the caller. */
export interface ReaderContext {
  /**
   * One guarded, paced request under the read's deadline. The optional storefront catalog
   * operation is a fixed search; other requests are GETs.
   * `api` for a platform or public JSON endpoint, `http` for a page.
   */
  get(request: ReaderGetRequest): Promise<PageResult>;
  /** Epoch milliseconds. */
  now(): number;
}

/** Identifiers the page or payload states. Text as read, trimmed; never inferred from a title. */
export interface ReadIdentifiers {
  readonly brand: string | null;
  readonly gtin: string | null;
  readonly mpn: string | null;
  readonly sku: string | null;
  /** The platform's own id of the thing priced (a variant id), as text. */
  readonly externalId: string | null;
}

/**
 * One reading of one listing by one method. Field meanings and their rules are those of
 * `price_observation` (S§4.1, packages/shared `PriceObservation`): every amount is integer minor
 * units of `currency`; with currency `unknown` every amount is null and the figures stay as text
 * in `candidates`; a sticker needs at least one candidate.
 */
export interface ListingRead {
  readonly method: ReadMethod;
  /** The rung of the request the price came from. */
  readonly rung: Extract<Rung, 'api' | 'http'>;
  readonly title: string | null;
  readonly identifiers: ReadIdentifiers;
  /** The options of the variant priced, as the store names them. Empty when there are none. */
  readonly variant: Readonly<Record<string, string>>;
  readonly condition: Condition;
  readonly currency: ListingCurrency;
  readonly sticker: number | null;
  /** A struck-through or "was" price: a claim, never a baseline (S§5.5). */
  readonly referenceClaimed: number | null;
  /** The amount off of a coupon the buyer must clip or enter; it never lowers the sticker. */
  readonly coupon: number | null;
  readonly memberPrice: number | null;
  readonly shipping: number | null;
  readonly shippingStatus: ShippingStatus;
  readonly taxIncluded: boolean | null;
  readonly unitPrice: number | null;
  readonly unit: PriceUnit | null;
  readonly availability: Availability;
  /** Every price figure this method saw, as text, with a confidence set by code (S§5.2). */
  readonly candidates: readonly RawCandidate[];
}

/**
 * Why a method that applies read no usable listing. `multiple_prices`: more than one distinct
 * price and no rule picks one (S§5.2). `variant_not_found`: the selector names no variant here,
 * or several and none is selected. `converted_currency`: the figure is in a currency the store
 * converted for the visitor (S§2.3). `unreadable_price`: a figure was there and the price-text
 * rules refused it. `no_price`: the method's data is there and carries no price and no stock
 * signal. `fetch_failed`: the reader's own request did not end `ok` (the outcome says how).
 */
export type NoReadReason =
  | 'multiple_prices'
  | 'variant_not_found'
  | 'converted_currency'
  | 'unreadable_price'
  | 'no_price'
  | 'fetch_failed';

export type ReaderOutcome =
  | { readonly kind: 'read'; readonly read: ListingRead }
  /** This method has nothing of its kind here (no JSON-LD block, not this platform). */
  | { readonly kind: 'not_applicable' }
  | {
      readonly kind: 'no_read';
      readonly method: ReadMethod;
      readonly reason: NoReadReason;
      /** Code-written, for logs and Diagnostics; never shown as a figure. */
      readonly detail: string;
      /** What was seen, kept for the failed read's record. */
      readonly candidates: readonly RawCandidate[];
      /** The fetch result behind a `fetch_failed`, null otherwise. */
      readonly fetch: PageResult['outcome'] | null;
    };

/**
 * A reader that asks an endpoint of its own (platform JSON, a hand-written adapter). It runs
 * before the page is fetched. `applies` is cheap and makes no request.
 */
export interface EndpointReader {
  readonly method: ReadMethod;
  applies(request: ReadRequest): boolean;
  read(request: ReadRequest, context: ReaderContext): Promise<ReaderOutcome>;
}

/** A reader of the fetched page (JSON-LD, microdata, OpenGraph). Pure: no request, no clock. */
export interface DocumentReader {
  readonly method: ReadMethod;
  read(request: ReadRequest, page: PageResponse): ReaderOutcome;
}
