import { asArray, asString, getPath } from '../platform/json.ts';
import type { ReaderContext } from '../read/contract.ts';
import { storeUrl } from './evidence.ts';
import {
  type DirectoryCandidate,
  readSearchJson,
  type StoreSearch,
  type StoreSearchResult,
} from './search.ts';

/** Best Buy Canada public search. Its product records supply leads for the normal direct reader. */
export async function searchBestBuyCanada(
  input: StoreSearch,
  context: ReaderContext,
): Promise<StoreSearchResult> {
  if (input.origin !== 'https://www.bestbuy.ca' || input.market.country !== 'CA')
    return { kind: 'unsupported' };
  const endpoint = new URL('/api/v2/json/search', input.origin);
  const lang = input.market.language.toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
  endpoint.search = new URLSearchParams({
    query: input.query,
    lang,
    pageSize: '10',
    page: '1',
  }).toString();
  const result = await readSearchJson(endpoint, context);
  if (result.kind !== 'json') return result;
  const rows = asArray(getPath(result.data, 'products'));
  if (!rows) return { kind: 'invalid_response' };
  const candidates: DirectoryCandidate[] = [];
  for (const row of rows.slice(0, 10)) {
    const title = asString(getPath(row, 'name'))?.trim();
    const sku = asString(getPath(row, 'sku'));
    const url = storeUrl(asString(getPath(row, 'productUrl')) ?? '', endpoint);
    const match = url?.pathname.match(
      /^\/(en-ca\/product|fr-ca\/produit)\/(?:[^/]+\/)?(\d{6,12})\/?$/i,
    );
    if (!url || !title || !match || match[2] !== sku) continue;
    // Marketplace offers do not establish a first-party listing or its reference price.
    if (getPath(row, 'isMarketplace') !== false) continue;
    candidates.push({
      url: url.href,
      title,
      storeHost: url.hostname,
      marketPrefix: '/' + match[1]?.slice(0, 5).toLowerCase(),
      sku,
      brand: asString(getPath(row, 'brandName')),
      mpn: asString(getPath(row, 'modelNumber')),
      gtin: asString(getPath(row, 'upcNumber')),
      variant: {},
    });
  }
  return { kind: 'results', candidates };
}
