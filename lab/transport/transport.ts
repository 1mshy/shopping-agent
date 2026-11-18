// The lab's HttpTransport seam (plan P0 spike A). One GET, with only the headers the caller adds;
// redirects are never followed by the client (the caller follows them by hand and re-checks each
// hop with the guard). Each client lives behind this seam in one adapter module under clients/.
//
// Impersonating clients use their Chrome profile as shipped: the adapters never set a
// User-Agent, client hints or a TLS option (S§5.1). Only the baseline sends a User-Agent.

export type ClientId = 'fetch' | 'impit' | 'wreq';

export interface TransportInfo {
  id: ClientId;
  /** npm package name, or `node` for the built-in fetch. */
  library: string;
  version: string;
  /** The profile the client impersonates, as the library names it (`none` for the baseline). */
  profile: string;
  /** Anything else that shapes what goes on the wire (the OS the profile claims, defaults used). */
  notes: string;
}

export interface TransportRequest {
  url: string;
  /** Headers the caller adds. The lab adds none to an impersonating client. */
  headers?: Record<string, string>;
  /** Whole request including the body. */
  timeoutMs: number;
  /** Body cap in bytes; a longer body is an error (`body_cap`), never a truncated answer. */
  maxBytes: number;
}

export interface TransportResponse {
  status: number;
  /** Names lowercased, in the order the client reports them; repeated headers kept apart. */
  headers: Array<[string, string]>;
  /** The URL the client reports for the answer (the request URL: redirects are not followed). */
  url: string;
  body: Uint8Array;
  /** What the client exposes about the connection (protocol, TLS), if anything. */
  facts: Record<string, string | number | boolean>;
}

/**
 * Error codes are normalised so the retry rule is one rule for every client: `timeout`,
 * `body_cap`, `dns`, `ECONNREFUSED`, `ECONNRESET`, `tls`, `protocol`, or the client's own code.
 */
export type TransportResult =
  | { ok: true; response: TransportResponse }
  | { ok: false; error: string; detail: string };

export interface HttpTransport {
  readonly info: TransportInfo;
  get(req: TransportRequest): Promise<TransportResult>;
  close(): Promise<void>;
}

/** Network errors worth the single retry (S§5.1 limits; spike C's set, normalised). */
export const RETRYABLE = new Set(['timeout', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);

/**
 * Reads a body stream up to `maxBytes`, by a deadline. A longer body cancels the stream and
 * gives `body_cap`; the deadline gives `timeout`.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
  deadline: number,
): Promise<{ body: Uint8Array } | { error: 'body_cap' | 'timeout' }> {
  if (!stream) return { body: new Uint8Array() };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((r) => {
    timer = setTimeout(() => r('late'), Math.max(0, deadline - Date.now()));
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), late]);
      if (next === 'late') {
        await reader.cancel().catch(() => {});
        return { error: 'timeout' };
      }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { error: 'body_cap' };
      }
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(timer);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return { body };
}

/** Headers as lowercased tuples, with `set-cookie` split into its separate values. */
export function headerTuples(h: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of h) {
    if (k.toLowerCase() === 'set-cookie') continue;
    out.push([k.toLowerCase(), v]);
  }
  for (const c of h.getSetCookie()) out.push(['set-cookie', c]);
  return out;
}

interface ErrorLike {
  name?: string;
  code?: string;
  message?: string;
  cause?: { code?: string; name?: string; message?: string };
}

/** The error's name, code and message (and its cause's), for the stored evidence. */
export function detailOf(e: unknown, n = 300): string {
  const err = (e ?? {}) as ErrorLike;
  const parts = [err.name, err.code, err.message, err.cause?.code, err.cause?.message];
  return parts
    .filter((p) => typeof p === 'string' && p)
    .join(' | ')
    .slice(0, n);
}

/** One error vocabulary for every client, decided from the error's name, code and message. */
export function errorCode(e: unknown): string {
  const err = (e ?? {}) as ErrorLike;
  const text = detailOf(e, 2000);
  if (/AbortError|TimeoutError|Timeout\b|timed? ?out|UND_ERR_CONNECT_TIMEOUT/i.test(text)) {
    return 'timeout';
  }
  if (/ENOTFOUND|EAI_AGAIN|\bdns\b|failed to lookup|resolve/i.test(text)) return 'dns';
  if (/ECONNREFUSED|connection refused/i.test(text)) return 'ECONNREFUSED';
  if (/ECONNRESET|connection reset|reset by peer|UND_ERR_SOCKET/i.test(text)) return 'ECONNRESET';
  if (/EPIPE|broken pipe/i.test(text)) return 'EPIPE';
  if (/certificate|\btls\b|\bssl\b|handshake|CERT_|alert/i.test(text)) return 'tls';
  if (/protocol|http2|\bh2\b|GOAWAY|frame/i.test(text)) return 'protocol';
  return err.cause?.code ?? err.code ?? err.name ?? 'unknown';
}
