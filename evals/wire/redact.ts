// Redaction for recorded exchanges (S§5.13: secrets never leave the process). Pure functions:
// the recorder runs `redactExchange` on every exchange and then `findSecretLeaks`, and refuses
// to write if the secret is still there in any form it can recognise.
import {
  bodyBytes,
  decodeChunk,
  encodeChunk,
  type JsonValue,
  serializeFixture,
  type WireFixture,
} from './format.ts';

export const REDACTED = '[REDACTED]';
const MASK = 0x2a; // '*': response bytes are masked in place so chunk lengths do not change.

const SENSITIVE_WORDS = new Set([
  'authorization',
  'auth',
  'cookie',
  'apikey',
  'secret',
  'password',
  'passwd',
  'session',
  'credential',
  'credentials',
  'signature',
  'organization',
  'organisation',
  'org',
  'project',
  'user',
  'account',
]);
const SENSITIVE_JOINED = new Set(['key', 'token', 'accesstoken', 'refreshtoken', 'idtoken']);
const NOT_SENSITIVE = new Set(['user-agent']);

/** Is a header name, JSON key or query parameter name likely to carry a credential or an
 * account identifier? Deliberately broad; a false positive only costs fixture detail. */
export function isSensitiveName(name: string): boolean {
  if (NOT_SENSITIVE.has(name.toLowerCase())) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words.join('');
  return (
    words.some((w) => SENSITIVE_WORDS.has(w)) ||
    SENSITIVE_JOINED.has(joined) ||
    words.at(-1) === 'key' ||
    /(auth|access|api|session)token$/.test(joined)
  );
}

type Span = [start: number, end: number];

// Patterns that are redacted wherever they appear. Each is ASCII, so the same expressions work
// on a latin1 view of raw bytes, where string indices are byte offsets.
const WHOLE_MATCH = [
  /\bsk-[A-Za-z0-9_*.-]{8,}/g, // `sk-` keys (OpenAI, OpenRouter), including masked echoes
  /\b(?:org|user|proj)[-_][A-Za-z0-9]{16,}\b/g, // OpenAI-style organisation/user/project ids
  /\bft:[A-Za-z0-9._:-]+/g, // fine-tuned model ids name the owning organisation
];
const GROUP_ONE = [
  /\bBearer\s+([A-Za-z0-9._~+/=*-]{8,})/dg,
  /(?:\/home\/|\/Users\/|\\\\Users\\\\|\\Users\\)([^/\\"\s]+)/dg, // user names in local paths
];
const JSON_STRING_FIELD = /"([A-Za-z0-9_-]{1,64})"\s*:\s*"((?:[^"\\]|\\.)*)"/dg;
const QUERY_PARAM = /[?&]([A-Za-z0-9_.-]+)=([^&\s"#]*)/dg;

function secretForms(secrets: readonly string[]): string[] {
  const forms = secrets.flatMap((s) => [s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s)]);
  return [...new Set(forms.filter((s) => s.length > 0))];
}

function spans(text: string, secrets: readonly string[]): Span[] {
  const found: Span[] = [];
  for (const s of secrets) {
    for (let i = text.indexOf(s); i !== -1; i = text.indexOf(s, i + 1))
      found.push([i, i + s.length]);
  }
  for (const re of WHOLE_MATCH) {
    for (const m of text.matchAll(re)) found.push([m.index, m.index + m[0].length]);
  }
  for (const re of GROUP_ONE) {
    for (const m of text.matchAll(re)) if (m.indices?.[1]) found.push(m.indices[1]);
  }
  for (const re of [JSON_STRING_FIELD, QUERY_PARAM]) {
    for (const m of text.matchAll(re)) {
      const value = m.indices?.[2];
      if (isSensitiveName(m[1] ?? '') && value && value[1] > value[0]) found.push(value);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

export function redactText(text: string, secrets: readonly string[]): string {
  let out = '';
  let from = 0;
  for (const [start, end] of spans(text, secretForms(secrets))) {
    out += text.slice(from, start) + REDACTED;
    from = end;
  }
  return out + text.slice(from);
}

/** Same patterns as `redactText`, applied to raw bytes and masked to the same length. */
export function maskBytes(bytes: Uint8Array, secrets: readonly string[]): Uint8Array {
  const latin1 = Buffer.from(bytes).toString('latin1');
  const byteSecrets = secretForms(secrets).map((s) => Buffer.from(s, 'utf8').toString('latin1'));
  const out = new Uint8Array(bytes);
  for (const [start, end] of spans(latin1, byteSecrets)) out.fill(MASK, start, end);
  return out;
}

export function redactJson(value: JsonValue, secrets: readonly string[]): JsonValue {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, secrets));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      isSensitiveName(k) && (v === null || typeof v !== 'object')
        ? REDACTED
        : redactJson(v, secrets),
    ]),
  );
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (!isSensitiveName(name)) return [name, redactText(value, secrets)];
      const scheme = /authorization$/.test(name) ? /^([A-Za-z]+)\s/.exec(value)?.[1] : undefined;
      return [name, scheme ? `${scheme} ${REDACTED}` : REDACTED];
    }),
  );
}

const KEPT_RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'retry-after',
  'server',
  'openai-version',
  'openai-processing-ms',
  'x-litellm-response-cost',
]);

/** Keeps allow-listed response headers and names the rest. Values of dropped headers are never
 * stored. `content-encoding` is dropped because fetch has already decoded the body. */
export function selectResponseHeaders(entries: Iterable<[string, string]>): {
  headers: Record<string, string>;
  omitted: string[];
} {
  const headers: Record<string, string> = {};
  const omitted = new Set<string>();
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    const kept = KEPT_RESPONSE_HEADERS.has(name) || name.startsWith('x-ratelimit-');
    if (kept && !isSensitiveName(name)) headers[name] = value;
    else omitted.add(name);
  }
  return { headers, omitted: [...omitted].sort() };
}

/** Redacts one exchange. Response bytes are masked across chunk boundaries (a secret split
 * over two chunks is still found) and re-split at the recorded boundaries. */
export function redactExchange(f: WireFixture, secrets: readonly string[]): WireFixture {
  const masked = maskBytes(bodyBytes(f), secrets);
  let offset = 0;
  const chunks = f.response.chunks.map((chunk) => {
    const length = decodeChunk(chunk).length;
    offset += length;
    return encodeChunk(masked.subarray(offset - length, offset), chunk.atMs);
  });
  return {
    ...f,
    meta: { ...f.meta, basePath: redactText(f.meta.basePath, secrets) },
    request: {
      ...f.request,
      path: redactText(f.request.path, secrets),
      headers: redactHeaders(f.request.headers, secrets),
      body: f.request.body === null ? null : redactJson(f.request.body, secrets),
    },
    response: {
      ...f.response,
      headers: redactHeaders(f.response.headers, secrets),
      chunks,
    },
  };
}

const unescapeJson = (s: string) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** Where, if anywhere, a secret survives in what would be written. Empty means safe. */
export function findSecretLeaks(f: WireFixture, secrets: readonly string[]): string[] {
  const places: [string, string][] = [
    ['fixture file', serializeFixture(f)],
    ['response body', new TextDecoder().decode(bodyBytes(f))],
  ];
  const leaks: string[] = [];
  for (const [where, text] of places) {
    for (const candidate of [text, unescapeJson(text)]) {
      if (secretForms(secrets).some((s) => candidate.includes(s))) {
        leaks.push(candidate === text ? where : `${where} (behind JSON escapes)`);
        break;
      }
    }
  }
  return leaks;
}
