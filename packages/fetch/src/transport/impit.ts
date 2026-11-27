// The `impit` engine (S§3.3 "HTTP fingerprint"): the only module that imports `impit`.
//
// The `chrome151` profile as shipped: its own User-Agent, client hints and header set; no TLS
// option (the certificate is always checked); HTTP/3 off, so no second connection is opened
// outside the proxy (impit never sends HTTP/3 through a proxy either); redirects never followed;
// no cookie jar (cookies are the caller's, sent as a Cookie header). A fresh client per request:
// it costs well under a millisecond, and no pooled connection can outlive the hop it was pinned
// for.
import { Impit } from 'impit';
import { storeCatalogBody } from '../store-catalog.ts';
import { ABORT_CODE, type EngineResponse, type HttpEngine, TIMEOUT_CODE } from './types.ts';

export const IMPIT_PROFILE = 'chrome151';

/** impit's errors carry no code; this names them from their class and message. */
export function impitErrorCode(error: unknown): string {
  const err = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
    constructor?: { name?: unknown };
  };
  const name = typeof err.constructor?.name === 'string' ? err.constructor.name : '';
  const text = `${name} ${String(err.name ?? '')} ${String(err.message ?? '')}`;
  if (/timeout|timedout|timed out/i.test(text)) return TIMEOUT_CODE;
  if (/abort/i.test(text)) return ABORT_CODE;
  if (/certificate|unknownissuer|notvalidforname|cert_/i.test(text)) return 'ERR_TLS_CERT';
  if (/\btls\b|handshake|alert/i.test(text)) return 'ERR_TLS';
  if (/proxy|socks/i.test(text)) return 'ERR_PROXY';
  if (/reset|broken pipe|connection closed|incomplete|unexpected eof/i.test(text)) {
    return 'ECONNRESET';
  }
  if (/protocol|http2|\bh2\b|goaway/i.test(text)) return 'ERR_PROTOCOL';
  if (/decod/i.test(text)) return 'ERR_DECODE';
  if (/ConnectError/.test(name)) return 'ERR_CONNECT';
  return 'ERR_TRANSPORT';
}

function coded(error: unknown): Error {
  const code = impitErrorCode(error);
  return Object.assign(new Error(code, { cause: error }), { code });
}

async function* codedBody(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let done = false;
  try {
    for (;;) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch (error) {
        throw coded(error);
      }
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!done) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The HTTP engine on `impit`; see the module comment and `HttpEngine`. */
export function impitEngine(): HttpEngine {
  return {
    async fetch(request): Promise<EngineResponse> {
      const client = new Impit({
        browser: IMPIT_PROFILE,
        proxyUrl: request.proxyUrl,
        followRedirects: false,
        http3: false,
        timeout: request.timeoutMs,
      });
      let response: Awaited<ReturnType<Impit['fetch']>>;
      try {
        response = await client.fetch(request.url, {
          ...(request.catalogSearch
            ? { method: 'POST', body: storeCatalogBody(request.url, request.catalogSearch) }
            : { method: 'GET' }),
          redirect: 'manual',
          headers: request.headers.map(([name, value]): [string, string] => [name, value]),
          signal: request.signal,
          timeout: request.timeoutMs,
        });
      } catch (error) {
        throw coded(error);
      }
      const headers: [string, string][] = [];
      for (const [name, value] of response.headers) {
        const key = name.toLowerCase();
        if (key !== 'set-cookie') headers.push([key, value]);
      }
      for (const cookie of response.headers.getSetCookie()) headers.push(['set-cookie', cookie]);
      const stream = response.body as ReadableStream<Uint8Array> | null;
      return {
        status: response.status,
        headers,
        body: stream === null ? null : codedBody(stream),
        cancel: () => {
          if (stream !== null && !stream.locked) stream.cancel().catch(() => {});
        },
      };
    },
  };
}
