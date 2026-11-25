// The WooCommerce platform reader (S§5.2 reader ladder, first rung, after Shopify): one listing's
// price from the public Store API, `/wp-json/wc/store/v1/products`, by slug or by post id.
//
// Amounts. The Store API writes every amount as a string of digits in minor units, with the
// currency (`currency_code`) and the number of decimals the shop is set to (`currency_minor_unit`)
// beside them. The digits are read as text, placed at that many decimals and handed to
// `moneyFromDecimal` with the stated currency, so a shop set to another precision than ISO 4217's
// is converted only when no value is lost (USD at 0 decimals: "15" is 1500 cents; JPY at 2: "150000"
// is ¥1500) and refused otherwise ("150050" is half a yen). No float touches an amount.
//
// Variable products. The parent's `prices` (its lowest variation, and `price_range`) is never the
// price of a variant. The variation is resolved from the selector, or else from the URL's
// `attribute_*` parameters (WooCommerce writes them into a variation's link) or `variation_id`,
// and its own prices are read from `/products/<variation id>`, the Store API's documented route for
// one product on the same host. Nothing selected among several variations is `variant_not_found`.
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
  decimalFromScaled,
  decodeEntities,
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
  asBoolean,
  asObject,
  asString,
  getField,
  type JsonObject,
  type JsonValue,
  numberText,
} from './json.ts';

export const WOO_STORE_API = '/wp-json/wc/store/v1/products';

export interface WooProductUrl {
  readonly origin: string;
  readonly host: string;
  /** The product slug (decoded), from `?product=` or the last path segment; null with an id. */
  readonly slug: string | null;
  /** The post id from `?p=`, as digits. */
  readonly id: string | null;
  /** `?variation_id=`, as digits. */
  readonly variationId: string | null;
  /** The URL's `attribute_<name>=<value>` pairs, the `attribute_` prefix removed. */
  readonly attributes: readonly (readonly [string, string])[];
}

const DIGITS = /^[0-9]{1,18}$/;
const AMOUNT = /^[0-9]{1,18}$/;

/** A WooCommerce product URL: a slug or a post id, and any variation attributes. Pure. */
export function parseWooProductUrl(raw: string): WooProductUrl | null {
  const url = httpUrl(raw);
  if (url === null) return null;
  const query = url.searchParams;
  const p = query.get('p')?.trim() ?? '';
  const id = DIGITS.test(p) ? p : null;
  const variation = query.get('variation_id')?.trim() ?? '';
  const attributes: [string, string][] = [];
  for (const [key, value] of query) {
    const lower = key.toLowerCase();
    if (lower.startsWith('attribute_') && lower.length > 10 && value.trim() !== '') {
      attributes.push([lower.slice(10), value.trim()]);
    }
  }
  let slug: string | null = null;
  if (id === null) {
    const named = query.get('product')?.trim() ?? '';
    if (named !== '' && decodeSegment(encodeURIComponent(named)) !== null) slug = named;
    else {
      const segments = url.pathname.split('/').filter((s) => s !== '');
      const last = segments[segments.length - 1];
      slug = last === undefined ? null : decodeSegment(last);
    }
  }
  if (id === null && slug === null) return null;
  return {
    origin: url.origin,
    host: url.hostname,
    slug,
    id,
    variationId: DIGITS.test(variation) ? variation : null,
    attributes: attributes.slice(0, 16),
  };
}

function idText(value: JsonValue | undefined): string | null {
  const text = numberText(value) ?? asString(value);
  return text !== null && DIGITS.test(text.trim()) ? text.trim() : null;
}

/** An amount as digits, `missing` (absent, null or ""), or `bad` (anything else). */
function amountDigits(value: JsonValue | undefined): string | 'missing' | 'bad' {
  if (value === undefined || value === null) return 'missing';
  const text = numberText(value) ?? asString(value);
  if (text === null) return 'bad';
  const trimmed = text.trim();
  if (trimmed === '') return 'missing';
  return AMOUNT.test(trimmed) ? trimmed : 'bad';
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** An attribute name in one form: "attribute_pa_color", "pa_color" and "Color" are all "color". */
function attributeKey(name: string): string {
  return decoded(name)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^attribute_/, '')
    .replace(/^pa_/, '')
    .replace(/[\s_]+/g, '-');
}

interface Term {
  readonly name: string;
  readonly slug: string;
}

interface ProductAttributes {
  /** Any form of an attribute's name or taxonomy, to the key of its name. */
  readonly aliases: ReadonlyMap<string, string>;
  /** The terms of each attribute, by the key of its name. */
  readonly terms: ReadonlyMap<string, readonly Term[]>;
  /** The display name of each attribute, by key. */
  readonly names: ReadonlyMap<string, string>;
}

