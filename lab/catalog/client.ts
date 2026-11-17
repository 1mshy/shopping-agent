// Probe client for Shopify's Global Catalog `search_catalog` tool (plan P0 spike B).
// Raw fetch, no MCP SDK. Request shape and error codes: see SOURCES.md ([GC], [UCP-OV]).
// Nothing is dropped: offers in another currency, without a price or without variants are
// kept and flagged. Amounts are kept as the exact JSON text the API sent; no float conversion.

export const CATALOG_ENDPOINT = 'https://catalog.shopify.com/api/ucp/mcp';
export const LAB_USER_AGENT = 'agentic-dasher-lab/0.1';
export const REQUEST_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream', // [MCP-T]
  'user-agent': LAB_USER_AGENT,
} as const;

/** URL parameters [PP] documents as attribution on variant URLs. */
const ATTRIBUTION_PARAMS = new Set([
  '_gsid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'shcgid',
  'shclid',
]);
// Retry-After is documented ([RL]); shopify-complexity-score was seen on the one live
// tools/list reply (README.md) and is undocumented in the sources read; the rest are generic.
const RATE_LIMIT_HEADER =
  /^(retry-after|x-ratelimit-.*|ratelimit.*|x-rate-limit-.*|shopify-complexity-score)$/i;
const ERROR_BODY_MAX = 2000;

export interface SearchParams {
  query: string;
  country: string; // ISO 3166-1 alpha-2
  currency: string; // ISO 4217
  limit?: number; // [GC] 1..50, default here 20 (S§5.6)
  shipsTo?: boolean; // add filters.ships_to.country = country
}

export interface Price {
  amount: string; // exact JSON text the API sent
  amountJsonType: 'number' | 'string';
  currency: string;
}

export interface Offer {
  productId: string | null;
  productTitle: string | null;
  variantId: string | null;
  variantTitle: string | null;
  price: Price | null;
  currencyMatch: 'requested' | 'other' | 'missing';
  merchant: { name: string | null; domain: string | null; id: string | null };
  url: string | null; // verbatim, attribution parameters untouched
  urlFrom: 'variant' | 'product' | null;
  checkoutUrl: string | null;
  attributionParams: string[];
  available: boolean | null;
  source: string | null;
}

export type ProbeErrorKind =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'http'
  | 'jsonrpc'
  | 'ucp_error'
  | 'invalid_json'
  | 'unexpected_shape';

export interface ProbeError {
  kind: ProbeErrorKind;
  message: string;
  jsonrpcCode?: number;
  ucpCode?: string;
  retryAfter?: string;
  body?: string;
}

interface ProbeMeta {
  status: number | null;
  latencyMs: number;
  contentType: string | null;
  rateLimitHeaders: Record<string, string>;
}

export interface SearchOk {
  ok: true;
  productCount: number;
  totalCount: number | null;
  ucpVersion: string | null;
  offers: Offer[];
  messages: unknown[];
}

export type ProbeResult = ProbeMeta & (SearchOk | { ok: false; error: ProbeError });

type Json = Record<string, unknown>;

export function assertProfileUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`profile URL does not parse: ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  const problems = [
    url.protocol !== 'https:' && 'must be https ([UCP-OV] Hosting)',
    (url.username || url.password) && 'must not contain userinfo',
    (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) &&
      'host must be a registered domain name',
    /(^|\.)example(\.(com|org|net))?$/.test(host) && 'example domains are placeholders',
    /placeholder|changeme|todo/i.test(raw) && 'looks like a placeholder',
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`refusing profile URL ${raw}: ${problems.join('; ')}`);
  return raw;
}

export function buildSearchBody(params: SearchParams, profileUrl: string, id = 1) {
  const query = params.query.trim();
  const limit = params.limit ?? 20;
  if (query === '') throw new Error('query is empty');
  if (!/^[A-Z]{2}$/.test(params.country)) throw new Error(`bad country: ${params.country}`);
  if (!/^[A-Z]{3}$/.test(params.currency)) throw new Error(`bad currency: ${params.currency}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error(`bad limit: ${limit}`);
  const catalog: {
    query: string;
    context: { address_country: string; currency: string };
    pagination: { limit: number };
    filters?: { ships_to: { country: string } };
  } = {
    query,
    context: { address_country: params.country, currency: params.currency },
    pagination: { limit },
  };
  if (params.shipsTo) catalog.filters = { ships_to: { country: params.country } };
  return {
    jsonrpc: '2.0' as const,
    method: 'tools/call' as const,
    id,
    params: {
      name: 'search_catalog' as const,
      arguments: { meta: { 'ucp-agent': { profile: assertProfileUrl(profileUrl) } }, catalog },
    },
  };
}

/** Marker for a JSON number named `amount`, holding its exact source text. */
class RawNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

/** JSON.parse that keeps every `amount` number as its source text (Node 26 reviver context). */
function parseJson(text: string): unknown {
  return JSON.parse(text, (key: string, value: unknown, context?: { source?: string }) =>
    key === 'amount' && typeof value === 'number'
      ? new RawNumber(context?.source ?? String(value))
      : value,
  );
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RawNumber);
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toPrice(v: unknown): Price | null {
  if (!isObj(v) || typeof v.currency !== 'string') return null;
  if (v.amount instanceof RawNumber)
    return { amount: v.amount.text, amountJsonType: 'number', currency: v.currency };
  if (typeof v.amount === 'string')
    return { amount: v.amount, amountJsonType: 'string', currency: v.currency };
  return null;
}

function attributionOf(url: string | null): string[] {
  if (url === null) return [];
  try {
    return [...new URL(url).searchParams.keys()].filter((k) => ATTRIBUTION_PARAMS.has(k));
  } catch {
    return [];
  }
}

