// The Magento 2 platform reader (S§5.2 reader ladder, first rung, after Shopify and WooCommerce):
// one listing's price from the store's GraphQL `products` query, sent as GET (S§5.2), filtered by
// the URL key (or, with no key in the URL, the selector's SKU). Magento 1 has no GraphQL and
// answers 404 there, which is `not_applicable`.
//
// Amounts. GraphQL writes `value` as a JSON number. The reader keeps each number token's source
// text (`./json.ts`) and accepts only a plain non-negative decimal ("56.25", "29"), read exactly by
// `moneyFromDecimal`; an exponent, a sign or a digit beyond the currency's precision is refused,
// never rounded.
//
// Currency. Each figure states its currency. Magento shows other currencies by converting its base
// currency at a rate (a display currency), so the same request asks `currency { base_currency_code }`
// and a figure in another currency than the base is `converted_currency` (S§2.3). With no base
// stated the figures stay as text (currency `unknown`).
//
// Configurable products. The parent's `price_range` spans its variants and is never a variant's
// price. The variant is the one the selector names (option labels, SKU, or the variant's product
// id); Magento URLs do not select one, so with several variants and no selector the answer is
// `variant_not_found`. A non-configurable product whose minimum and maximum final prices differ
// (a bundle, a grouped product) has no one price: `multiple_prices`.
import type {
  EndpointReader,
  ReaderContext,
  ReaderOutcome,
  ReadRequest,
} from '../read/contract.ts';
import {
  amountOf,
  Candidates,
  CONFIDENCE,
  cleanText,
  convertedFrom,
  decodeSegment,
  emptyIdentifiers,
  fetched,
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
  selectorIsEmpty,
  selectorOptions,
  selectVariant,
  thrownFailure,
  type VariantView,
  variantRecord,
} from './common.ts';
import {
  asArray,
  asObject,
  asString,
  getField,
  getPath,
  type JsonObject,
  type JsonValue,
  numberText,
} from './json.ts';

export interface MagentoProductUrl {
  readonly origin: string;
  readonly host: string;
  /** The URL key (decoded, without `.html`), or null when the path carries none. */
  readonly urlKey: string | null;
}

export type MagentoFilter = { readonly urlKey: string } | { readonly sku: string };

const PLAIN_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const PRICE = 'regular_price{value currency}final_price{value currency}';

/** A Magento product URL's key: the last path segment without `.html`. Pure. */
export function parseMagentoProductUrl(raw: string): MagentoProductUrl | null {
  const url = httpUrl(raw);
  if (url === null) return null;
  const segments = url.pathname.split('/').filter((s) => s !== '');
  let urlKey: string | null = null;
  const route = segments.slice(0, 3).join('/').toLowerCase();
  const last = segments[segments.length - 1];
  if (route !== 'catalog/product/view' && last !== undefined) {
    const decoded = decodeSegment(last);
    const key = decoded?.replace(/\.html?$/i, '') ?? '';
    urlKey = key === '' ? null : key;
  }
  return { origin: url.origin, host: url.hostname, urlKey };
}

/** A GraphQL string literal: JSON's escapes are GraphQL's. */
function graphqlString(text: string): string {
  return JSON.stringify(text);
}

/** The one query the reader sends: the product, its variants and the store's base currency. */
export function magentoQuery(filter: MagentoFilter): string {
  const condition =
    'urlKey' in filter
      ? `url_key:{eq:${graphqlString(filter.urlKey)}}`
      : `sku:{eq:${graphqlString(filter.sku)}}`;
  return (
    `{products(filter:{${condition}},pageSize:2){items{__typename id name sku url_key stock_status ` +
    `price_range{minimum_price{${PRICE}}maximum_price{${PRICE}}} ` +
    `... on ConfigurableProduct{configurable_options{attribute_code label} ` +
    `variants{attributes{code label} product{id sku stock_status price_range{minimum_price{${PRICE}}}}}}}} ` +
    'currency{base_currency_code}}'
  );
}

