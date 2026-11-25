// Which currency a read price is in (S§2.2, S§2.3, S§5.2 "Currency resolution order"; port map
// S§7 row 1: money.currency_from_text, learned.bare_dollar, web_discovery.converted). There is no
// default currency: when nothing establishes one, the answer is a refusal and the observation keeps
// currency `unknown` with the text in its raw candidates. Nothing is ever converted.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import { minorUnitExponent } from '../money.ts';
import { normaliseText } from '../pricetext/normalise.ts';
import { type MarkToken, scan } from '../pricetext/scan.ts';
import { APPROXIMATE } from '../pricetext/words.ts';
import { countryCode, currencyForCountry } from './countries.ts';
import { hostMarket, hostNameCountry } from './host.ts';
import { parseLocaleTag } from './locale.ts';

/**
 * Everything one read says about its money, each as read (untrimmed, any case), or null when the
 * read has none. Nothing here is a default.
 */
export interface CurrencyEvidence {
  /** The storefront host, lower case (S§4.1 store.host). */
  readonly host: string;
  /** What the platform or adapter states this storefront bills in (/cart.js, UCP, an adapter row). */
  readonly platform: string | null;
  /** schema.org `priceCurrency`, or OpenGraph `product:price:currency`. */
  readonly priceCurrency: string | null;
  /** The page's own hreflang or og:locale ("en-CA", "fr_CA"), not `<html lang>`. */
  readonly locale: string | null;
  /** The store directory's country for this storefront (ISO 3166-1 alpha-2). */
  readonly storeCountry: string | null;
  /** The price as displayed, to read the currency mark written with the figure. */
  readonly priceText: string | null;
}

/** Which evidence decided. */
export type CurrencySource =
  | 'platform'
  | 'price_currency'
  | 'price_mark'
  | 'locale'
  | 'host_market'
  | 'host_name'
  | 'store_country';

export const CURRENCY_REFUSAL_CODES = [
  'unknown_currency', // nothing establishes it; the observation keeps currency `unknown`
  'not_a_listing_currency', // a source states a code that is not an ISO 4217 code with a minor unit
  'converted', // the figure's mark names another currency than the declared one, or the site marks it approximate
  'conflict', // a family mark ("$", "¥", "kr") the store's market or declaration contradicts, or marks naming two currencies
] as const;
export type CurrencyRefusalCode = (typeof CURRENCY_REFUSAL_CODES)[number];

export type CurrencyResolution =
  | { readonly ok: true; readonly currency: MinorUnitCurrency; readonly source: CurrencySource }
  | {
      readonly ok: false;
      readonly refusal: { readonly code: CurrencyRefusalCode; readonly detail: string };
    };

const MAX_TEXT = 2000;

function refuse(code: CurrencyRefusalCode, detail: string): CurrencyResolution {
  return { ok: false, refusal: { code, detail } };
}

