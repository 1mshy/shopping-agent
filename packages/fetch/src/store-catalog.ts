// The only non-GET operation the public fetcher supports. The merchant advertises this
// storefront MCP binding; the caller supplies buyer context, never a tool name or RPC body.
import { CountryCode, LanguageTag, MinorUnitCurrency } from '@agentic-dasher/shared';

export interface StoreCatalogSearch {
  readonly query: string;
  readonly country: string;
  readonly currency: string;
  readonly language: string;
}

export const STORE_CATALOG_LIMIT = 10;
export const STORE_CATALOG_MAX_BYTES = 512 * 1024;
const PROFILE =
  'https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@agent-profile-v1/lab/catalog/agent-profile.json';

export function isStoreCatalogEndpoint(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.hostname.replace(/\.$/, '') !== 'catalog.shopify.com' &&
    raw === `${url.origin}/api/ucp/mcp`
  );
}

export function validStoreCatalogSearch(search: StoreCatalogSearch): boolean {
  return (
    typeof search.query === 'string' &&
    search.query.length <= 512 &&
    search.query.trim().length > 0 &&
    CountryCode.safeParse(search.country).success &&
    MinorUnitCurrency.safeParse(search.currency).success &&
    LanguageTag.safeParse(search.language).success
  );
}

export function storeCatalogBody(endpoint: string, search: StoreCatalogSearch): string {
  if (!isStoreCatalogEndpoint(endpoint) || !validStoreCatalogSearch(search))
    throw new RangeError('Invalid storefront catalog search');
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        meta: { 'ucp-agent': { profile: PROFILE } },
        catalog: {
          query: search.query.trim(),
          context: {
            address_country: search.country,
            currency: search.currency,
            language: search.language,
          },
          pagination: { limit: STORE_CATALOG_LIMIT },
        },
      },
    },
  });
}