/** `/graphql?query=…` on the store's origin: a GET, so it is cacheable (S§5.2). */
export function magentoRequestUrl(origin: string, filter: MagentoFilter): string {
  return `${origin}/graphql?query=${encodeURIComponent(magentoQuery(filter))}`;
}

function idText(value: JsonValue | undefined): string | null {
  const text = numberText(value) ?? asString(value);
  return text !== null && /^[0-9A-Za-z=_-]{1,64}$/.test(text.trim()) ? text.trim() : null;
}

function availabilityOf(value: JsonValue | undefined): 'in' | 'out' | 'unknown' {
  const status = asString(value);
  if (status === 'IN_STOCK') return 'in';
  if (status === 'OUT_OF_STOCK') return 'out';
  return 'unknown';
}

/** A price node's figure: its value's source text and its currency, as written. */
function figure(node: JsonValue | undefined): {
  value: string | 'missing' | 'bad';
  currency: string | null;
} {
  const object = asObject(node);
  const raw = getField(object, 'value');
  const currency = cleanText(asString(getField(object, 'currency')), 16);
  if (raw === undefined || raw === null) return { value: 'missing', currency };
  const text = numberText(raw);
  return { value: text !== null && PLAIN_DECIMAL.test(text) ? text : 'bad', currency };
}

function figureText(node: JsonValue | undefined): string | null {
  const raw = getField(asObject(node), 'value');
  return numberText(raw) ?? asString(raw);
}

interface Chosen {
  readonly title: string | null;
  readonly product: JsonObject;
  readonly prices: JsonValue | undefined;
  /** The maximum price node of a non-configurable product, checked for a range. */
  readonly maximum: JsonValue | undefined;
  readonly variant: Readonly<Record<string, string>>;
}

