// The HTTP transport's own seam, free of any client library's types, so that `impit` can be
// swapped for `wreq-js` (S§3.3) by writing one more `HttpEngine`. The guard's seam
// (`PinnedTransport`, guard/exchange.ts) is implemented once, in pinned.ts, on top of it.
import type { BodyResponse, GuardedNet } from '../guard/index.ts';

/** Header name and value pairs, names lower-cased, in order; a repeated header stays apart. */
export type HeaderList = readonly (readonly [string, string])[];

/** The code of a failure at or after the request's deadline, whatever the client called it. */
export const TIMEOUT_CODE = 'ETIMEDOUT';

/** The code of a request the caller aborted before its deadline. */
export const ABORT_CODE = 'ABORT_ERR';

/**
 * Headers no caller may set: the profile owns the User-Agent and the client hints (S§5.1), and
 * the transport owns the connection.
 */
const OWNED_BY_PROFILE_OR_TRANSPORT =
  /^(?:user-agent|sec-ch-ua(?:-.*)?|host|connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length)$/;

/** Throws a TypeError for a header a caller may not set (see above). */
export function assertCallerHeaders(headers: HeaderList): void {
  for (const [name] of headers) {
    if (OWNED_BY_PROFILE_OR_TRANSPORT.test(name.toLowerCase())) {
      throw new TypeError(`the transport does not let a caller set the ${name} header`);
    }
  }
}

/** One request to the engine, already pinned: the engine must use `proxyUrl` for it. */
export interface EngineRequest {
  readonly url: string;
  /** The pinning proxy (`socks5h://ticket:secret@127.0.0.1:port`); see socks-proxy.ts. */
  readonly proxyUrl: string;
  /** Headers the caller adds to the profile's own (Accept, Referer, Cookie). */
  readonly headers: HeaderList;
  /** Fires at the deadline or when the caller aborts. */
  readonly signal: AbortSignal;
  /** Milliseconds left until the deadline, for the engine's own timer. */
  readonly timeoutMs: number;
}

export interface EngineResponse {
  readonly status: number;
  /** Names lower-cased; every Set-Cookie value is its own entry. */
  readonly headers: HeaderList;
  /** Null when the response has no body. */
  readonly body: AsyncIterable<Uint8Array> | null;
  /** Releases the body without reading it. */
  cancel(): void;
}

/**
 * An HTTP client that impersonates a browser profile. It must send exactly one GET through
 * `proxyUrl`, never follow a redirect, never use HTTP/3, never resolve the URL's host itself, and
 * reject with an Error whose `code` (one of the codes above, or its own upper-case code) names the
 * failure.
 */
export interface HttpEngine {
  fetch(request: EngineRequest): Promise<EngineResponse>;
}

/** What the transport hands the guard for one hop: the response, with its headers. */
export interface TransportResponse extends BodyResponse {
  readonly headers: HeaderList;
}

/** What one guarded request needs from the transport for each of its hops. */
export interface ExchangeContext {
  /** Epoch milliseconds, on the clock the network was made with. */
  readonly deadline: number;
  readonly signal: AbortSignal;
  /** The headers this hop adds (Accept, Referer, Cookie); asked again for every hop. */
  readonly headersFor: (url: string) => HeaderList;
}

/**
 * The network one guarded request runs on: a resolver and a pinned transport bound to the
 * request's deadline and signal. Only the guard (`guardedFetch`) is given what `open` returns.
 */
export interface HttpNetwork {
  open(context: ExchangeContext): GuardedNet<TransportResponse>;
}
