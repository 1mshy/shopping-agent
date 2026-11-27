import { createRequestBudget, type Fetcher, type PageResponse } from '@agentic-dasher/fetch';
import type { FetchOutcome, StorePlatform } from '@agentic-dasher/shared';
import {
  asArray,
  asObject,
  asString,
  getField,
  getPath,
  type JsonValue,
  parseJson,
} from '../platform/json.ts';
import type { Market } from '../read/contract.ts';
import { homeEvidence, openSearchTemplate, productSitemap, storeUrl } from './evidence.ts';

export const FINGERPRINT_MAX_REQUESTS = 6;
type Probe = 'home' | 'platform' | 'ucp' | 'opensearch' | 'sitemap' | 'llms';

export interface FingerprintInput {
  readonly origin: string;
  readonly marketPrefix: string;
  readonly market: Market;
  /** Existing evidence from a direct product read, when available. */
  readonly platform?: StorePlatform;
}
export interface StoreFingerprint {
  readonly market: Market;
  readonly platform: StorePlatform;
  readonly platformEvidence:
    | 'home_markup'
    | 'prior_read'
    | 'shopify_suggest'
    | 'woo_store_api'
    | 'magento_graphql'
    | null;
  readonly magentoGeneration: 1 | 2 | null;
  readonly predictiveSearch: boolean | null;
  readonly productMarkup: boolean | null;
  readonly productSitemap: boolean | null;
  readonly llmsTxt: boolean | null;
  readonly ucpCatalogEndpoint: string | null;
  readonly searchAction: string | null;
  readonly openSearchTemplate: string | null;
  readonly wireRequests: number;
  readonly probes: readonly { probe: Probe; outcome: FetchOutcome['kind'] | 'other_storefront' }[];
}

function payload(page: PageResponse | null): JsonValue | null {
  if (!page) return null;
  const parsed = parseJson(page.text, { maxLength: 512 * 1024, maxValues: 20_000 });
  return parsed.ok ? parsed.value : null;
}

function catalogEndpoint(profile: JsonValue | null, home: URL): string | null {
  const cap = asArray(getPath(profile, 'ucp', 'capabilities', 'dev.ucp.shopping.catalog.search'));
  if (!cap?.some((c) => typeof getField(asObject(c), 'version') === 'string')) return null;
  const services = asArray(getPath(profile, 'ucp', 'services', 'dev.ucp.shopping')) ?? [];
  for (const entry of services) {
    const service = asObject(entry);
    if (getField(service, 'transport') !== 'mcp') continue;
    const url = asString(getField(service, 'endpoint'));
    if (url) {
      const endpoint = storeUrl(url, home);
      if (endpoint) return endpoint.href;
    }
  }
  return null;
}

