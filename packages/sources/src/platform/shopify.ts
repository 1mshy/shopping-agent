// The Shopify platform reader (S§5.1 `api` rung, S§5.2 reader ladder, first rung): one listing's
// price from the storefront's own Ajax product endpoint, `/products/<handle>.js`, read under the
// storefront's market prefix (S§2.3).
//
// Units. The `.js` integers are hundredths of the currency's major unit for every currency
// (Shopify's "cents"): 3699 is 36.99 in a two-decimal currency, and 2288000 is ¥22,880 in a
// zero-decimal one. Shopify documents that for currencies without subunits "tenths and hundredths
// of a unit are appended", and a real JPY product read on 2026-11-24 (fixture
// `shopify/real-jpy.js.json`) showed `.js` 2288000 beside its decimal `.json` view's "22880" JPY.
// A zero-decimal figure that is not a whole number of units is refused. Three-decimal currencies
// (KWD, BHD, …) are refused: hundredths cannot carry their third decimal, and whether Shopify
// drops or rounds it is not established.
//
// Currency. The `.js` payload states no currency. The platform states it, for the same session and
// market as the price, in three places, asked in this order:
//   1. the `cart_currency` cookie Shopify sets on the product response itself (no extra request;
//      set on 142 of the 190 `.js` answers spike C stored);
//   2. the product's decimal `.json` view under the same prefix, whose variants carry
//      `price_currency` beside a decimal `price`; that price must equal the `.js` figure, or the
//      two answers disagree and neither is believed;
//   3. `/cart.js` under the same prefix, the documented fallback only (S§5.2: Shopify's robots
//      disallows it for agents).
// The statement goes through `resolveCurrency` as a platform answer. Nothing else is used: a
// presentment currency depends on the market and the session, so the host, the locale and the
// store's base currency are no evidence, and with no statement the read keeps currency `unknown`
// with the figures as candidates. A Markets presentment price is the shop's own price for that
// market, not a conversion (owner's ruling of 2026-11-23).
import { marketResultUrl, minorUnitExponent } from '@agentic-dasher/core';
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import type {
  EndpointReader,
  ReaderContext,
  ReaderOutcome,
  ReadRequest,
} from '../read/contract.ts';
import {
  type Amount,
  amountOf,
  Candidates,
  CONFIDENCE,
  cleanText,
  decimalFromScaled,
  decodeSegment,
  fetched,
  gtinText,
  httpUrl,
  noRead,
  notApplicable,
  PLATFORM_METHOD,
  platformCurrency,
  platformOf,
  platformRead,
  readJson,
  safeGet,
  sameText,
  selectVariant,
  thrownFailure,
  type VariantView,
  variantRecord,
} from './common.ts';
import {
  asArray,
  asBoolean,
  asObject,
  asString,
  getField,
  type JsonObject,
  type JsonValue,
  numberText,
} from './json.ts';

export interface ShopifyProductUrl {
  /** "https://shop.example.com" */
  readonly origin: string;
  readonly host: string;
  /** The URL's own Markets locale prefix ("/en-ca"), or "". */
  readonly localePrefix: string;
  /** The product handle, decoded. */
  readonly handle: string;
  /** The `?variant=` the URL selects, as text, or null. */
  readonly urlVariant: string | null;
}

const LOCALE_SEGMENT = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const PINNED_PREFIX = /^\/[a-z]{2}(?:-[a-z]{2})?$/i;
const PLAIN_INTEGER = /^[0-9]{1,15}$/;
const MAX_COOKIES = 64;

/**
 * A Shopify product URL: `/products/<handle>`, optionally under a Markets locale prefix
 * (`/en-ca`) and a collection (`/collections/<c>`), with an optional trailing slash. Anything
 * else is null. Pure: no request.
 */
export function parseShopifyProductUrl(raw: string): ShopifyProductUrl | null {
  const url = httpUrl(raw);
  if (url === null) return null;
  const segments = url.pathname.split('/').slice(1);
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  let i = 0;
  let localePrefix = '';
  const first = segments[0];
  if (first !== undefined && LOCALE_SEGMENT.test(first) && segments.length > 1) {
    localePrefix = `/${first.toLowerCase()}`;
    i = 1;
  }
  if (segments[i] === 'collections' && (segments[i + 1] ?? '') !== '') i += 2;
  if (segments[i] !== 'products' || segments.length !== i + 2) return null;
  const decoded = decodeSegment(segments[i + 1] ?? '');
  if (decoded === null) return null;
  const handle = decoded.replace(/\.(?:js|json)$/i, '');
  if (handle === '') return null;
  const variants = [
    ...new Set(
      url.searchParams
        .getAll('variant')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    ),
  ];
  return {
    origin: url.origin,
    host: url.hostname,
    localePrefix,
    handle,
    // Several different ?variant= values select nothing: the joined text matches no id.
    urlVariant: variants.length === 0 ? null : variants.join(','),
  };
}

