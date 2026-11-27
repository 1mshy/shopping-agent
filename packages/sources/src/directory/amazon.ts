import type { ReaderContext } from '../read/contract.ts';
import type { StoreSearch, StoreSearchResult } from './search.ts';
import { readProductLinks } from './template.ts';

const STORES: Readonly<Record<string, string>> = {
  CA: 'amazon.ca',
  US: 'amazon.com',
  DE: 'amazon.de',
  GB: 'amazon.co.uk',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
  JP: 'amazon.co.jp',
  AU: 'amazon.com.au',
  NL: 'amazon.nl',
};
export function amazonStorefront(country: string): string | null {
  const store = Object.hasOwn(STORES, country) && STORES[country];
  return store ? `https://www.${store}` : null;
}
const ASIN_PATH = /\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i;
/** Regional public HTML search. Only direct product links on the requested storefront become leads. */
export async function searchAmazon(
  input: StoreSearch,
  context: ReaderContext,
): Promise<StoreSearchResult> {
  if (input.origin !== amazonStorefront(input.market.country)) return { kind: 'unsupported' };
  const endpoint = new URL('/s', input.origin);
  endpoint.search = new URLSearchParams({ k: input.query }).toString();
  const result = await readProductLinks(input, endpoint, context, ASIN_PATH);
  if (result.kind !== 'results') return result;
  const seen = new Set<string>();
  const candidates = result.candidates.flatMap((candidate) => {
    const asin = new URL(candidate.url).pathname.match(ASIN_PATH)?.[1]?.toUpperCase();
    if (!asin || seen.has(asin)) return [];
    seen.add(asin);
    return [{ ...candidate, url: new URL('/dp/' + asin, input.origin).href, sku: asin }];
  });
  return { kind: 'results', candidates };
}
