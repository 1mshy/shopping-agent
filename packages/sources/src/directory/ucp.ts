// Shopify's storefront MCP binding. Only identity evidence enters the directory, and only
// for a product link on the selected storefront. Every price still needs a direct read.
import {
  isStoreCatalogEndpoint,
  STORE_CATALOG_LIMIT,
  STORE_CATALOG_MAX_BYTES,
  validStoreCatalogSearch,
} from '@agentic-dasher/fetch';
import {
  asArray,
  asObject,
  asString,
  getPath,
  JsonNumber,
  type JsonValue,
  parseJson,
} from '../platform/json.ts';
import type { ReaderContext } from '../read/contract.ts';
import type { DirectoryCandidate, StoreSearch, StoreSearchResult } from './search.ts';

function parsed(text: string): JsonValue | null {
  const read = parseJson(text, { maxLength: STORE_CATALOG_MAX_BYTES, maxValues: 65_536 });
  return read.ok ? read.value : null;
}
function isReply(message: JsonValue | null): boolean {
  const id = getPath(message, 'id');
  return getPath(message, 'jsonrpc') === '2.0' && id instanceof JsonNumber && id.text === '1';
}
function replyMessage(text: string, contentType: string): JsonValue | null {
  if (text.length > STORE_CATALOG_MAX_BYTES) return null;
  if (contentType === 'application/json') {
    const message = parsed(text);
    return isReply(message) ? message : null;
  }
  if (contentType !== 'text/event-stream') return null;
  let reply: JsonValue | null = null;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    const message = parsed(data);
    if (!isReply(message)) continue;
    if (reply) return null;
    reply = message;
  }
  return reply;
}

function storeProductUrl(raw: string | null, input: StoreSearch): URL | null {
  const url = raw && URL.parse(raw, input.origin);
  if (!url || url.origin !== input.origin || url.username || url.password) return null;
  if (url.pathname.startsWith('/products/')) url.pathname = input.marketPrefix + url.pathname;
  const prefix = `${input.marketPrefix}/products/`;
  if (!url.pathname.startsWith(prefix) || !/^[^/]+\/?$/.test(url.pathname.slice(prefix.length)))
    return null;
  return url;
}
function variantOptions(row: JsonValue): Record<string, string> {
  const options: Record<string, string> = Object.create(null);
  for (const item of asArray(getPath(row, 'options')) ?? []) {
    const name = asString(getPath(item, 'name'));
    const label = asString(getPath(item, 'label'));
    if (name && label) options[name] = label;
  }
  return options;
}
function candidates(products: readonly JsonValue[], input: StoreSearch): DirectoryCandidate[] {
  const found = new Map<string, DirectoryCandidate>();
  const storeHost = new URL(input.origin).hostname;
  for (const product of products.slice(0, STORE_CATALOG_LIMIT)) {
    const title = asString(getPath(product, 'title'))?.trim();
    if (!title) continue;
    const variants = asArray(getPath(product, 'variants'));
    const productUrl = asString(getPath(product, 'url'));
    for (const row of variants?.length ? variants : [null]) {
      const other = getPath(row, 'seller', 'domain');
      if (typeof other === 'string' && other.toLowerCase() !== storeHost) continue;
      const currency =
        getPath(row, 'price', 'currency') ?? getPath(product, 'price_range', 'min', 'currency');
      if (currency != null && currency !== input.market.currency) continue;
      const raw = asString(getPath(row, 'url')) ?? productUrl;
      const url = storeProductUrl(raw, input);
      if (!url) continue;
      const gid = asString(getPath(row, 'id'))?.match(
        /^gid:\/\/shopify\/ProductVariant\/(\d+)$/,
      )?.[1];
      const ids = url.searchParams.getAll('variant');
      if (ids.length > 1 || (ids[0] !== undefined && !/^\d+$/.test(ids[0]))) continue;
      const selected = ids[0];
      if (gid && selected && gid !== selected) continue;
      if (gid && !selected) url.searchParams.set('variant', gid);
      const coupled = !!gid || (!!getPath(row, 'url') && !!selected);
      if (!found.has(url.href)) {
        found.set(url.href, {
          url: url.href,
          storeHost: url.hostname,
          marketPrefix: input.marketPrefix,
          title,
          brand: asString(getPath(product, 'brand')),
          gtin: coupled ? asString(getPath(row, 'gtin')) : null,
          mpn: coupled ? asString(getPath(row, 'mpn')) : null,
          sku: coupled ? asString(getPath(row, 'sku')) : null,
          variant: coupled ? variantOptions(row) : {},
        });
        if (found.size === STORE_CATALOG_LIMIT) return [...found.values()];
      }
    }
  }
  return [...found.values()];
}

export async function searchUcp(
  input: StoreSearch & { endpoint: string },
  context: ReaderContext,
): Promise<StoreSearchResult> {
  const { endpoint, market } = input;
  const catalogSearch = {
    query: input.query,
    country: market.country,
    currency: market.currency,
    language: market.language,
  };
  if (
    !isStoreCatalogEndpoint(endpoint) ||
    new URL(endpoint).origin !== input.origin ||
    !/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?$/.test(input.marketPrefix) ||
    !validStoreCatalogSearch(catalogSearch)
  )
    return { kind: 'unsupported' };
  const { outcome, response } = await context.get({ url: endpoint, rung: 'api', catalogSearch });
  if (
    outcome.kind === 'not_found' ||
    (outcome.kind === 'network_error' && outcome.code === 'HTTP_405')
  )
    return { kind: 'unsupported' };
  if (outcome.kind !== 'ok') return { kind: 'fetch_failed', outcome };
  if (!response || response.finalUrl !== endpoint) return { kind: 'invalid_response' };
  const mime = response.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const message = replyMessage(response.text, mime);
  if (!message) return { kind: 'invalid_response' };
  const error = getPath(message, 'error');
  if (error) {
    const code = getPath(error, 'code');
    return {
      kind:
        code instanceof JsonNumber && code.text === '-32601' ? 'unsupported' : 'invalid_response',
    };
  }
  const result = getPath(message, 'result');
  if (!asObject(result) || getPath(result, 'isError') === true) return { kind: 'invalid_response' };
  let payload = getPath(result, 'structuredContent');
  if (payload === undefined) {
    const contents = asArray(getPath(result, 'content')) ?? [];
    const block = contents.find((item) => getPath(item, 'type') === 'text');
    payload = parsed(asString(getPath(block, 'text')) ?? '');
  }
  if (getPath(payload, 'ucp', 'status') === 'error') return { kind: 'invalid_response' };
  const products = asArray(getPath(payload, 'products'));
  return products
    ? { kind: 'results', candidates: candidates(products, input) }
    : { kind: 'invalid_response' };
}