function priced(
  request: ReadRequest,
  host: string,
  base: string | null,
  chosen: Chosen,
): ReaderOutcome {
  const finalNode = getField(asObject(chosen.prices), 'final_price');
  const regularNode = getField(asObject(chosen.prices), 'regular_price');
  const final = figure(finalNode);
  const regular = figure(regularNode);
  const seen = new Candidates();
  const finalText = figureText(finalNode);
  if (finalText !== null) {
    seen.add(`final_price ${finalText} ${final.currency ?? '?'}`, CONFIDENCE.sticker);
  }
  if (regular.value !== 'missing' && regular.value !== 'bad') {
    seen.add(`regular_price ${regular.value} ${regular.currency ?? '?'}`, CONFIDENCE.reference);
  }
  const availability = availabilityOf(getField(chosen.product, 'stock_status'));
  const fields = {
    title: chosen.title,
    identifiers: {
      ...emptyIdentifiers(),
      sku: cleanText(asString(getField(chosen.product, 'sku')), 256),
      externalId: idText(getField(chosen.product, 'id')),
    },
    variant: chosen.variant,
    availability,
  } as const;

  if (final.value === 'bad') {
    return noRead('unreadable_price', 'magento: final_price is not a plain decimal', seen.list);
  }
  if (final.value === 'missing') {
    if (availability !== 'out') return noRead('no_price', 'magento: no final_price', seen.list);
  } else if (/^0(?:\.0+)?$/.test(final.value)) {
    return noRead('no_price', 'magento: a zero price is a placeholder, not a price', seen.list);
  }

  const currency = platformCurrency(host, final.currency);
  if (!currency.ok || base === null) {
    return platformRead({
      ...fields,
      currency: 'unknown',
      sticker: null,
      referenceClaimed: null,
      candidates: seen.list,
    });
  }
  if (base.toUpperCase() !== currency.currency) {
    return noRead(
      'converted_currency',
      `magento: the figure is in ${currency.currency}, the store's base currency is ${base}`,
      seen.list,
    );
  }
  const converted = convertedFrom(request, currency.currency);
  if (converted !== null) return noRead('converted_currency', `magento: ${converted}`, seen.list);

  let sticker: number | null = null;
  if (final.value !== 'missing') {
    const amount = amountOf(final.value, currency.currency);
    if (!amount.ok) {
      return noRead(
        'unreadable_price',
        `magento ${currency.currency}: ${amount.detail}`,
        seen.list,
      );
    }
    sticker = amount.minor;
  }
  if (chosen.maximum !== undefined && chosen.maximum !== null && sticker !== null) {
    const top = figure(getField(asObject(chosen.maximum), 'final_price'));
    if (top.value !== 'missing') {
      const amount = top.value === 'bad' ? null : amountOf(top.value, currency.currency);
      if (
        amount === null ||
        !amount.ok ||
        amount.minor !== sticker ||
        top.currency !== final.currency
      ) {
        if (top.value !== 'bad') {
          seen.add(`maximum final_price ${top.value} ${top.currency ?? '?'}`, CONFIDENCE.other);
        }
        return noRead('multiple_prices', 'magento: the product has a price range', seen.list);
      }
    }
  }
  let referenceClaimed: number | null = null;
  if (
    sticker !== null &&
    regular.value !== 'missing' &&
    regular.value !== 'bad' &&
    regular.currency === final.currency
  ) {
    const amount = amountOf(regular.value, currency.currency);
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

interface VariantEntry {
  readonly product: JsonObject;
  /** Attribute code to the value's label. */
  readonly attributes: readonly (readonly [string, string])[];
}

function configurable(
  request: ReadRequest,
  host: string,
  base: string | null,
  item: JsonObject,
  title: string | null,
): ReaderOutcome {
  const options: { code: string; label: string | null }[] = [];
  for (const o of (asArray(getField(item, 'configurable_options')) ?? []).slice(0, 32)) {
    const option = asObject(o);
    const code = cleanText(asString(getField(option, 'attribute_code')), 100);
    if (code !== null) {
      options.push({ code, label: cleanText(asString(getField(option, 'label')), 100) });
    }
  }
  const entries: VariantEntry[] = [];
  for (const v of asArray(getField(item, 'variants')) ?? []) {
    const product = asObject(getField(asObject(v), 'product'));
    if (product === null) continue;
    const attributes: [string, string][] = [];
    for (const a of (asArray(getField(asObject(v), 'attributes')) ?? []).slice(0, 32)) {
      const code = cleanText(asString(getField(asObject(a), 'code')), 100);
      const label = cleanText(asString(getField(asObject(a), 'label')), 200);
      if (code !== null && label !== null) attributes.push([code, label]);
    }
    entries.push({ product, attributes });
  }
  const codeFor = (name: string): string =>
    options.find((o) => (o.label !== null && sameText(o.label, name)) || sameText(o.code, name))
      ?.code ?? name;
  const views: VariantView[] = entries.map((entry) => ({
    id: idText(getField(entry.product, 'id')),
    sku: cleanText(asString(getField(entry.product, 'sku')), 256),
    matchesOption(name, value) {
      const code = codeFor(name);
      const pair = entry.attributes.find(([c]) => sameText(c, code));
      return pair !== undefined && sameText(pair[1], value);
    },
  }));
  const selection = selectVariant(views, request.variant, null);
  if (!selection.ok) {
    const seen = new Candidates();
    for (const entry of entries) {
      const node = getPath(entry.product, 'price_range', 'minimum_price', 'final_price');
      const text = figureText(node);
      if (text !== null) {
        const sku = cleanText(asString(getField(entry.product, 'sku')), 64) ?? '?';
        const currency = figure(node).currency ?? '?';
        seen.add(`variant ${sku} final_price ${text} ${currency}`, CONFIDENCE.other);
      }
    }
    return noRead('variant_not_found', `magento: ${selection.detail}`, seen.list);
  }
  const entry = entries[selection.index] as VariantEntry;
  const variant = variantRecord(
    entry.attributes.map(([code, label]) => [
      options.find((o) => sameText(o.code, code))?.label ?? code,
      label,
    ]),
  );
  return priced(request, host, base, {
    title,
    product: entry.product,
    prices: getPath(entry.product, 'price_range', 'minimum_price'),
    maximum: undefined,
    variant,
  });
}

async function read(request: ReadRequest, context: ReaderContext): Promise<ReaderOutcome> {
  const parsed = parseMagentoProductUrl(request.url);
  if (parsed === null) return notApplicable();
  const sku = request.variant?.sku?.trim() || null;
  const filter: MagentoFilter | null =
    parsed.urlKey !== null ? { urlKey: parsed.urlKey } : sku !== null ? { sku } : null;
  if (filter === null) return notApplicable();

  const url = magentoRequestUrl(parsed.origin, filter);
  const result = await safeGet(() => context.get({ url, rung: 'api' }));
  if ('thrown' in result) return thrownFailure('magento graphql: the request threw');
  const answer = fetched(result, 'magento graphql', true);
  if (!answer.ok) return answer.outcome;
  const json = readJson(answer.response);
  if (!json.ok) return notApplicable();

  const root = asObject(json.value);
  const data = asObject(getField(root, 'data'));
  const items = asArray(getPath(data, 'products', 'items'));
  if (items === null) {
    const errors = asArray(getField(root, 'errors'));
    const message = asString(getField(asObject(errors?.[0]), 'message'));
    if (message !== null) {
      return noRead('no_price', `magento graphql error: ${cleanText(message, 160) ?? ''}`, []);
    }
    return notApplicable();
  }
  const matching = items
    .slice(0, 10)
    .map(asObject)
    .filter((item): item is JsonObject => {
      if (item === null) return false;
      const own =
        'urlKey' in filter ? asString(getField(item, 'url_key')) : asString(getField(item, 'sku'));
      const wanted = 'urlKey' in filter ? filter.urlKey : filter.sku;
      return own !== null && sameText(own, wanted);
    });
  if (matching.length === 0) return notApplicable();
  if (matching.length > 1) {
    const seen = new Candidates();
    for (const item of matching) {
      const text = figureText(getPath(item, 'price_range', 'minimum_price', 'final_price'));
      if (text !== null) seen.add(`final_price ${text}`, CONFIDENCE.other);
    }
    return noRead('multiple_prices', `magento: ${matching.length} products match`, seen.list);
  }
  const item = matching[0] as JsonObject;
  const base = cleanText(asString(getPath(data, 'currency', 'base_currency_code')), 16);
  const title = cleanText(asString(getField(item, 'name')), 500);
  const variants = asArray(getField(item, 'variants'));
  if (
    asString(getField(item, '__typename')) === 'ConfigurableProduct' ||
    (variants?.length ?? 0) > 0
  ) {
    return configurable(request, parsed.host, base, item, title);
  }

  // Not configurable: the product itself, if the selector (when given) names it.
  const selector = request.variant;
  if (!selectorIsEmpty(selector)) {
    const id = selector?.variantId?.trim() || null;
    const ownSku = cleanText(asString(getField(item, 'sku')), 256);
    const fits =
      (id === null || id === idText(getField(item, 'id'))) &&
      (sku === null || (ownSku !== null && sameText(ownSku, sku))) &&
      selectorOptions(selector).length === 0;
    if (!fits) {
      return noRead(
        'variant_not_found',
        'magento: the selector names no variant of this product',
        [],
      );
    }
  }
  return priced(request, parsed.host, base, {
    title,
    product: item,
    prices: getPath(item, 'price_range', 'minimum_price'),
    maximum: getPath(item, 'price_range', 'maximum_price'),
    variant: {},
  });
}

/**
 * Applies, without a request, only when the store directory says the store runs Magento and the
 * URL carries a key (or the selector a SKU). An unknown platform is left to the other readers.
 * The directory's hints do not carry the Magento generation, so a Magento 1 store costs one
 * request, answered 404 (`not_applicable`).
 */
function applies(request: ReadRequest): boolean {
  if (platformOf(request) !== 'magento') return false;
  const parsed = parseMagentoProductUrl(request.url);
  if (parsed === null) return false;
  return parsed.urlKey !== null || (request.variant?.sku?.trim() ?? '') !== '';
}

export const magentoReader: EndpointReader = { method: PLATFORM_METHOD, applies, read };
