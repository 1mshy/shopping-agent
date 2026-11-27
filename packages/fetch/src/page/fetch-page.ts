// The `api` and `http` rungs (S§5.1 Ladder): one guarded GET with a body cap, and its typed
// outcome. Every request goes through `guardedFetch`: there is no other way to the network here
// and no option that skips it.
import { FetchOutcome, type Rung } from '@agentic-dasher/shared';
import type { CookieJars } from '../cookies/index.ts';
import {
  DEFAULT_MAX_REDIRECTS,
  type GuardedNet,
  guardedFetch,
  type OwnNetwork,
} from '../guard/index.ts';
import {
  ABORT_CODE,
  type HeaderList,
  type HttpNetwork,
  TIMEOUT_CODE,
  type TransportResponse,
} from '../transport/index.ts';
import {
  type ClassifierVerdict,
  type Classify,
  type ClassifyInput,
  defaultClassify,
  type PageResponse,
} from './classify.ts';
import { API_ACCEPT, refererFor } from './headers.ts';
import { statusOutcome } from './status.ts';

/**
 * The page body cap. The spec gives no number; product pages of a few MB exist (inline JSON,
 * inline images). The Phase 0 lab read every page it was served under 3 MiB; twice that leaves
 * room, and at about 12 HTTP hosts in flight (S§5.1 Pacing) the worst case stays near 12 x 6 MiB
 * of bytes plus their decoded text, inside the 400 MB search budget (S§5.14).
 */
export const PAGE_MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * The JSON body cap. A platform endpoint answers one product or one page of results: a Shopify
 * product with hundreds of variants is a few hundred KB, a 250-product `products.json` page about
 * 2 MB. JSON is decoded whole, so the cap stays lower than a page's.
 */
export const JSON_MAX_BODY_BYTES = 4 * 1024 * 1024;

export type HttpRung = Extract<Rung, 'api' | 'http'>;

interface RequestBase {
  readonly url: string;
  /** Epoch milliseconds on the fetcher's clock; the whole request (every hop, the body) ends by then. */
  readonly deadline: number;
  readonly signal: AbortSignal;
  /** Overrides the rung's body cap. */
  readonly maxBodyBytes?: number;
}

export type PageRequest =
  /** A platform or public endpoint, asked for JSON. */
  | (RequestBase & { readonly rung: 'api' })
  /** A page, with an optional Referer, sent only where it is same-site (see `refererFor`). */
  | (RequestBase & { readonly rung: 'http'; readonly referer?: string });

export interface PageResult {
  /** Names the rung, as every outcome does. */
  readonly outcome: FetchOutcome;
  /** What was read, whatever the outcome; null when no response was read. */
  readonly response: PageResponse | null;
}

export interface PageFetcherDeps {
  /** The network requests run on: `createHttpNetwork()` for real, a scripted one in tests. */
  readonly network: HttpNetwork;
  /** The host sessions' cookie jars. */
  readonly jars: CookieJars;
  /** The wall classifier; `defaultClassify` answers whatever it has no opinion on. */
  readonly classify?: Classify;
  /** The clock (epoch milliseconds) for the deadline, Retry-After and cookie expiry. */
  readonly now?: () => number;
  readonly maxRedirects?: number;
  readonly deniedNetworks?: readonly OwnNetwork[];
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function decode(body: Uint8Array, contentType: string | null): string {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '')?.[1];
  if (charset !== undefined) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // An unknown label: read as UTF-8 below.
    }
  }
  return new TextDecoder().decode(body);
}

function pageResponse(
  status: number,
  finalUrl: string,
  list: HeaderList,
  body: Uint8Array,
): PageResponse {
  const headers: Record<string, string> = {};
  const setCookies: string[] = [];
  for (const [name, value] of list) {
    if (name === 'set-cookie') setCookies.push(value);
    else headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  }
  const contentType = headers['content-type'] ?? null;
  return {
    status,
    finalUrl,
    headers,
    setCookies,
    contentType,
    body,
    text: decode(body, contentType),
  };
}

function withRung(verdict: ClassifierVerdict, rung: HttpRung): FetchOutcome {
  const parsed = FetchOutcome.safeParse({ ...verdict, rung });
  if (!parsed.success) {
    throw new TypeError(`the classifier returned an invalid outcome: ${JSON.stringify(verdict)}`);
  }
  return parsed.data;
}

/** One GET on the `api` or `http` rung, through the guard; see the module comment. */
export async function fetchPage(request: PageRequest, deps: PageFetcherDeps): Promise<PageResult> {
  const { rung, deadline, signal } = request;
  if (rung !== 'api' && rung !== 'http') throw new RangeError(`not an HTTP rung: ${String(rung)}`);
  if (!Number.isFinite(deadline))
    throw new RangeError(`deadline must be a number, got ${deadline}`);
  const now = deps.now ?? Date.now;
  const maxBodyBytes =
    request.maxBodyBytes ?? (rung === 'api' ? JSON_MAX_BODY_BYTES : PAGE_MAX_BODY_BYTES);
  const referer = request.rung === 'http' ? request.referer : undefined;

  const headersFor = (url: string): HeaderList => {
    const list: [string, string][] = [];
    if (rung === 'api') list.push(['accept', API_ACCEPT]);
    if (referer !== undefined) {
      const sent = refererFor(referer, url);
      if (sent !== null) list.push(['referer', sent.referer], ['sec-fetch-site', sent.fetchSite]);
    }
    const cookie = deps.jars.jar(hostOf(url)).header(url, now());
    if (cookie !== null) list.push(['cookie', cookie]);
    return list;
  };

  const net = deps.network.open({ deadline, signal, headersFor });
  // Every hop's Set-Cookie goes into its host's jar, redirects included.
  const session: GuardedNet<TransportResponse> = {
    lookup: (host) => net.lookup(host),
    async exchange(address, port, url) {
      const response = await net.exchange(address, port, url);
      const setCookies = response.headers.filter(([name]) => name === 'set-cookie');
      if (setCookies.length > 0) {
        deps.jars.jar(hostOf(url)).store(
          setCookies.map(([, value]) => value),
          url,
          now(),
        );
      }
      return response;
    },
  };

  const result = await guardedFetch({ url: request.url, rung }, session, {
    maxBodyBytes,
    ...(deps.deniedNetworks ? { deniedNetworks: deps.deniedNetworks } : {}),
    maxRedirects: deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
  });
  if (!result.delivered) {
    let outcome: FetchOutcome = result.outcome;
    // The deadline rule: a failure at or after the deadline is a timeout, whatever it was called.
    if (outcome.kind === 'network_error') {
      if (now() >= deadline) outcome = { ...outcome, code: TIMEOUT_CODE };
      else if (signal.aborted) outcome = { ...outcome, code: ABORT_CODE };
    }
    return { outcome, response: null };
  }

  const response = pageResponse(
    result.status,
    result.finalUrl,
    result.response.headers,
    result.body,
  );
  const input: ClassifyInput = { ...response, rung };
  const verdict = deps.classify?.(input) ?? defaultClassify(input);
  const outcome =
    verdict !== null
      ? withRung(verdict, rung)
      : statusOutcome(rung, response.status, response.headers['retry-after'], now());
  return { outcome, response };
}
