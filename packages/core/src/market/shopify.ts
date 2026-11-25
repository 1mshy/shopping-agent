// Steering a Shopify Markets storefront to the user's market (S§2.3 "Shopify market prefix"; S§5.2
// "Shopify suggest.json under the market prefix"; predecessor stores/shopify.py preferred_market,
// _locale_candidates and the search-result URL rule). One storefront serves several markets behind
// locale path prefixes (/en-ca), each with its own currency and prices. Pure: the caller probes
// `/cart.js` and passes the answers in. A price read under the pinned prefix is the shop's own
// price for that market, not a converted figure (owner's ruling of 2026-11-23).
import type { ListingCurrency } from '@agentic-dasher/shared';
import { countryCode } from '../currency/countries.ts';
import type { UserMarket } from './storefront.ts';

export interface MarketPrefixInput {
  readonly market: UserMarket;
  /** What the storefront's default market (no prefix) bills; `unknown` when it did not say. */
  readonly defaultMarketCurrency: ListingCurrency;
  /** The currency each probed locale's `/cart.js` states, keyed by locale ("en-ca"). */
  readonly cartCurrencies: Readonly<Record<string, string>>;
}

export interface MarketPrefixResult {
  /** "/en-ca", or "" for the default market. */
  readonly prefix: string;
  /** The locales probed, in order. */
  readonly probed: readonly string[];
}

// Locales worth trying for a country beyond the generic en-<cc> and <cc>.
const EXTRA_LOCALES: Readonly<Record<string, readonly string[]>> = {
  CA: ['fr-ca'],
  CH: ['de-ch', 'fr-ch'],
  BE: ['nl-be', 'fr-be'],
};

/** The locales probed for a country, in order: en-<cc>, <cc>, then the country's extra locales. */
export function marketLocaleCandidates(country: string): readonly string[] {
  const code = countryCode(country);
  if (code === null) return [];
  const lower = code.toLowerCase();
  return [`en-${lower}`, lower, ...(EXTRA_LOCALES[code] ?? [])];
}

/**
 * Which market prefix bills the user's currency. When the default market already bills it, nothing
 * is probed and the prefix is "". Otherwise the candidates are probed in order, stopping at the
 * first whose `/cart.js` states the user's currency; one that answers another currency, or did not
 * answer, is passed over. With no match the default market is searched (prefix "").
 */
export function pickMarketPrefix(input: MarketPrefixInput): MarketPrefixResult {
  const wanted = input.market.currency;
  if (input.defaultMarketCurrency === wanted) return { prefix: '', probed: [] };
  const probed: string[] = [];
  for (const locale of marketLocaleCandidates(input.market.country)) {
    probed.push(locale);
    const answer = Object.hasOwn(input.cartCurrencies, locale)
      ? input.cartCurrencies[locale]
      : null;
    if (typeof answer === 'string' && answer.trim().toUpperCase() === wanted) {
      return { prefix: `/${locale}`, probed };
    }
  }
  return { prefix: '', probed };
}

export interface MarketResultUrlInput {
  /** "https://shop.example.com" */
  readonly origin: string;
  /** "/en-ca", or "" for the default market. */
  readonly pinnedPrefix: string;
  /** As suggest.json returned it. */
  readonly path: string;
}

// A Markets locale segment: two letters, optionally "-" and two more.
const LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/i;

/** The locale segment a path starts with, when more path follows it ("/fr-ca/products/x"). */
function localePrefix(path: string): string {
  const match = /^\/([^/?#]+)\/[^/?#]/.exec(path);
  const segment = match?.[1];
  return segment !== undefined && LOCALE_SEGMENT.test(segment) ? `/${segment}` : '';
}

/**
 * The market a locale prefix names: its country ("/fr-ca" is ca). A language alone in a result
 * ("/fr") is the default market in that language. A pinned prefix of two letters is a country:
 * pickMarketPrefix only pins en-<cc>, <cc> or a country's own locales.
 */
function marketOf(prefix: string, pinned: boolean): string {
  const parts = prefix.slice(1).toLowerCase().split('-');
  if (parts.length === 2) return parts[1] ?? '';
  return pinned ? (parts[0] ?? '') : '';
}

/**
 * A search result's URL on a pinned market. A path with no locale gets the pinned prefix (without
 * it, it would be the default market's price list); a path under another locale of the same market
 * (/fr-ca/… from an /en-ca search) is left alone; a path under another market's locale (/en-us/…,
 * or a language-only /fr/…, the default market) is moved to the pinned prefix. A first segment is a
 * locale only when it is two letters, optionally "-" and two more, and more path follows it.
 *
 * An absolute URL on the same origin follows the same rule (the predecessor left it unmoved, which
 * reported a default-market price in the pinned market's currency); one on another origin is
 * returned as it is, for the URL guard to judge.
 */
export function marketResultUrl(input: MarketResultUrlInput): string {
  const origin = input.origin.replace(/\/+$/, '');
  const pinned = input.pinnedPrefix.replace(/\/+$/, '');
  let path = input.path;
  if (!path.startsWith('/') || path.startsWith('//')) {
    const absolute = URL.parse(path, `${origin}/`);
    const base = URL.parse(`${origin}/`);
    if (absolute === null || base === null || absolute.origin !== base.origin) return path;
    path = `${absolute.pathname}${absolute.search}${absolute.hash}`;
  }
  if (pinned === '') return origin + path;
  const own = localePrefix(path);
  if (own === '') return origin + pinned + path;
  if (own.toLowerCase() === pinned.toLowerCase()) return origin + path;
  if (marketOf(own, false) !== '' && marketOf(own, false) === marketOf(pinned, true)) {
    return origin + path;
  }
  return origin + pinned + path.slice(own.length);
}
