// The one place a channel makes an HTTP request.
//
// Channels use the platform fetch with a deadline and no redirects followed, NOT the shop-fetch
// guard of packages/fetch. A notification target (an ntfy server, a webhook URL) is set by the
// owner through a human-only door (S§5.15: REST and UI with a session, no tool), and it is very
// often on the LAN (a self-hosted ntfy at 192.168.x.x), which the SSRF guard exists to refuse for
// page-derived URLs. No text read from the web can choose or change a target (S§2.7): the URL
// comes only from the channel's config_json, which only the channel service writes, and only from
// a request of the owner's session. A message's own URL (the listing link) travels in the body,
// never as a request target. Redirects are not followed, so a target cannot bounce a request (and
// its token) to another host.
import type { ChannelOutcome, ErrorClass, SendContext } from './types.ts';

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA']);
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
]);

const MAX_DETAIL = 200;

/** Replaces every occurrence of a secret in text, and drops control characters. */
export function redact(text: string, secrets: readonly (string | null)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join('[redacted]');
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed.
  return out.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

function errorCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const errors = (e as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const inner = (errors[0] as { code?: unknown }).code;
      if (typeof inner === 'string') return inner;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Classifies a thrown fetch error: a transport failure (retried) or something else (failed). */
export function classifyFetchError(error: unknown, timedOut: boolean): ChannelOutcome {
  const name = (error as { name?: unknown }).name;
  if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
    return transport('timeout', 'the request did not finish before its deadline');
  }
  const code = errorCode(error);
  if (code !== undefined) {
    if (DNS_CODES.has(code)) return transport('dns', `name resolution failed (${code})`);
    if (TIMEOUT_CODES.has(code)) return transport('timeout', `timed out (${code})`);
    if (CONNECT_CODES.has(code)) return transport('connect', `connection failed (${code})`);
  }
  // TLS certificate problems, an invalid URL, a refused header: retrying cannot help.
  return {
    attempt: { kind: 'unclassified_error' },
    errorClass: 'unclassified',
    detail: code ? `request failed (${code})` : 'request failed',
  };
}

function transport(cause: 'dns' | 'connect' | 'timeout', detail: string): ChannelOutcome {
  return { attempt: { kind: 'transport_error', cause }, errorClass: 'transport', detail };
}

function classOfStatus(status: number): ErrorClass {
  if (status >= 300 && status < 400) return 'redirect';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 425 || status >= 500) return 'server';
  return 'payload';
}

export interface PostRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Values to scrub from any detail text (the channel's token). */
  readonly secrets: readonly (string | null)[];
}

/**
 * POSTs once and classifies the answer: 2xx is accepted (the channel confirmed acceptance); a
 * redirect is not followed and counts as a status; any other status carries its Retry-After.
 */
export async function postOnce(
  request: PostRequest,
  context: SendContext,
): Promise<ChannelOutcome> {
  const deadline = AbortSignal.timeout(context.timeoutMs);
  const signal = AbortSignal.any([context.signal, deadline]);
  let response: Response;
  try {
    response = await context.fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    return classifyFetchError(error, deadline.aborted);
  }
  let text = '';
  try {
    text = (await response.text()).slice(0, MAX_DETAIL * 2);
  } catch {
    // The status is the answer; a body cut short changes nothing.
  }
  if (response.status >= 200 && response.status < 300) {
    return { attempt: { kind: 'accepted' }, errorClass: null, detail: null };
  }
  const detail = redact(`HTTP ${response.status}${text ? `: ${text}` : ''}`, request.secrets).slice(
    0,
    MAX_DETAIL,
  );
  return {
    attempt: {
      kind: 'http_status',
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
    },
    errorClass: classOfStatus(response.status),
    detail,
  };
}
