// Route definitions and payload validators. Paths, parameters and response shapes are taken
// from each platform's current documentation (read 2026-11-17), cited per route. A validator
// checks the documented shape, never the status code.
import type { Validation } from './outcome.ts';

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);

function parse(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

/** Runs `check` on parsed JSON; `check` returns the item count or a failure reason. */
function jsonValidator(check: (v: unknown) => number | string) {
  return (body: string): Validation => {
    const p = parse(body);
    if (!p.ok) return { valid: false, reason: 'not_json' };
    const r = check(p.value);
    return typeof r === 'number' ? { valid: true, items: r } : { valid: false, reason: r };
  };
}

// WooCommerce Store API, products: GET /wp-json/wc/store/v1/products?search=<term>; returns a
// JSON array of products with id, name, permalink and prices{currency_code, price, ...}.
// https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/
// `search=a` is a near-universal term (WordPress matches it as a substring); `per_page=1` keeps
// the answer small.
export const WOO_PATH = '/wp-json/wc/store/v1/products?search=a&per_page=1';
export const validateWoo = jsonValidator((v) => {
  if (!Array.isArray(v)) return 'not_array';
  const good = v.every(
    (p) =>
      isObj(p) &&
      typeof p.id === 'number' &&
      typeof p.name === 'string' &&
      typeof p.permalink === 'string' &&
      isObj(p.prices) &&
      typeof p.prices.currency_code === 'string',
  );
  return good ? v.length : 'product_shape';
});

// Shopify Ajax API, predictive search: GET /{locale}/search/suggest.json?q=<term>
// &resources[type]=product&resources[limit]=1; returns {resources:{results:{products:[...]}}},
// each product with handle, title, url, price.
// https://shopify.dev/docs/api/ajax/reference/predictive-search
// The probe uses the root locale (no market prefix).
export const SUGGEST_PATH =
  '/search/suggest.json?q=a&resources%5Btype%5D=product&resources%5Blimit%5D=1';
export function validateSuggest(body: string): Validation & { handle?: string } {
  const p = parse(body);
  if (!p.ok) return { valid: false, reason: 'not_json' };
  const v = p.value;
  const products =
    isObj(v) && isObj(v.resources) && isObj(v.resources.results)
      ? v.resources.results.products
      : undefined;
  if (!Array.isArray(products)) return { valid: false, reason: 'no_resources.results.products' };
  if (!products.every((x) => isObj(x) && typeof x.handle === 'string')) {
    return { valid: false, reason: 'product_shape' };
  }
  const handle = (products[0] as Json | undefined)?.handle as string | undefined;
  return { valid: true, items: products.length, ...(handle ? { handle, note: handle } : {}) };
}

// Shopify Ajax API, product: GET /{locale}/products/{product-handle}.js; returns the product with
// integer id, handle, and variants[] whose price is an integer.
// https://shopify.dev/docs/api/ajax/reference/product
export const productJsPath = (handle: string) => `/products/${encodeURIComponent(handle)}.js`;
export const validateProductJs = jsonValidator((v) => {
  if (!isObj(v) || typeof v.id !== 'number' || typeof v.handle !== 'string') return 'product_shape';
  if (!Array.isArray(v.variants) || v.variants.length === 0) return 'no_variants';
  const ok = v.variants.every((x) => isObj(x) && Number.isInteger(x.price));
  return ok ? 1 : 'variant_price_shape';
});

// Magento Open Source / Adobe Commerce GraphQL, `products` query at /graphql. Queries may be sent
// as GET with the query in `query` (mutations need POST), and Content-Type: application/json is
// listed as required for all requests.
// https://developer.adobe.com/commerce/webapi/graphql/usage/headers
// https://developer.adobe.com/commerce/webapi/graphql/schema/products/queries/products/
// "Each query must contain a search or filter attribute". The probe filters on price >= 0 rather
// than searching because Magento's default minimum search term length is 3 characters, so no
// short term is catalogue-neutral. Response: data.products{total_count, items[]}.
export const MAGENTO_QUERY =
  '{products(filter:{price:{from:"0"}},pageSize:1){total_count items{name sku url_key price_range{minimum_price{regular_price{value currency}}}}}}';
export const MAGENTO_PATH = `/graphql?query=${encodeURIComponent(MAGENTO_QUERY)}`;
export const validateMagento = jsonValidator((v) => {
  if (!isObj(v)) return 'not_object';
  if (Array.isArray(v.errors) && v.errors.length > 0) {
    const e = v.errors[0] as Json;
    const cat = isObj(e.extensions) ? String(e.extensions.category ?? '') : '';
    return `graphql_error:${cat}:${String(e.message ?? '').slice(0, 80)}`;
  }
  const products = isObj(v.data) ? v.data.products : undefined;
  if (
    !isObj(products) ||
    typeof products.total_count !== 'number' ||
    !Array.isArray(products.items)
  ) {
    return 'no_data.products';
  }
  return products.items.length;
});
