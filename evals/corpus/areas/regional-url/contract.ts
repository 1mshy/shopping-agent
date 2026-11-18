// Contract for the user's regional storefront (S§2.3 "the user's market steers the search ...
// regional storefront"; S§5.8 Intake "A pasted foreign-store link is re-registered on the user's
// regional storefront"; port map S§7 row 1: web_discovery.regional_url, StoreAdapter.storefront,
// AmazonAdapter.regional_url). Two functions, both pure: which storefront of a store to search,
// and where a pasted listing link belongs. Phase 1 workstream 6 (intake) writes them.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';

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

/** The user's configured market (S§2.3). Always set: there is no market-less request. */
export interface UserMarket {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  readonly currency: MinorUnitCurrency;
}

/** One storefront of a store that runs several (S§4.1: a store row per host + market). */
export interface Storefront {
  /** Lower-case host without "www." (amazon.ca, ca.store.bambulab.com). */
  readonly host: string;
  /** The country it sells to, or null for a storefront serving several (eu.store.…). */
  readonly country: string | null;
  /** What it bills in. */
  readonly currency: MinorUnitCurrency;
}

/**
 * The storefronts of one store, the primary first. Never empty: a store with one host has no
 * regional choice to make and is not asked.
 */
export type Storefronts = readonly [Storefront, ...Storefront[]];

/**
 * The storefront to search: the first whose country is the user's; else the first that bills the
 * user's currency (a euro-zone shopper on eu.store.…); else the primary.
 */
export interface StorefrontInput {
  readonly market: UserMarket;
  readonly storefronts: Storefronts;
}
export type SearchStorefront = (input: StorefrontInput) => string;

/**
 * Where a pasted listing link belongs. Today only stores whose listing id is shared across their
 * storefronts can be mapped without a fetch: Amazon's ASIN, in /dp/, /gp/product/ or /gp/aw/d/
 * paths. The target is `searchStorefront`'s choice, and only when that storefront sells to the
 * user's country; the rewritten link is `https://www.<host>/dp/<ASIN>`, with no slug, query or
 * ref path. Whether the listing exists there is for the read to find out; intake reads the
 * pasted link as given when the regional one does not resolve.
 */
export interface ListingUrlInput {
  readonly url: string;
  readonly market: UserMarket;
  readonly storefronts: Storefronts;
  /** How a listing is identified across the storefronts. */
  readonly listingId: 'amazon_asin';
}

/** Why a link stays as pasted. Checked in this order. */
export const UNCHANGED_REASONS = [
  'no_storefront_for_market', // the store runs no storefront selling to the user's country
  'no_listing_id', // the link carries no listing id to carry over (a search page)
  'already_regional', // the link is on the user's storefront already
] as const;
export type UnchangedReason = (typeof UNCHANGED_REASONS)[number];

export type ListingUrlResult =
  | { readonly kind: 'rewritten'; readonly url: string }
  | { readonly kind: 'unchanged'; readonly reason: UnchangedReason };
export type RegionalListingUrl = (input: ListingUrlInput) => ListingUrlResult;

export type RegionalUrlCase =
  | (CaseMeta & {
      readonly subject: 'searchStorefront';
      readonly input: StorefrontInput;
      /** The host chosen. */
      readonly expected: string;
    })
  | (CaseMeta & {
      readonly subject: 'regionalListingUrl';
      readonly input: ListingUrlInput;
      readonly expected: ListingUrlResult;
    });
