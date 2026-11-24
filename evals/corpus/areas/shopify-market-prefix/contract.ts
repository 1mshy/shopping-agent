// Contract for steering a Shopify Markets storefront to the user's market (S§2.3 "Shopify market
// prefix"; S§5.2 "Shopify suggest.json under the market prefix"; predecessor
// stores/shopify.py preferred_market, _locale_candidates and the search-result URL rule). One
// storefront serves several markets behind locale path prefixes (/en-ca), each with its own
// currency and its own prices. Both functions are pure: the `/cart.js` probes are done by the
// caller and passed in as answers. Phase 1 workstream 3 (in-store search) writes them. A price read
// under the pinned prefix is the shop's own price for that market, not a converted figure (owner's
// ruling of 2026-11-23; currency-resolution shopify-markets-presentment-price-is-the-shops-own).
import type { ListingCurrency, MinorUnitCurrency } from '@agentic-dasher/shared';

/** How a case's expected value was established. */
export type How =
  | 'test assertion'
  | 'reading the function'
  | 'running the function offline'
  | 'spec';

export interface Provenance {
  readonly file: string;
  readonly at: string;
  readonly how: How;
  readonly note?: string;
}

export interface CaseMeta {
  readonly id: string;
  readonly what: string;
  readonly from: readonly Provenance[];
  readonly divergence?: string;
  readonly specSilent?: true;
}

/** The user's configured market (S§2.3). */
export interface UserMarket {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  readonly currency: MinorUnitCurrency;
}

/**
 * Which market prefix bills the user's currency. When the storefront's default market already
 * bills it, nothing is probed and the prefix is "". Otherwise the candidates for the user's
 * country are probed in order, `en-<cc>`, `<cc>`, then the country's extra locales (CA: fr-ca;
 * CH: de-ch, fr-ch; BE: nl-be, fr-be), stopping at the first whose `/cart.js` states the user's
 * currency. A candidate that answers another currency, or does not answer, is passed over.
 */
export interface MarketPrefixInput {
  readonly market: UserMarket;
  /** What the storefront's default market (no prefix) bills; `unknown` when it did not say. */
  readonly defaultMarketCurrency: ListingCurrency;
  /**
   * The currency each probed locale's `/cart.js` states, keyed by locale ("en-ca"). A locale
   * missing here did not answer (404, not JSON, a network error).
   */
  readonly cartCurrencies: Readonly<Record<string, string>>;
}
export interface MarketPrefixResult {
  /** "/en-ca", or "" for the default market. */
  readonly prefix: string;
  /** The locales probed, in order. */
  readonly probed: readonly string[];
}
export type PickMarketPrefix = (input: MarketPrefixInput) => MarketPrefixResult;

/**
 * A search result's URL on a pinned market. suggest.json returns paths. A path with no locale
 * gets the pinned prefix (without it, it would be the default market's price list); a path under
 * another locale of the same market (/fr-ca/… from an /en-ca search) is left alone; a path under
 * another market's locale (/en-us/…, or a language-only /fr/…, which is the default market) is
 * moved to the pinned prefix. A first path segment counts as a locale only when it is two
 * letters, optionally "-" and two more, and more path follows it. (An absolute URL in a result
 * is not covered: the predecessor kept it unmoved, which can leave a result on the default
 * market's price list while it is reported in the pinned market's currency. Open question.)
 */
export interface MarketResultUrlInput {
  /** "https://shop.example.com" */
  readonly origin: string;
  /** "/en-ca", or "" for the default market. */
  readonly pinnedPrefix: string;
  /** As suggest.json returned it. */
  readonly path: string;
}
export type MarketResultUrl = (input: MarketResultUrlInput) => string;

export type ShopifyMarketCase =
  | (CaseMeta & {
      readonly subject: 'pickMarketPrefix';
      readonly input: MarketPrefixInput;
      readonly expected: MarketPrefixResult;
    })
  | (CaseMeta & {
      readonly subject: 'marketResultUrl';
      readonly input: MarketResultUrlInput;
      readonly expected: string;
    });
