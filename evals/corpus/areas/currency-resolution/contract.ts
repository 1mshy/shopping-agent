// Contract for establishing which currency a read price is in (S§2.2, S§2.3, S§5.2 "Currency
// resolution order"; port map S§7 row 1: money.currency_from_text, learned.bare_dollar). The
// function does not exist yet; Phase 1 workstream 2 writes it against these types and the cases.
// It is also the subject of the `converted-price-refusal` and `known-failure-converted-currency`
// areas, which hold its `converted` and `conflict` refusals.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';

/** How a case's expected value was established. */
export type How =
  | 'test assertion'
  | 'reading the function'
  | 'running the function offline'
  | 'spec'
  /** The owner's rulings of 2026-11-23, or a detail the orchestrator settled that day. */
  | 'owner ruling';

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
  /** What the predecessor did and why the spec differs: the case follows the spec. */
  readonly divergence?: string;
  /** Predecessor behaviour the spec does not mention, ported as is. */
  readonly specSilent?: true;
  /** Why a case was added, and anything else that is neither evidence nor a divergence. */
  readonly notes?: string;
}

/**
 * Everything one read says about its money, each as read (untrimmed text, any case), or null
 * when the read has none. Nothing here is a default: a missing source is null.
 */
export interface CurrencyEvidence {
  /** The storefront host, lower case, as the store is keyed (S§4.1 store.host). */
  readonly host: string;
  /**
   * What the platform or adapter states this storefront bills in: Shopify `/cart.js` for the
   * market the URL points at, UCP, the Woo Store API, a keyed API, or a hand-written adapter's
   * per-storefront row (amazon.ca bills CAD, amazon.com bills USD).
   */
  readonly platform: string | null;
  /** schema.org `priceCurrency` (JSON-LD or microdata), or OpenGraph `product:price:currency`. */
  readonly priceCurrency: string | null;
  /** The page's own hreflang or `og:locale` ("en-CA", "fr_CA"). Not the `<html lang>` attribute. */
  readonly locale: string | null;
  /** The store directory's country for this storefront (ISO 3166-1 alpha-2), when it has one. */
  readonly storeCountry: string | null;
  /** The price as displayed beside the figure, to read the currency mark written with it. */
  readonly priceText: string | null;
}

/** Which evidence decided. */
export type CurrencySource =
  | 'platform'
  | 'price_currency'
  | 'price_mark' // an explicit mark on the figure: an ISO code as a whole word, a qualified dollar sign, €, £
  | 'locale'
  | 'host_market' // the market the host names: a country TLD (.ca, .co.uk) or a regional sub-domain (ca.store.…)
  | 'host_name' // the country the host's own words name (napacanada.com)
  | 'store_country';

export const CURRENCY_REFUSAL_CODES = [
  'unknown_currency', // nothing establishes it; the observation keeps currency `unknown`
  'not_a_listing_currency', // a source states a code that is not an ISO 4217 code with a minor unit
  'converted', // the figure's explicit mark names another currency than the one declared, or the site marks it approximate
  'conflict', // a bare "$" on a host that names a market whose dollar is not the declared currency
] as const;
export type CurrencyRefusalCode = (typeof CURRENCY_REFUSAL_CODES)[number];

/**
 * Evidence ranks: an explicit mark on the figure, then a platform declaration (`platform`, then
 * `priceCurrency`), then the page locale, then the ccTLD (settled by the orchestrator 2026-11-23,
 * the owner may overrule). First, the refusals:
 * 1. A figure the site marks as approximate ("approx.", "≈") is `converted`, whatever it names: a
 *    site's "approx." figure is refused (owner's ruling of 2026-11-23).
 * 2. A declared code (`platform`, else `priceCurrency`, trimmed, any case) that is not a listing
 *    currency is refused.
 * 3. A declared currency is checked against the figure: an explicit mark naming another currency
 *    is `converted`; a bare "$" on a host that names a market whose currency differs is
 *    `conflict`.
 * Then the first source that names a currency wins, in rank order:
 * 4. The figure's explicit mark (`price_mark`); when a declaration agrees with it, the mark is
 *    still the source named.
 * 5. Declared: `platform`, else `priceCurrency`.
 * 6. `locale`'s country.
 * 7. The market the host names (a .com names none).
 * 8. The country the host's own name names.
 * 9. `storeCountry`.
 * A bare "$", or a figure with no mark, is never a currency on its own: it falls through to the
 * store's own country (steps 6-9), which is the bare-"$" rule of S§5.2. A Shopify Markets
 * presentment price (the price a market prefix such as /en-ca bills, declared by that market's
 * `/cart.js`) is the shop's own price for that market, not a converted figure (owner's ruling of
 * 2026-11-23).
 */
export type CurrencyResolution =
  | {
      readonly ok: true;
      readonly currency: MinorUnitCurrency;
      readonly source: CurrencySource;
    }
  | {
      readonly ok: false;
      readonly refusal: { readonly code: CurrencyRefusalCode; readonly detail: string };
    };

/** The future function. */
export type ResolveCurrency = (evidence: CurrencyEvidence) => CurrencyResolution;

/** What a case expects: the currency and its source, or the refusal code. */
export type CurrencyExpected =
  | { readonly ok: true; readonly currency: MinorUnitCurrency; readonly source: CurrencySource }
  | { readonly ok: false; readonly code: CurrencyRefusalCode };

export interface CurrencyCase extends CaseMeta {
  readonly input: CurrencyEvidence;
  readonly expected: CurrencyExpected;
}

/** Evidence with every source null, so a case spells out only what its read has. */
export function evidence(
  host: string,
  read: { readonly [K in Exclude<keyof CurrencyEvidence, 'host'>]?: string } = {},
): CurrencyEvidence {
  return {
    host,
    platform: read.platform ?? null,
    priceCurrency: read.priceCurrency ?? null,
    locale: read.locale ?? null,
    storeCountry: read.storeCountry ?? null,
    priceText: read.priceText ?? null,
  };
}

/** A resolution in the shape of a case's expectation (the refusal detail is free text). */
export function asExpected(actual: CurrencyResolution): CurrencyExpected {
  return actual.ok
    ? { ok: true, currency: actual.currency, source: actual.source }
    : { ok: false, code: actual.refusal.code };
}