function productAttributes(product: JsonObject): ProductAttributes {
  const aliases = new Map<string, string>();
  const terms = new Map<string, Term[]>();
  const names = new Map<string, string>();
  for (const entry of (asArray(getField(product, 'attributes')) ?? []).slice(0, 64)) {
    const attribute = asObject(entry);
    const name = cleanText(asString(getField(attribute, 'name')), 100);
    if (name === null) continue;
    const key = attributeKey(name);
    names.set(key, name);
    aliases.set(key, key);
    const taxonomy = asString(getField(attribute, 'taxonomy'));
    if (taxonomy !== null && taxonomy.trim() !== '') aliases.set(attributeKey(taxonomy), key);
    const list: Term[] = [];
    for (const t of (asArray(getField(attribute, 'terms')) ?? []).slice(0, 500)) {
      const term = asObject(t);
      const termName = cleanText(asString(getField(term, 'name')), 200);
      const slug = cleanText(asString(getField(term, 'slug')), 200);
      if (termName !== null && slug !== null) list.push({ name: decodeEntities(termName), slug });
    }
    terms.set(key, list);
  }
  return { aliases, terms, names };
}

interface VariationEntry {
  readonly id: string;
  /** Attribute key to the value the variation fixes; "" means any value. */
  readonly values: ReadonlyMap<string, string>;
  /** Attribute key to the name as the variation writes it. */
  readonly labels: ReadonlyMap<string, string>;
}

function variationEntries(product: JsonObject, attrs: ProductAttributes): VariationEntry[] {
  const out: VariationEntry[] = [];
  for (const entry of asArray(getField(product, 'variations')) ?? []) {
    const variation = asObject(entry);
    const id = idText(getField(variation, 'id'));
    if (id === null) continue;
    const values = new Map<string, string>();
    const labels = new Map<string, string>();
    for (const a of (asArray(getField(variation, 'attributes')) ?? []).slice(0, 16)) {
      const attribute = asObject(a);
      const name = cleanText(asString(getField(attribute, 'name')), 100);
      const value = asString(getField(attribute, 'value'));
      if (name === null || value === null) continue;
      const key = attrs.aliases.get(attributeKey(name)) ?? attributeKey(name);
      values.set(key, value.trim());
      labels.set(key, name);
    }
    out.push({ id, values, labels });
  }
  return out;
}

function valueMatches(have: string, wanted: string, terms: readonly Term[] | undefined): boolean {
  if (have === '') return true;
  if (sameText(decoded(have), decoded(wanted))) return true;
  return (terms ?? []).some(
    (t) => sameText(decoded(t.slug), decoded(have)) && sameText(t.name, decoded(wanted)),
  );
}

function variationView(entry: VariationEntry, attrs: ProductAttributes): VariantView {
  return {
    id: entry.id,
    sku: null,
    matchesOption(name, value) {
      const key = attrs.aliases.get(attributeKey(name)) ?? attributeKey(name);
      const have = entry.values.get(key);
      return have !== undefined && valueMatches(have, value, attrs.terms.get(key));
    },
  };
}

/** The options of the variation read, by the names the store writes, values as term names. */
function variationOptions(
  entry: VariationEntry,
  attrs: ProductAttributes,
  requested: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  const entries: [string, string][] = [];
  for (const [key, have] of entry.values) {
    const name = attrs.names.get(key) ?? entry.labels.get(key) ?? key;
    let value: string | null = have;
    if (have === '') {
      // "Any" value: the variation takes the value the request named.
      const asked = requested.find(
        ([n]) => (attrs.aliases.get(attributeKey(n)) ?? attributeKey(n)) === key,
      );
      value = asked?.[1] ?? null;
    } else {
      const term = (attrs.terms.get(key) ?? []).find((t) =>
        sameText(decoded(t.slug), decoded(have)),
      );
      value = term?.name ?? decoded(have);
    }
    if (value !== null) entries.push([name, value]);
  }
  return variantRecord(entries);
}

interface Priced {
  readonly item: JsonObject;
  readonly title: string | null;
  readonly variant: Readonly<Record<string, string>>;
}