function found(currency: MinorUnitCurrency, source: CurrencySource): CurrencyResolution {
  return { ok: true, currency, source };
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asListingCurrency(code: string): MinorUnitCurrency | null {
  return minorUnitExponent(code as MinorUnitCurrency).ok ? (code as MinorUnitCurrency) : null;
}

function short(value: string): string {
  return value.length > 24 ? `"${value.slice(0, 24)}…"` : `"${value}"`;
}

/**
 * Resolves the currency of one read, in the order the orchestrator settled on 2026-11-23 (an
 * explicit mark on the figure, then a platform declaration, then the page locale, then the ccTLD):
 *
 * 1. A figure the site marks as approximate ("approx.", "≈", "~$25") is `converted`.
 * 2. A declared code (`platform`, else `priceCurrency`; trimmed, any case) that is not an ISO 4217
 *    code with a minor unit is refused.
 * 3. The figure's marks are checked: marks naming two currencies are a `conflict`; with a
 *    declaration, an explicit mark naming another currency is `converted`, and so is a family
 *    mark the declared currency is not in ("$" beside EUR); a family mark on a host that names a
 *    market billing another currency than the declared one is a `conflict` (outillage.ca
 *    declaring USD beside "$219.99").
 * 4. The explicit mark (`price_mark`), 5. the declaration (`platform`, `price_currency`), then the
 *    store's own country: 6. the locale's region, 7. the market the host names, 8. the country the
 *    host's words name, 9. `storeCountry`. The first source that names a currency decides; a family
 *    mark ("$" alone) never decides on its own, and must belong to the currency the store's country
 *    gives it, or the read is a `conflict`.
 *
 * A Shopify Markets presentment price (declared by the market's own /cart.js) is the shop's price
 * for that market, not a conversion (owner's ruling of 2026-11-23). Never throws.
 */
export function resolveCurrency(evidence: CurrencyEvidence): CurrencyResolution {
  let fields: Partial<Record<keyof CurrencyEvidence, unknown>>;
  try {
    fields = {
      host: evidence.host,
      platform: evidence.platform,
      priceCurrency: evidence.priceCurrency,
      locale: evidence.locale,
      storeCountry: evidence.storeCountry,
      priceText: evidence.priceText,
    };
  } catch {
    return refuse('unknown_currency', 'the evidence could not be read');
  }
  const priceText = text(fields.priceText);
  if (priceText !== null && priceText.length > MAX_TEXT) {
    return refuse('unknown_currency', `price text of ${priceText.length} characters is not read`);
  }
  const normalised = priceText === null ? '' : normaliseText(priceText).text;

  // 1. A site's own approximation.
  if (APPROXIMATE.test(normalised.toLowerCase())) {
    return refuse('converted', `${short(normalised)} is marked approximate: a conversion`);
  }

  // 2. The declaration.
  const platform = text(fields.platform);
  const declaredRaw = platform ?? text(fields.priceCurrency);
  const declaredSource: CurrencySource = platform !== null ? 'platform' : 'price_currency';
  let declared: MinorUnitCurrency | null = null;
  if (declaredRaw !== null) {
    declared = asListingCurrency(declaredRaw.toUpperCase());
    if (declared === null) {
      return refuse(
        'not_a_listing_currency',
        `${short(declaredRaw)} is not a currency a listing can carry`,
      );
    }
  }

  // 3. The marks on the figure against each other and against the declaration.
  const marks: readonly MarkToken[] = normalised === '' ? [] : scan(normalised).marks;
  const named = [...new Set(marks.flatMap((m) => (m.info.names === null ? [] : [m.info.names])))];
  const families = marks.filter((m) => m.info.kind !== 'explicit');
  if (named.length > 1) {
    return declared !== null && named.some((code) => code !== declared)
      ? refuse(
          'converted',
          `the figure names ${named.join(' and ')}, the store declares ${declared}`,
        )
      : refuse('conflict', `the figure names ${named.join(' and ')}`);
  }
  const mark = named[0] ?? null;
  for (const family of families) {
    if (mark !== null && !family.info.compatible.has(mark)) {
      return refuse('conflict', `"${family.text}" is not ${mark}`);
    }
  }
  const hostCountry = hostMarket(fields.host);
  if (declared !== null) {
    if (mark !== null && !marks.every((m) => m.info.compatible.has(declared))) {
      return refuse('converted', `the figure is marked ${mark}, the store declares ${declared}`);
    }
    if (mark === null && families.length > 0) {
      const family = families[0];
      if (family !== undefined && !family.info.compatible.has(declared)) {
        return refuse('converted', `"${family.text}" is never ${declared}`);
      }
      const hostCurrency = currencyForCountry(hostCountry);
      if (hostCurrency !== null && hostCurrency !== declared) {
        return refuse(
          'conflict',
          `a bare "${family?.text ?? '$'}" on a ${hostCurrency} host beside a ${declared} declaration`,
        );
      }
    }
  }

  // 4. The explicit mark.
  if (mark !== null) {
    const currency = asListingCurrency(mark);
    if (currency === null) return refuse('not_a_listing_currency', `${mark} has no minor unit`);
    return found(currency, 'price_mark');
  }
  // 5. The declaration.
  if (declared !== null) return found(declared, declaredSource);

  // 6-9. The store's own country.
  const fallbacks: readonly (readonly [CurrencySource, string | null])[] = [
    ['locale', parseLocaleTag(fields.locale)?.region ?? null],
    ['host_market', hostCountry],
    ['host_name', hostNameCountry(fields.host)],
    ['store_country', countryCode(fields.storeCountry)],
  ];
  for (const [source, country] of fallbacks) {
    const currency = currencyForCountry(country);
    if (currency === null) continue;
    const family = families.find((f) => !f.info.compatible.has(currency));
    if (family !== undefined) {
      return refuse('conflict', `"${family.text}" is never ${currency}, which the ${source} gives`);
    }
    return found(currency, source);
  }
  return refuse('unknown_currency', 'nothing in the read says which currency it is in');
}
