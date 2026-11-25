// The user's regional storefront (S§2.3 "the user's market steers the search ... regional
// storefront"; S§5.8 Intake "a pasted foreign-store link is re-registered on the user's regional
// storefront"; port map S§7 row 1: StoreAdapter.storefront, AmazonAdapter.regional_url). Pure:
// the storefronts come from the store directory.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import { countryCode } from '../currency/countries.ts';
import { normaliseHost } from '../currency/host.ts';

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

/** The storefronts of one store, the primary first. */
export type Storefronts = readonly [Storefront, ...Storefront[]];

export interface StorefrontInput {
  readonly market: UserMarket;
  readonly storefronts: Storefronts;
}

/**
 * The storefront to search: the first whose country is the user's; else the first that bills the
 * user's currency (a euro-zone shopper on eu.store.…); else the primary.
 */
export function searchStorefront(input: StorefrontInput): string {
  return chooseStorefront(input).host;
}

function chooseStorefront({ market, storefronts }: StorefrontInput): Storefront {
  const country = countryCode(market.country);
  const byCountry = storefronts.find((s) => country !== null && countryCode(s.country) === country);
  if (byCountry !== undefined) return byCountry;
  const byCurrency = storefronts.find((s) => s.currency === market.currency);
  return byCurrency ?? storefronts[0];
}

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
  'no_listing_id', // the link carries no listing id to carry over (a search page, another host)
  'already_regional', // the link is on the user's storefront already
] as const;
export type UnchangedReason = (typeof UNCHANGED_REASONS)[number];

export type ListingUrlResult =
  | { readonly kind: 'rewritten'; readonly url: string }
  | { readonly kind: 'unchanged'; readonly reason: UnchangedReason };

// An Amazon listing path: /dp/<ASIN>, /gp/product/<ASIN>, /gp/aw/d/<ASIN>, after any slug.
const ASIN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=[/?#]|$)/i;

/**
 * Where a pasted listing link belongs. Only stores whose listing id is shared across storefronts
 * can be mapped without a fetch: Amazon's ASIN. The target is `searchStorefront`'s choice, and
 * only when it sells to the user's country; the link becomes `https://www.<host>/dp/<ASIN>` with
 * no slug, query or ref path. Whether the listing exists there is for the read to find out. A link
 * that is not an http(s) URL on one of the store's storefronts carries no listing id of this store.
 */
export function regionalListingUrl(input: ListingUrlInput): ListingUrlResult {
  const target = chooseStorefront(input);
  const country = countryCode(input.market.country);
  if (country === null || countryCode(target.country) !== country) {
    return { kind: 'unchanged', reason: 'no_storefront_for_market' };
  }
  const parsed = typeof input.url === 'string' ? URL.parse(input.url) : null;
  const host = parsed === null ? null : normaliseHost(parsed.hostname);
  const onStore =
    parsed !== null &&
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    host !== null &&
    input.storefronts.some((s) => normaliseHost(s.host) === host);
  const asin = onStore ? ASIN_PATH.exec(parsed.pathname)?.[1] : undefined;
  if (asin === undefined || input.listingId !== 'amazon_asin') {
    return { kind: 'unchanged', reason: 'no_listing_id' };
  }
  if (host === normaliseHost(target.host)) return { kind: 'unchanged', reason: 'already_regional' };
  return {
    kind: 'rewritten',
    url: `https://www.${normaliseHost(target.host)}/dp/${asin.toUpperCase()}`,
  };
}
