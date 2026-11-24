// Redaction for recorded exchanges (S§5.13: secrets never leave the process). Pure functions.
// The recorder runs `redactExchange` on every exchange; the separate, stricter net in
// `leak-check.ts` then decides whether the result may be written. The two share no code.
import {
  bodyBytes,
  decodeChunk,
  encodeChunk,
  isSensitiveName,
  type JsonValue,
  REDACTED,
  type WireFixture,
} from './format.ts';

const MASK = 0x2a; // '*': response bytes are masked in place so chunk lengths do not change.
const WINDOW = 8; // any run of this many characters of a secret is masked

type Span = [start: number, end: number];

// Every pattern is ASCII and uses explicit ASCII whitespace (never `\s`, which also matches
// U+00A0 and so byte 0xA0 in the latin1 view of UTF-8), so the same expressions work on text and
// on a latin1 view of raw bytes, where string indices are byte offsets.
const WHOLE_MATCH = [
  /\bsk-[A-Za-z0-9_*.-]{3,}/g, // `sk-` keys (OpenAI, OpenRouter), including masked echoes
  /\b(?:org|user|proj)[-_][A-Za-z0-9]{16,}\b/g, // OpenAI-style organisation/user/project ids
  /\bft:[A-Za-z0-9._:-]+/g, // fine-tuned model ids name the owning organisation
];
const GROUP_ONE = [
  /\b(?:Bearer|Basic)[ \t]+([A-Za-z0-9._~+/=*-]{8,})/dg,
  /(?:\/home\/|\/Users\/|\\\\Users\\\\|\\Users\\)([^/\\" \t\r\n\f\v]+)/dg, // local user names
  // Anthropic request ids (`req_…`, error bodies) and message ids (`msg_…`): each names one
  // request in Anthropic's logs, which no test needs. The prefix stays readable.
  /\b(?:req|msg)_([A-Za-z0-9]{16,})/dg,
  // Anthropic thinking signatures and redacted-thinking data: opaque encrypted blobs whose
  // binding (account, conversation) cannot be verified, so all but the first 8 characters are
  // masked. Matched only in their Messages API shapes: a `signature_delta`, a `thinking` block
  // (its `thinking` text may come first) and a `redacted_thinking` block. Other `signature`
  // fields (OpenRouter `reasoning_details[].signature`) are left alone, and values of 8
  // characters or fewer (the empty one of content_block_start) are not touched.
  /"type"[ \t\r\n]*:[ \t\r\n]*"signature_delta"[ \t\r\n]*,[ \t\r\n]*"signature"[ \t\r\n]*:[ \t\r\n]*"[^"\\]{8}((?:[^"\\]|\\.)+)"/dg,
  /"type"[ \t\r\n]*:[ \t\r\n]*"thinking"[ \t\r\n]*,[ \t\r\n]*(?:"thinking"[ \t\r\n]*:[ \t\r\n]*"(?:[^"\\]|\\.)*"[ \t\r\n]*,[ \t\r\n]*)?"signature"[ \t\r\n]*:[ \t\r\n]*"[^"\\]{8}((?:[^"\\]|\\.)+)"/dg,
  /"type"[ \t\r\n]*:[ \t\r\n]*"redacted_thinking"[ \t\r\n]*,[ \t\r\n]*"data"[ \t\r\n]*:[ \t\r\n]*"[^"\\]{8}((?:[^"\\]|\\.)+)"/dg,
];

/** The blob field of an Anthropic thinking-shaped JSON object, if it has one (see GROUP_ONE). */
function thinkingBlobField(o: Readonly<Record<string, JsonValue>>): string | null {
  if (o.type === 'thinking' || o.type === 'signature_delta') return 'signature';
  if (o.type === 'redacted_thinking') return 'data';
  return null;
}
const JSON_STRING_FIELD = /"([A-Za-z0-9_-]{1,64})"[ \t\r\n]*:[ \t\r\n]*"((?:[^"\\\r\n]|\\.)*)"/dg;
const QUERY_PARAM = /[?&]([A-Za-z0-9_.-]+)=([^&"#\\ \t\r\n\f\v]*)/dg;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Base64 characters that depend only on the secret's bytes, at byte alignment 0, 1 and 2. */
function base64Cores(secret: string): string[] {
  const bytes = Buffer.from(secret, 'utf8');
  return [0, 1, 2].flatMap((k) => {
    const padded = Buffer.concat([Buffer.alloc(k), bytes]);
    const from = Math.ceil((8 * k) / 6);
    const to = Math.floor((8 * (k + bytes.length)) / 6);
    return [padded.toString('base64'), padded.toString('base64url')].map((s) => s.slice(from, to));
  });
}

/** The literal forms of each secret that redaction looks for, matched case-insensitively. */
function secretForms(secrets: readonly string[]): string[] {
  const forms = secrets.flatMap((s) => {
    const json = JSON.stringify(s).slice(1, -1);
    const windows = Array.from({ length: Math.max(0, s.length - WINDOW + 1) }, (_, i) =>
      s.slice(i, i + WINDOW),
    );
    return [
      s,
      json,
      json.replaceAll('/', '\\/'),
      encodeURIComponent(s),
      encodeURIComponent(encodeURIComponent(s)),
      ...base64Cores(s),
      ...windows,
    ].filter((f) => f.length >= Math.min(WINDOW, s.length));
  });
  return [...new Set(forms)];
}

function spans(text: string, forms: readonly string[]): Span[] {
  const found: Span[] = [];
  for (const form of forms) {
    const re = new RegExp(escapeRegExp(form), 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push([m.index, m.index + m[0].length]);
      re.lastIndex = m.index + 1; // overlapping occurrences too
    }
  }
  for (const re of WHOLE_MATCH) {
    for (const m of text.matchAll(re)) found.push([m.index, m.index + m[0].length]);
  }
  for (const re of GROUP_ONE) {
    for (const m of text.matchAll(re)) if (m.indices?.[1]) found.push([...m.indices[1]]);
  }
  for (const re of [JSON_STRING_FIELD, QUERY_PARAM]) {
    for (const m of text.matchAll(re)) {
      const value = m.indices?.[2];
      if (isSensitiveName(m[1] ?? '') && value && value[1] > value[0]) found.push([...value]);
    }
  }
  return merge(found);
}

function merge(found: Span[]): Span[] {
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

/** Is there a JSON escape (`\x` or `\uXXXX`) starting at i? Its backslash must not itself be
 * escaped, i.e. preceded by an even number of backslashes. */
function escapeLength(t: string, i: number): number {
  if (t[i] !== '\\') return 0;
  let run = 0;
  for (let j = i - 1; j >= 0 && t[j] === '\\'; j--) run++;
  if (run % 2 === 1) return 0;
  return t[i + 1] === 'u' ? 6 : 2;
}

/** Widens a span so it never splits a JSON escape or a UTF-8 sequence; masking it then keeps a
 * JSON body valid and the bytes valid UTF-8. */
function align(t: string, bytes: Uint8Array, [s, e]: Span): Span {
  for (let i = s - 1; i >= Math.max(0, s - 5); i--) {
    const len = escapeLength(t, i);
    if (len > 0) {
      if (i + len > s) s = i;
      break;
    }
  }
  for (let i = e - 1; i >= Math.max(0, e - 6); i--) {
    const len = escapeLength(t, i);
    if (len > 0) {
      if (i + len > e) e = Math.min(t.length, i + len);
      break;
    }
  }
  while (s > 0 && ((bytes[s] ?? 0) & 0xc0) === 0x80) s--;
  while (e < bytes.length && ((bytes[e] ?? 0) & 0xc0) === 0x80) e++;
  return [s, e];
}

/** Same patterns as `redactText`, applied to raw bytes and masked to the same length. */
export function maskBytes(bytes: Uint8Array, secrets: readonly string[]): Uint8Array {
  const latin1 = Buffer.from(bytes).toString('latin1');
  const forms = secretForms(secrets).map((s) => Buffer.from(s, 'utf8').toString('latin1'));
  const out = new Uint8Array(bytes);
  for (const [start, end] of merge(spans(latin1, forms).map((sp) => align(latin1, bytes, sp)))) {
    out.fill(MASK, start, end);
  }
  return out;
}

export function redactJson(value: JsonValue, secrets: readonly string[]): JsonValue {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, secrets));
  if (value === null || typeof value !== 'object') return value;
  const blob = thinkingBlobField(value);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => {
      if (k === blob && typeof v === 'string' && v.length > 8) {
        return [k, `${redactText(v.slice(0, 8), secrets)}${REDACTED}`];
      }
      return [
        k,
        isSensitiveName(k) && (v === null || typeof v !== 'object')
          ? REDACTED
          : redactJson(v, secrets),
      ];
    }),
  );
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  secrets: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (!isSensitiveName(name, 'header')) return [name, redactText(value, secrets)];
      const scheme = /authorization$/.test(name) ? /^([A-Za-z]+) /.exec(value)?.[1] : undefined;
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
  // Anthropic: whether the SDKs may retry an error response (a client's retry policy reads it).
  'x-should-retry',
]);
/** Rate-limit headers: OpenAI-style, and the Anthropic Messages API's own. Limits, remaining
 * counts and reset times; no account or request identifier. */
