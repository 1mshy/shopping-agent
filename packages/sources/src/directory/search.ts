import type { FetchOutcome } from '@agentic-dasher/shared';
import { asArray, asString, getPath, type JsonValue, parseJson } from '../platform/json.ts';
import type { Market, ReaderContext } from '../read/contract.ts';

/** Unverified search results carry identity evidence. Prices are obtained by the reader ladder. */
export interface DirectoryCandidate {
  url: string;
  storeHost: string;
  marketPrefix: string;
  title: string;
  gtin: string | null;
  mpn: string | null;
  sku: string | null;
  brand: string | null;
  variant: Readonly<Record<string, string>>;
}

export interface StoreSearch {
  origin: string;
  marketPrefix: string;
  query: string;
  market: Market;
}

export type StoreSearchResult =
  | { kind: 'results'; candidates: DirectoryCandidate[] }
  | { kind: 'unsupported' | 'invalid_response' }
  | { kind: 'fetch_failed'; outcome: FetchOutcome };

async function readSearchJson(
  endpoint: URL,
  context: ReaderContext,
  unsupportedStatus?: number,
): Promise<{ kind: 'json'; data: JsonValue } | Exclude<StoreSearchResult, { kind: 'results' }>> {
  const { outcome, response } = await context.get({ url: endpoint.href, rung: 'api' });
  if (
    (unsupportedStatus !== undefined && response?.status === unsupportedStatus) ||
    outcome.kind === 'not_found'
  )
    return { kind: 'unsupported' };
  if (outcome.kind !== 'ok') return { kind: 'fetch_failed', outcome };
  if (response === null) return { kind: 'invalid_response' };
  const final = URL.parse(response.finalUrl);
  if (final?.origin !== endpoint.origin || final.pathname !== endpoint.pathname)
    return { kind: 'invalid_response' };
  const parsed = parseJson(response.text);
  return parsed.ok ? { kind: 'json', data: parsed.value } : { kind: 'invalid_response' };
}

/** Shopify Ajax Predictive Search, scoped to the shop's buyer locale. */
export async function searchShopify(
  input: StoreSearch,
  context: ReaderContext,
): Promise<StoreSearchResult> {
  const origin = new URL(input.origin).origin;
  const endpoint = new URL(`${input.marketPrefix}/search/suggest.json`, origin);
  if (endpoint.origin !== origin) return { kind: 'invalid_response' };
  endpoint.search = new URLSearchParams({
    q: input.query,
    'resources[type]': 'product',
    'resources[limit]': '10',
  }).toString();
  const result = await readSearchJson(endpoint, context, 417);
  if (result.kind !== 'json') return result;
  const products = asArray(getPath(result.data, 'resources', 'results', 'products'));
  if (products === null) return { kind: 'invalid_response' };
  const candidates: DirectoryCandidate[] = [];
  for (const product of products.slice(0, 10)) {
    const title = asString(getPath(product, 'title'))?.trim();
    const raw = asString(getPath(product, 'url'));
    const url = raw && URL.parse(raw, origin);
    if (!title || !url || url.origin !== origin || url.username || url.password) continue;
    if (url.pathname.startsWith('/products/')) url.pathname = input.marketPrefix + url.pathname;
    if (!url.pathname.startsWith(`${input.marketPrefix}/products/`)) continue;
    candidates.push({
      url: url.href,
      storeHost: url.hostname,
      marketPrefix: input.marketPrefix,
      title,
      brand: asString(getPath(product, 'vendor')),
      mpn: null,
      gtin: null,
      sku: null,
      variant: {},
    });
  }
  return { kind: 'results', candidates };
}

/** The WooCommerce Store API exposes published product permalinks without an API key. */
export async function searchWoo(
  input: StoreSearch,
  context: ReaderContext,
): Promise<StoreSearchResult> {
  const origin = new URL(input.origin).origin;
  const endpoint = new URL(`${input.marketPrefix}/wp-json/wc/store/v1/products`, origin);
  if (endpoint.origin !== origin) return { kind: 'invalid_response' };
  endpoint.search = new URLSearchParams({ search: input.query, per_page: '10' }).toString();
  const result = await readSearchJson(endpoint, context);
  if (result.kind !== 'json') return result;
  const rows = asArray(result.data);
  if (rows === null) return { kind: 'invalid_response' };
  const candidates: DirectoryCandidate[] = [];
  for (const row of rows.slice(0, 10)) {
    const title = asString(getPath(row, 'name'))?.trim();
    const raw = asString(getPath(row, 'permalink'));
    const url = raw && URL.parse(raw, origin);
    if (
      !title ||
      !url ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`${input.marketPrefix}/`)
    )
      continue;
    const brands = asArray(getPath(row, 'brands'));
    candidates.push({
      url: url.href,
      storeHost: url.hostname,
      marketPrefix: input.marketPrefix,
      title,
      brand: brands?.length === 1 ? asString(getPath(brands[0], 'name')) : null,
      sku: asString(getPath(row, 'sku')),
      gtin: asString(getPath(row, 'global_unique_id')),
      mpn: null,
      variant: {},
    });
  }
  return { kind: 'results', candidates };
}

/** Magento Open Source 2 uses a public GraphQL GET. Rewrites provide the store's actual URL suffix. */
export async function searchMagento(
  input: StoreSearch & { magentoGeneration: 1 | 2 | null },
  context: ReaderContext,
): Promise<StoreSearchResult> {
  if (input.magentoGeneration !== 2) return { kind: 'unsupported' };
  const origin = new URL(input.origin).origin;
  const base = new URL(`${input.marketPrefix}/`, origin);
  if (base.origin !== origin) return { kind: 'invalid_response' };
  const endpoint = new URL('graphql', base);
  endpoint.search = new URLSearchParams({
    query:
      'query DirectoryProducts($term: String!) { products(search: $term, pageSize: 10) { items { name sku url_rewrites { url } } } }',
    variables: JSON.stringify({ term: input.query }),
  }).toString();
  const result = await readSearchJson(endpoint, context);
  if (result.kind !== 'json') return result;
  if (asArray(getPath(result.data, 'errors'))?.length) return { kind: 'invalid_response' };
  const rows = asArray(getPath(result.data, 'data', 'products', 'items'));
  if (rows === null) return { kind: 'invalid_response' };
  const candidates: DirectoryCandidate[] = [];
  for (const row of rows.slice(0, 10)) {
    const title = asString(getPath(row, 'name'))?.trim();
    const rewrites = asArray(getPath(row, 'url_rewrites')) ?? [];
    if (!title) continue;
    for (const rewrite of rewrites) {
      const path = asString(getPath(rewrite, 'url'))?.trim();
      const url = path && URL.parse(path, base);
      if (
        !url ||
        url.origin !== origin ||
        url.username ||
        url.password ||
        !url.pathname.startsWith(base.pathname) ||
        url.pathname === base.pathname
      )
        continue;
      candidates.push({
        url: url.href,
        storeHost: url.hostname,
        marketPrefix: input.marketPrefix,
        title,
        sku: asString(getPath(row, 'sku')),
        brand: null,
        mpn: null,
        gtin: null,
        variant: {},
      });
      break;
    }
  }
  return { kind: 'results', candidates };
}
