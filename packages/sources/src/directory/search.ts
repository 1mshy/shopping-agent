import type { FetchOutcome } from '@agentic-dasher/shared';
import { asArray, asString, getPath, parseJson } from '../platform/json.ts';
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
  const { outcome, response } = await context.get({ url: endpoint.href, rung: 'api' });
  if (response?.status === 417 || outcome.kind === 'not_found') return { kind: 'unsupported' };
  if (outcome.kind !== 'ok' || response === null) return { kind: 'fetch_failed', outcome };
  const final = URL.parse(response.finalUrl);
  if (final?.origin !== origin || final.pathname !== endpoint.pathname)
    return { kind: 'invalid_response' };
  const parsed = parseJson(response.text);
  const products = parsed.ok
    ? asArray(getPath(parsed.value, 'resources', 'results', 'products'))
    : null;
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