/** The `.js`, `.json` and `/cart.js` URLs under the market the read must use. */
function endpoints(
  parsed: ShopifyProductUrl,
  request: ReadRequest,
): { product: string; view: string; cart: string } {
  const pinnedRaw = request.store?.marketPrefix ?? '';
  const pinned = typeof pinnedRaw === 'string' && PINNED_PREFIX.test(pinnedRaw) ? pinnedRaw : '';
  const tail = `/products/${encodeURIComponent(parsed.handle)}`;
  const target = marketResultUrl({
    origin: parsed.origin,
    pinnedPrefix: pinned.toLowerCase(),
    path: `${parsed.localePrefix}${tail}`,
  });
  const base = target.endsWith(tail) ? target.slice(0, -tail.length) : parsed.origin;
  return { product: `${base}${tail}.js`, view: `${base}${tail}.json`, cart: `${base}/cart.js` };
}

type CookieEvidence =
  | { readonly kind: 'one'; readonly code: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'conflict' };

/**
 * The currency in the `cart_currency` cookie the response sets. A cookie that clears or expires
 * it is not evidence; two different codes are a conflict.
 */
function cookieCurrency(setCookies: unknown, now: number): CookieEvidence {
  if (!Array.isArray(setCookies)) return { kind: 'none' };
  const codes = new Set<string>();
  for (const raw of setCookies.slice(0, MAX_COOKIES)) {
    if (typeof raw !== 'string') continue;
    const [pair = '', ...attributes] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq).trim() !== 'cart_currency') continue;
    const value = pair
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    let cleared = false;
    for (const attribute of attributes) {
      const [name = '', ...rest] = attribute.split('=');
      const key = name.trim().toLowerCase();
      const text = rest.join('=').trim();
      if (key === 'max-age' && /^-?[0-9]+$/.test(text) && Number(text) <= 0) cleared = true;
      if (key === 'expires') {
        const at = Date.parse(text);
        if (Number.isFinite(at) && at <= now) cleared = true;
      }
    }
    if (!cleared && /^[A-Za-z]{3}$/.test(value)) codes.add(value.toUpperCase());
  }
  if (codes.size === 0) return { kind: 'none' };
  if (codes.size > 1) return { kind: 'conflict' };
  return { kind: 'one', code: [...codes][0] ?? '' };
}

/** A follow-up request's JSON, or null when it did not answer `ok` with JSON. */
async function followUp(
  url: string,
  what: string,
  context: ReaderContext,
): Promise<JsonValue | null> {
  const result = await safeGet(() => context.get({ url, rung: 'api' }));
  if ('thrown' in result) return null;
  const answer = fetched(result, what, false);
  if (!answer.ok) return null;
  const json = readJson(answer.response);
  return json.ok ? json.value : null;
}

function currencyCode(value: JsonValue | undefined): string | null {
  const code = asString(value)?.trim() ?? '';
  return /^[A-Za-z]{3}$/.test(code) ? code : null;
}

/** The `currency` that `/cart.js` states, or null when it did not answer with one. */
async function cartCurrency(url: string, context: ReaderContext): Promise<string | null> {
  return currencyCode(
    getField(asObject(await followUp(url, 'shopify /cart.js', context)), 'currency'),
  );
}

type ViewEvidence =
  | { readonly kind: 'stated'; readonly code: string; readonly price: string | null }
  | { readonly kind: 'none' };

/**
 * The `price_currency` the decimal `.json` view states for the variant read, with that variant's
 * decimal price to check against the `.js` figure.
 */
async function viewCurrency(
  url: string,
  variantId: string | null,
  context: ReaderContext,
): Promise<ViewEvidence> {
  if (variantId === null) return { kind: 'none' };
  const root = await followUp(url, 'shopify product .json', context);
  const variants = asArray(getField(asObject(getField(asObject(root), 'product')), 'variants'));
  for (const entry of variants ?? []) {
    const variant = asObject(entry);
    if (idText(getField(variant, 'id')) !== variantId) continue;
    const code = currencyCode(getField(variant, 'price_currency'));
    if (code === null) return { kind: 'none' };
    const price = asString(getField(variant, 'price')) ?? numberText(getField(variant, 'price'));
    return { kind: 'stated', code, price: price?.trim() ?? null };
  }
  return { kind: 'none' };
}