function priced(
  request: ReadRequest,
  host: string,
  { item, title, variant }: Priced,
): ReaderOutcome {
  const prices = asObject(getField(item, 'prices'));
  const code = cleanText(asString(getField(prices, 'currency_code')), 16);
  const unitText = numberText(getField(prices, 'currency_minor_unit'));
  const unit = unitText !== null && /^[0-9]$/.test(unitText) ? Number(unitText) : null;
  const rawPrice = getField(prices, 'price');
  const price = amountDigits(rawPrice);
  const regular = amountDigits(getField(prices, 'regular_price'));
  const label = `(minor unit ${unitText ?? '?'}${code === null ? '' : `, ${code}`})`;
  const seen = new Candidates();
  if (price !== 'missing') {
    const text =
      price === 'bad' ? (numberText(rawPrice) ?? asString(rawPrice) ?? '(not digits)') : price;
    seen.add(`price ${text} ${label}`, CONFIDENCE.sticker);
  }
  if (regular !== 'missing' && regular !== 'bad') {
    seen.add(`regular_price ${regular} ${label}`, CONFIDENCE.reference);
  }
  const inStock = asBoolean(getField(item, 'is_in_stock'));
  const purchasable = asBoolean(getField(item, 'is_purchasable'));
  const availability =
    inStock === false ? 'out' : inStock === true && purchasable !== false ? 'in' : 'unknown';
  const fields = {
    title,
    identifiers: {
      ...emptyIdentifiers(),
      sku: cleanText(asString(getField(item, 'sku')), 256),
      externalId: idText(getField(item, 'id')),
    },
    variant,
    availability,
  } as const;

  if (price === 'bad') {
    return noRead('unreadable_price', 'woo: the price is not a string of digits', seen.list);
  }
  if (price === 'missing') {
    if (availability !== 'out') {
      return noRead('no_price', 'woo: the product states no price', seen.list);
    }
  } else if (/^0+$/.test(price)) {
    return noRead('no_price', 'woo: a zero price is a placeholder, not a price', seen.list);
  } else if (unit === null) {
    return noRead(
      'unreadable_price',
      `woo: currency_minor_unit ${unitText ?? 'is missing'} is not a decimal count`,
      seen.list,
    );
  }

  const currency = platformCurrency(host, code);
  if (!currency.ok) {
    return platformRead({
      ...fields,
      currency: 'unknown',
      sticker: null,
      referenceClaimed: null,
      candidates: seen.list,
    });
  }
  const converted = convertedFrom(request, currency.currency);
  if (converted !== null) return noRead('converted_currency', `woo: ${converted}`, seen.list);

  let sticker: number | null = null;
  if (price !== 'missing' && unit !== null) {
    const amount = amountOf(decimalFromScaled(price, unit), currency.currency);
    if (!amount.ok) {
      return noRead(
        'unreadable_price',
        `woo ${currency.currency} at minor unit ${unit}: ${amount.detail}`,
        seen.list,
      );
    }
    sticker = amount.minor;
  }
  let referenceClaimed: number | null = null;
  if (sticker !== null && unit !== null && regular !== 'missing' && regular !== 'bad') {
    const amount = amountOf(decimalFromScaled(regular, unit), currency.currency);
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

function titleOf(product: JsonObject): string | null {
  const name = asString(getField(product, 'name'));
  return name === null ? null : cleanText(decodeEntities(name), 500);
}

/** The parent's figures, kept for the record of a refusal: never a variant's price. */
function parentCandidates(product: JsonObject): Candidates {
  const seen = new Candidates();
  const prices = asObject(getField(product, 'prices'));
  const code = cleanText(asString(getField(prices, 'currency_code')), 16) ?? '?';
  const unit = numberText(getField(prices, 'currency_minor_unit')) ?? '?';
  const price = amountDigits(getField(prices, 'price'));
  if (price !== 'missing' && price !== 'bad') {
    seen.add(`parent price ${price} (minor unit ${unit}, ${code})`, CONFIDENCE.other);
  }
  const range = asObject(getField(prices, 'price_range'));
  for (const key of ['min_amount', 'max_amount']) {
    const amount = amountDigits(getField(range, key));
    if (amount !== 'missing' && amount !== 'bad') {
      seen.add(`price_range ${key} ${amount} (minor unit ${unit}, ${code})`, CONFIDENCE.other);
    }
  }
  return seen;
}

async function getJson(
  context: ReaderContext,
  url: string,
  what: string,
  first: boolean,
): Promise<{ ok: true; value: JsonValue } | { ok: false; outcome: ReaderOutcome }> {
  const result = await safeGet(() => context.get({ url, rung: 'api' }));
  if ('thrown' in result)
    return { ok: false, outcome: thrownFailure(`${what}: the request threw`) };
  const answer = fetched(result, what, first);
  if (!answer.ok) return answer;
  const json = readJson(answer.response);
  if (!json.ok) {
    return {
      ok: false,
      outcome: first
        ? notApplicable()
        : noRead('no_price', `${what}: the answer is not JSON (${json.error})`, []),
    };
  }
  return { ok: true, value: json.value };
}

async function read(request: ReadRequest, context: ReaderContext): Promise<ReaderOutcome> {
  const parsed = parseWooProductUrl(request.url);
  if (parsed === null) return notApplicable();
  const base = `${parsed.origin}${WOO_STORE_API}`;
  const first =
    parsed.id !== null
      ? `${base}/${parsed.id}`
      : `${base}?slug=${encodeURIComponent(parsed.slug ?? '')}`;
  const answer = await getJson(context, first, 'woo store api', true);
  if (!answer.ok) return answer.outcome;

  // The product: by id, the object with that id; by slug, the one product with that slug.
  let product: JsonObject | null = null;
  if (parsed.id !== null) {
    const object = asObject(answer.value);
    if (object === null || idText(getField(object, 'id')) !== parsed.id) return notApplicable();
    product = object;
  } else {
    const list = asArray(answer.value);
    if (list === null) return notApplicable();
    const wanted = decoded(parsed.slug ?? '');
    const matches = list
      .slice(0, 100)
      .map(asObject)
      .filter((p): p is JsonObject => {
        const slug = asString(getField(p, 'slug'));
        return p !== null && slug !== null && sameText(decoded(slug), wanted);
      });
    if (matches.length === 0) return notApplicable();
    if (matches.length > 1) {
      const seen = new Candidates();
      for (const m of matches)
        for (const c of parentCandidates(m).list) seen.add(c.value, c.confidence);
      return noRead('multiple_prices', `woo: ${matches.length} products have this slug`, seen.list);
    }
    product = matches[0] as JsonObject;
  }

  const type = asString(getField(product, 'type'));
  const attrs = productAttributes(product);
  const entries = variationEntries(product, attrs);
  const selector = request.variant;
  const selectorSku = selector?.sku?.trim() || null;

  // Not variable: the product itself, if the selector (when given) names it.
  if (type !== 'variable' && entries.length === 0) {
    if (!selectorIsEmpty(selector)) {
      const id = selector?.variantId?.trim() || null;
      const sku = cleanText(asString(getField(product, 'sku')), 256);
      const fits =
        (id === null || id === idText(getField(product, 'id'))) &&
        (selectorSku === null || (sku !== null && sameText(sku, selectorSku))) &&
        selectorOptions(selector).length === 0;
      if (!fits) {
        return noRead(
          'variant_not_found',
          'woo: the selector names no variant of this product',
          parentCandidates(product).list,
        );
      }
    }
    if (type !== 'variation' && asObject(getPrices(product, 'price_range')) !== null) {
      return noRead(
        'multiple_prices',
        `woo: a ${type ?? 'product'} with a price range has no one price`,
        parentCandidates(product).list,
      );
    }
    return priced(request, parsed.host, { item: product, title: titleOf(product), variant: {} });
  }

  // Variable: resolve exactly one variation, then read its own prices.
  const hasOtherField =
    (selector?.variantId?.trim() ?? '') !== '' || selectorOptions(selector).length > 0;
  if (selectorSku !== null && !hasOtherField) {
    return noRead(
      'variant_not_found',
      'woo: a SKU alone cannot select a variation; the parent lists no variation SKUs',
      parentCandidates(product).list,
    );
  }
  const withoutSku = selector === null ? null : { ...selector, sku: undefined };
  const selection = selectVariant(
    entries.map((e) => variationView(e, attrs)),
    withoutSku,
    { id: parsed.variationId, options: parsed.attributes },
  );
  if (!selection.ok) {
    return noRead('variant_not_found', `woo: ${selection.detail}`, parentCandidates(product).list);
  }
  const entry = entries[selection.index] as VariationEntry;
  const second = await getJson(context, `${base}/${entry.id}`, 'woo store api variation', false);
  if (!second.ok) return second.outcome;
  const variation = asObject(second.value);
  const parentId = idText(getField(product, 'id'));
  const statedParent = getField(variation, 'parent');
  if (
    variation === null ||
    idText(getField(variation, 'id')) !== entry.id ||
    (statedParent !== undefined && idText(statedParent) !== parentId)
  ) {
    return noRead(
      'variant_not_found',
      `woo: /products/${entry.id} is not a variation of this product`,
      [],
    );
  }
  if (selectorSku !== null) {
    const sku = cleanText(asString(getField(variation, 'sku')), 256);
    if (sku === null || !sameText(sku, selectorSku)) {
      return noRead('variant_not_found', 'woo: the selected variation has another SKU', []);
    }
  }
  const requested = selectorIsEmpty(selector) ? parsed.attributes : selectorOptions(selector);
  return priced(request, parsed.host, {
    item: variation,
    title: titleOf(product),
    variant: variationOptions(entry, attrs, requested),
  });
}

function getPrices(product: JsonObject, key: string): JsonValue | undefined {
  return getField(asObject(getField(product, 'prices')), key);
}

/**
 * Applies, without a request, only when the store directory says the store runs WooCommerce and
 * the URL names a slug or a post id. An unknown platform is left to the other readers: the Store
 * API is not worth a blind probe on every product page.
 */
function applies(request: ReadRequest): boolean {
  return platformOf(request) === 'woo' && parseWooProductUrl(request.url) !== null;
}

export const wooReader: EndpointReader = { method: PLATFORM_METHOD, applies, read };