function toOffers(product: Json, currency: string): Offer[] {
  const variants = Array.isArray(product.variants) ? product.variants.filter(isObj) : [];
  const rows: (Json | null)[] = variants.length > 0 ? variants : [null];
  return rows.map((v) => {
    const price = v ? toPrice(v.price) : null;
    const seller = v && isObj(v.seller) ? v.seller : {};
    const variantUrl = v ? str(v.url) : null;
    const url = variantUrl ?? str(product.url);
    const availability = v && isObj(v.availability) ? v.availability : {};
    return {
      productId: str(product.id),
      productTitle: str(product.title),
      variantId: v ? str(v.id) : null,
      variantTitle: v ? str(v.title) : null,
      price,
      currencyMatch:
        price === null ? 'missing' : price.currency === currency ? 'requested' : 'other',
      merchant: { name: str(seller.name), domain: str(seller.domain), id: str(seller.id) },
      url,
      urlFrom: variantUrl !== null ? 'variant' : url !== null ? 'product' : null,
      checkoutUrl: v ? str(v.checkout_url) : null,
      attributionParams: attributionOf(url),
      available: typeof availability.available === 'boolean' ? availability.available : null,
      source: v ? str(v.source) : null,
    };
  });
}

/** Last JSON-RPC message in an SSE body (`data:` lines of each event). */
function fromSse(body: string): string {
  const events = body
    .split(/\r?\n\r?\n/)
    .map((e) =>
      e
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n'),
    )
    .filter((d) => d !== '');
  return events.at(-1) ?? '';
}

export function parseCatalogResponse(input: {
  status: number;
  contentType: string | null;
  bodyText: string;
  retryAfter: string | null;
  currency: string;
}): SearchOk | { ok: false; error: ProbeError } {
  const { status, bodyText } = input;
  const fail = (e: Omit<ProbeError, 'body'>) => ({
    ok: false as const,
    error: { ...e, body: bodyText.slice(0, ERROR_BODY_MAX) },
  });
  const sse = input.contentType?.includes('text/event-stream') ?? false;
  let msg: unknown;
  try {
    msg = parseJson(sse ? fromSse(bodyText) : bodyText);
  } catch {
    msg = undefined;
  }
  const rpcError = isObj(msg) && isObj(msg.error) ? msg.error : null;
  const rpc = rpcError
    ? {
        jsonrpcCode: typeof rpcError.code === 'number' ? rpcError.code : undefined,
        ucpCode: isObj(rpcError.data) ? (str(rpcError.data.code) ?? undefined) : undefined,
      }
    : {};
  const rpcMessage = rpcError ? (str(rpcError.message) ?? 'JSON-RPC error') : null;
  if (status === 429) {
    return fail({
      kind: 'rate_limited',
      message: rpcMessage ?? 'HTTP 429',
      retryAfter: input.retryAfter ?? undefined,
      ...rpc,
    });
  }
  if (rpcError) return fail({ kind: 'jsonrpc', message: rpcMessage ?? '', ...rpc });
  if (status < 200 || status > 299) return fail({ kind: 'http', message: `HTTP ${status}` });
  if (msg === undefined) return fail({ kind: 'invalid_json', message: 'body is not JSON' });
  const result = isObj(msg) && isObj(msg.result) ? msg.result : null;
  let payload: unknown = result?.structuredContent;
  if (!isObj(payload) && result && Array.isArray(result.content)) {
    const text = result.content.find((c) => isObj(c) && typeof c.text === 'string');
    try {
      payload = isObj(text) ? parseJson(String(text.text)) : undefined;
    } catch {
      payload = undefined;
    }
  }
  if (!isObj(payload)) return fail({ kind: 'unexpected_shape', message: 'no structuredContent' });
  const ucp = isObj(payload.ucp) ? payload.ucp : {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (ucp.status === 'error') {
    const first = messages.find(isObj);
    return fail({
      kind: 'ucp_error',
      message: (first && str(first.content)) ?? 'ucp.status is error',
      ucpCode: (first && str(first.code)) ?? undefined,
    });
  }
  if (!Array.isArray(payload.products)) {
    return fail({ kind: 'unexpected_shape', message: 'products is not an array' });
  }
  const products = payload.products.filter(isObj);
  const pagination = isObj(payload.pagination) ? payload.pagination : {};
  return {
    ok: true,
    productCount: products.length,
    totalCount: typeof pagination.total_count === 'number' ? pagination.total_count : null,
    ucpVersion: str(ucp.version),
    offers: products.flatMap((p) => toOffers(p, input.currency)),
    messages,
  };
}

export async function searchCatalog(
  params: SearchParams,
  options: { profileUrl: string; endpoint?: string; timeoutMs?: number; id?: number },
): Promise<ProbeResult> {
  const body = JSON.stringify(buildSearchBody(params, options.profileUrl, options.id));
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let res: Response;
  let bodyText: string;
  try {
    res = await fetch(options.endpoint ?? CATALOG_ENDPOINT, {
      method: 'POST',
      headers: REQUEST_HEADERS,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    bodyText = await res.text();
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      status: null,
      latencyMs: elapsed(),
      contentType: null,
      rateLimitHeaders: {},
      error: { kind: timeout ? 'timeout' : 'network', message: String(err) },
    };
  }
  const latencyMs = elapsed();
  const rateLimitHeaders: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (RATE_LIMIT_HEADER.test(name)) rateLimitHeaders[name] = value;
  });
  const contentType = res.headers.get('content-type');
  const parsed = parseCatalogResponse({
    status: res.status,
    contentType,
    bodyText,
    retryAfter: res.headers.get('retry-after'),
    currency: params.currency,
  });
  return { status: res.status, latencyMs, contentType, rateLimitHeaders, ...parsed };
}