const KEPT_RESPONSE_PREFIXES = ['x-ratelimit-', 'anthropic-ratelimit-'];

/** Keeps allow-listed response headers and names the rest. Values of dropped headers are never
 * stored. `content-encoding` is dropped because fetch has already decoded the body. Identifiers
 * such as `request-id`, `x-request-id`, `anthropic-organization-id` and
 * `anthropic-workspace-id` are dropped by not being on the list. */
export function selectResponseHeaders(entries: Iterable<[string, string]>): {
  headers: Record<string, string>;
  omitted: string[];
} {
  const headers: Record<string, string> = {};
  const omitted = new Set<string>();
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    const kept =
      KEPT_RESPONSE_HEADERS.has(name) || KEPT_RESPONSE_PREFIXES.some((p) => name.startsWith(p));
    if (kept && !isSensitiveName(name, 'header')) headers[name] = value;
    else omitted.add(name);
  }
  return { headers, omitted: [...omitted].sort() };
}

/** Redacts one exchange, meta included. Response bytes are masked across chunk boundaries (a
 * secret split over two chunks is still found) and re-split at the recorded boundaries. */
export function redactExchange(f: WireFixture, secrets: readonly string[]): WireFixture {
  const masked = maskBytes(bodyBytes(f), secrets);
  let offset = 0;
  const chunks = f.response.chunks.map((chunk) => {
    const length = decodeChunk(chunk).length;
    offset += length;
    return encodeChunk(masked.subarray(offset - length, offset), chunk.atMs);
  });
  const text = (s: string) => redactText(s, secrets);
  const { serverVersion, notes } = f.meta;
  return {
    ...f,
    meta: {
      ...f.meta,
      model: text(f.meta.model),
      serverVersion: serverVersion === null ? null : text(serverVersion),
      basePath: text(f.meta.basePath),
      ...(notes === undefined ? {} : { notes: text(notes) }),
    },
    request: {
      ...f.request,
      path: text(f.request.path),
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