/** Shopify's hundredths of a unit as minor units of the currency, exactly, or a refusal. */
function fromHundredths(digits: string, currency: MinorUnitCurrency): Amount {
  const exponent = minorUnitExponent(currency);
  if (!exponent.ok) return { ok: false, detail: exponent.refusal.detail };
  if (exponent.value !== 0 && exponent.value !== 2) {
    return {
      ok: false,
      detail: `${currency} has ${exponent.value} decimals; Shopify's .js integers are hundredths of a unit, which cannot carry them`,
    };
  }
  return amountOf(decimalFromScaled(digits, 2), currency);
}

function idText(value: JsonValue | undefined): string | null {
  return numberText(value) ?? cleanText(asString(value), 64);
}

/** The text of an integer price field: digits, or `missing`, or `bad` for anything else. */
function priceDigits(value: JsonValue | undefined): string | 'missing' | 'bad' {
  if (value === undefined || value === null) return 'missing';
  const text = numberText(value) ?? asString(value);
  if (text === null) return 'bad';
  return PLAIN_INTEGER.test(text.trim()) ? text.trim() : 'bad';
}

function optionNames(product: JsonObject): readonly (string | null)[] {
  const options = asArray(getField(product, 'options')) ?? [];
  return options.slice(0, 3).map((option) => {
    const name = asString(option) ?? asString(getField(asObject(option), 'name'));
    return cleanText(name, 100);
  });
}

function optionValues(variant: JsonObject): readonly (string | null)[] {
  const listed = asArray(getField(variant, 'options'));
  return [0, 1, 2].map((i) => {
    const value = asString(getField(variant, `option${i + 1}`)) ?? asString(listed?.[i]);
    return cleanText(value, 200);
  });
}

function isDefaultTitle(name: string | null, value: string): boolean {
  return sameText(value, 'Default Title') && (name === null || sameText(name, 'Title'));
}

function view(variant: JsonObject, names: readonly (string | null)[]): VariantView {
  const values = optionValues(variant);
  return {
    id: idText(getField(variant, 'id')),
    sku: cleanText(asString(getField(variant, 'sku')), 256),
    matchesOption(name, value) {
      for (let i = 0; i < 3; i++) {
        const own = names[i] ?? `option${i + 1}`;
        const have = values[i];
        if (sameText(own, name))
          return have !== null && have !== undefined && sameText(have, value);
      }
      return false;
    },
  };
}

function variantOptions(
  variant: JsonObject,
  names: readonly (string | null)[],
): Readonly<Record<string, string>> {
  const values = optionValues(variant);
  const entries: [string, string][] = [];
  for (let i = 0; i < 3; i++) {
    const value = values[i];
    if (value === null || value === undefined) continue;
    const name = names[i] ?? null;
    if (isDefaultTitle(name, value)) continue;
    entries.push([name ?? `option${i + 1}`, value]);
  }
  return variantRecord(entries);
}