/** Fingerprint one explicitly selected storefront using only the process's guarded fetcher. */
export async function fingerprintStore(
  input: FingerprintInput,
  fetcher: Fetcher,
  options: { readonly deadline: number; readonly signal: AbortSignal },
): Promise<StoreFingerprint> {
  const origin = new URL(input.origin);
  if (
    !/^https?:$/.test(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?$/.test(input.marketPrefix)
  )
    throw new RangeError('Invalid storefront origin or market prefix');
  const home = new URL(`${input.marketPrefix}/`, origin);
  const wireBudget = createRequestBudget(FINGERPRINT_MAX_REQUESTS);
  const probes: { probe: Probe; outcome: FetchOutcome['kind'] | 'other_storefront' }[] = [];
  let stopped = false;
  async function probe(kind: Probe, url: URL, rung: 'http' | 'api' = 'api') {
    if (stopped || options.signal.aborted || wireBudget.remaining === 0) return null;
    const result = await fetcher.get({
      url: url.href,
      rung,
      pageKind: rung === 'api' ? 'api' : 'search',
      deadline: options.deadline,
      signal: options.signal,
      maxBodyBytes: 512 * 1024,
      wireBudget,
    });
    const final = result.response && URL.parse(result.response.finalUrl);
    const marketScoped = kind === 'home' || kind === 'platform';
    const finalPrefix = final?.pathname
      .match(/^\/([a-z]{2}(?:-[a-z]{2})?)(?:\/|$)/i)?.[1]
      ?.toLowerCase();
    const local =
      result.response === null ||
      (final?.origin === origin.origin &&
        (!marketScoped || input.marketPrefix === (finalPrefix ? `/${finalPrefix}` : '')));
    const outcome = result.outcome.kind;
    probes.push({ probe: kind, outcome: local ? outcome : 'other_storefront' });
    if (
      outcome === 'rate_limited' ||
      outcome === 'wall' ||
      outcome === 'refused_by_policy' ||
      (outcome === 'network_error' && !result.response)
    )
      stopped = true;
    return local ? result : null;
  }
  const okPage = (r: Awaited<ReturnType<typeof probe>>) =>
    r?.outcome.kind === 'ok' ? r.response : null;
  const homeResult = await probe('home', home, 'http');
  const page = okPage(homeResult);
  const html =
    page &&
    (/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(page.contentType ?? '') ||
      (!page.contentType && /^\s*<(?:!doctype html|html)\b/i.test(page.text)));
  const facts = html ? homeEvidence(page, new URL(page.finalUrl)) : null;
  let platform = facts?.platform ?? 'unknown';
  let platformEvidence: StoreFingerprint['platformEvidence'] =
    platform === 'unknown' ? null : 'home_markup';
  if (platform === 'unknown' && input.platform && input.platform !== 'unknown') {
    platform = input.platform;
    platformEvidence = 'prior_read';
  }
  let magentoGeneration = facts?.magentoGeneration ?? null;
  let predictiveSearch: boolean | null = facts?.predictiveSearch ?? null;
  if (
    (platform === 'unknown' && !facts?.wordpress) ||
    (platform === 'shopify' && predictiveSearch !== false)
  ) {
    const url = new URL('search/suggest.json', home);
    url.search = new URLSearchParams({
      q: 'a',
      'resources[type]': 'product',
      'resources[limit]': '1',
    }).toString();
    const response = await probe('platform', url);
    const products = asArray(
      getPath(payload(okPage(response)), 'resources', 'results', 'products'),
    );
    if (products?.every((p) => typeof getField(asObject(p), 'handle') === 'string')) {
      platform = 'shopify';
      platformEvidence = 'shopify_suggest';
      predictiveSearch = true;
    } else if (
      platform === 'shopify' &&
      response?.outcome.kind === 'network_error' &&
      response.outcome.code === 'HTTP_417'
    ) {
      predictiveSearch = false;
    }
  } else if (platform === 'woo' || (platform === 'unknown' && facts?.wordpress)) {
    const url = new URL('wp-json/wc/store/v1/products', home);
    url.search = 'per_page=1';
    const products = asArray(payload(okPage(await probe('platform', url))));
    if (
      products &&
      products.length > 0 &&
      products.every(
        (p) =>
          typeof getPath(p, 'name') === 'string' &&
          typeof getPath(p, 'permalink') === 'string' &&
          typeof getPath(p, 'prices', 'currency_code') === 'string',
      )
    ) {
      platform = 'woo';
      platformEvidence = 'woo_store_api';
    }
  } else if (platform === 'magento' && magentoGeneration !== 1) {
    const url = new URL('graphql', home);
    url.searchParams.set('query', '{storeConfig{store_code}}');
    const result = await probe('platform', url);
    if (asString(getPath(payload(okPage(result)), 'data', 'storeConfig', 'store_code'))) {
      magentoGeneration = 2;
      platformEvidence = 'magento_graphql';
    }
  }
  const ucp = payload(okPage(await probe('ucp', new URL('/.well-known/ucp', origin))));
  let openSearch: string | null = null;
  if (facts?.openSearchDescription) {
    const descriptor = okPage(await probe('opensearch', new URL(facts.openSearchDescription)));
    if (descriptor) openSearch = openSearchTemplate(descriptor, new URL(descriptor.finalUrl));
  }
  const sitemap = await probe('sitemap', new URL('/sitemap.xml', origin));
  const xml = okPage(sitemap);
  const llms = await probe('llms', new URL('/llms.txt', origin));
  const text = okPage(llms);
  return {
    market: input.market,
    platform,
    platformEvidence,
    magentoGeneration,
    predictiveSearch,
    productMarkup: facts?.productMarkup ?? null,
    productSitemap: xml
      ? productSitemap(xml, origin)
      : sitemap?.outcome.kind === 'not_found'
        ? false
        : null,
    llmsTxt: text
      ? /^text\/(?:plain|markdown)(?:\s*;|$)/i.test(text.contentType ?? '') && !!text.text.trim()
      : llms?.outcome.kind === 'not_found'
        ? false
        : null,
    ucpCatalogEndpoint: catalogEndpoint(ucp, origin),
    searchAction: facts?.searchAction ?? null,
    openSearchTemplate: openSearch,
    wireRequests: wireBudget.used,
    probes,
  };
}