async function read(request: ReadRequest, context: ReaderContext): Promise<ReaderOutcome> {
  const parsed = parseShopifyProductUrl(request.url);
  if (parsed === null) return notApplicable();
  const urls = endpoints(parsed, request);
  const result = await safeGet(() => context.get({ url: urls.product, rung: 'api' }));
  if ('thrown' in result) return thrownFailure('shopify product .js: the request threw');
  const answer = fetched(result, 'shopify product .js', true);
  if (!answer.ok) return answer.outcome;

  // An answer that is not a Shopify product (an HTML page served for the path, a challenge the
  // classifier did not name, truncated JSON) means this endpoint has nothing of its kind here.
  const json = readJson(answer.response);
  if (!json.ok) return notApplicable();
  const product = asObject(json.value);
  const variants = (asArray(getField(product, 'variants')) ?? [])
    .map(asObject)
    .filter((v): v is JsonObject => v !== null);
  if (product === null || variants.length === 0) return notApplicable();

  const names = optionNames(product);
  const selection = selectVariant(
    variants.map((v) => view(v, names)),
    request.variant,
    parsed.urlVariant === null ? null : { id: parsed.urlVariant },
  );
  if (!selection.ok) {
    const seen = new Candidates();
    for (const v of variants) {
      const price = priceDigits(getField(v, 'price'));
      if (price !== 'missing' && price !== 'bad') {
        seen.add(
          `variant ${idText(getField(v, 'id')) ?? '?'} price ${price} (hundredths of a unit)`,
          CONFIDENCE.other,
        );
      }
    }
    return noRead('variant_not_found', `shopify: ${selection.detail}`, seen.list);
  }

  const variant = variants[selection.index] as JsonObject;
  const available = asBoolean(getField(variant, 'available'));
  const availability = available === null ? 'unknown' : available ? 'in' : 'out';
  const rawPrice = getField(variant, 'price');
  const price = priceDigits(rawPrice);
  const compare = priceDigits(getField(variant, 'compare_at_price'));
  const seen = new Candidates();
  const unit = '(hundredths of a unit)';
  if (price !== 'missing') {
    const text =
      price === 'bad' ? (numberText(rawPrice) ?? asString(rawPrice) ?? '(not a number)') : price;
    seen.add(`price ${text} ${unit}`, CONFIDENCE.sticker);
  }
  if (compare !== 'missing' && compare !== 'bad') {
    seen.add(`compare_at_price ${compare} ${unit}`, CONFIDENCE.reference);
  }
  const fields = {
    title: cleanText(asString(getField(product, 'title')), 500),
    identifiers: {
      brand: null,
      gtin: gtinText(asString(getField(variant, 'barcode'))),
      mpn: null,
      sku: cleanText(asString(getField(variant, 'sku')), 256),
      externalId: idText(getField(variant, 'id')),
    },
    variant: variantOptions(variant, names),
    availability,
  } as const;

  if (price === 'bad') {
    return noRead('unreadable_price', 'shopify: the variant price is not an integer', seen.list);
  }
  if (price === 'missing') {
    if (availability !== 'out') {
      return noRead('no_price', 'shopify: the selected variant states no price', seen.list);
    }
  } else if (/^0+$/.test(price)) {
    return noRead('no_price', 'shopify: a zero price is a placeholder, not a price', seen.list);
  }

  // The currency the platform states for this session and market: the cookie on this response,
  // else the `.json` view's price_currency, else /cart.js.
  const unknown = () =>
    platformRead({
      ...fields,
      currency: 'unknown',
      sticker: null,
      referenceClaimed: null,
      candidates: seen.list,
    });
  const evidence = cookieCurrency(answer.response.setCookies, context.now());
  let stated: string | null = null;
  let viewPrice: string | null = null;
  if (evidence.kind === 'one') stated = evidence.code;
  else if (evidence.kind === 'none') {
    const view = await viewCurrency(urls.view, fields.identifiers.externalId, context);
    if (view.kind === 'stated') {
      stated = view.code;
      viewPrice = view.price;
      if (viewPrice !== null) seen.add(`.json price ${viewPrice} ${view.code}`, CONFIDENCE.sticker);
    } else stated = await cartCurrency(urls.cart, context);
  }
  const currency = platformCurrency(parsed.host, stated);
  if (!currency.ok) return unknown();

  let sticker: number | null = null;
  if (price !== 'missing') {
    const amount = fromHundredths(price, currency.currency);
    if (!amount.ok) {
      return noRead(
        'unreadable_price',
        `shopify ${currency.currency}: ${amount.detail}`,
        seen.list,
      );
    }
    sticker = amount.minor;
  }
  if (viewPrice !== null && sticker !== null) {
    // The `.json` view stated the currency beside its own price: both answers must agree.
    const check = amountOf(viewPrice, currency.currency);
    if (!check.ok || check.minor !== sticker) return unknown();
  }
  let referenceClaimed: number | null = null;
  if (sticker !== null && compare !== 'missing' && compare !== 'bad') {
    const amount = fromHundredths(compare, currency.currency);
    if (amount.ok && amount.minor > sticker) referenceClaimed = amount.minor;
  }
  return platformRead({
    ...fields,
    currency: currency.currency,
    sticker,
    referenceClaimed,
    candidates: seen.list,
  });
}

/**
 * Applies, without a request, to a Shopify product path on a store the directory calls Shopify,
 * and on a store whose platform is unknown (one `.js` probe; a host that is not Shopify answers
 * 404, which is `not_applicable`). Never on a store the directory gives another platform.
 */
function applies(request: ReadRequest): boolean {
  const platform = platformOf(request);
  if (platform !== 'shopify' && platform !== 'unknown') return false;
  return parseShopifyProductUrl(request.url) !== null;
}

export const shopifyReader: EndpointReader = { method: PLATFORM_METHOD, applies, read };
