// Wire-fixture format (S§5.16, P§0 workstream 6): one HTTP exchange with an OpenAI-compatible
// server, recorded so the Phase 2 client and capability probe can be tested without a model.
// The response body is kept as the ordered chunks the client read, each with its arrival
// offset, so SSE chunk boundaries survive byte for byte. See README.md.
import { z } from 'zod';

export const FORMAT_VERSION = 1;
export const RECORDER_VERSION = '0.2.0';
export const SERVER_FAMILIES = [
  'openrouter',
  'openai',
  'vllm',
  'ollama',
  'llamacpp',
  'other',
] as const;
export type ServerFamily = (typeof SERVER_FAMILIES)[number];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Statuses whose response has no body; a fixture with one of them has no chunks. */
export const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

export const REDACTED = '[REDACTED]';

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
  'organization',
  'organisation',
  'org',
  'project',
  'user',
  'account',
]);
// `signature` names a credential in a header, but in a body it is data a client must read
// (OpenRouter `reasoning_details[].signature`), so it is sensitive for headers only.
const SENSITIVE_HEADER_WORDS = new Set(['signature']);
const SENSITIVE_JOINED = new Set(['key', 'token', 'accesstoken', 'refreshtoken', 'idtoken']);
const NOT_SENSITIVE = new Set(['user-agent']);

/** Is a header name, JSON key or query parameter name likely to carry a credential or an
 * account identifier? Deliberately broad; a false positive only costs fixture detail. */
export function isSensitiveName(name: string, kind: 'header' | 'field' = 'field'): boolean {
  if (NOT_SENSITIVE.has(name.toLowerCase())) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words.join('');
  return (
    words.some((w) => SENSITIVE_WORDS.has(w)) ||
    (kind === 'header' && words.some((w) => SENSITIVE_HEADER_WORDS.has(w))) ||
    SENSITIVE_JOINED.has(joined) ||
    words.at(-1) === 'key' ||
    /(auth|access|api|session)token$/.test(joined)
  );
}

/** A sensitive header must hold `[REDACTED]` or `<Scheme> [REDACTED]`. */
const isRedactedValue = (v: string) => v === REDACTED || /^[A-Za-z]+ \[REDACTED\]$/.test(v);

const ms = z.number().finite().nonnegative();
const headerMap = z
  .record(z.string().regex(/^[a-z0-9-]+$/), z.string())
  .refine(
    (h) => Object.entries(h).every(([k, v]) => !isSensitiveName(k, 'header') || isRedactedValue(v)),
    { message: 'a credential-like header must hold a redacted value' },
  );

/** Milliseconds since the request was sent, then the bytes: UTF-8 text when the chunk is valid
 * UTF-8 on its own, otherwise base64 (for example a character split across two chunks). */
export const BodyChunkSchema = z.union([
  z.strictObject({
    atMs: ms,
    utf8: z
      .string()
      .min(1)
      .refine((s) => s.isWellFormed(), 'not well-formed UTF-16'),
  }),
  z.strictObject({
    atMs: ms,
    base64: z
      .base64()
      .min(1)
      .refine((s) => Buffer.from(s, 'base64').toString('base64') === s, 'not canonical base64'),
  }),
]);
export type BodyChunk = z.infer<typeof BodyChunkSchema>;

export const MetaSchema = z.strictObject({
  serverFamily: z.enum(SERVER_FAMILIES),
  /** As the server reports it, or as the person recording states it; null when unknown. */
  serverVersion: z.string().min(1).max(200).nullable(),
  model: z.string().min(1),
  scenario: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Path part of the base URL the session used, e.g. `/v1` or `/api/v1`. */
  basePath: z.string().startsWith('/'),
  recordedAt: z.iso.datetime(),
  recorderVersion: z.string().min(1),
  /** True for hand-written exchanges. Those never describe a real server. */
  synthetic: z.boolean(),
  notes: z.string().optional(),
});

export const WireFixtureSchema = z
  .strictObject({
    formatVersion: z.literal(FORMAT_VERSION),
    meta: MetaSchema,
    request: z.strictObject({
      method: z.enum(['GET', 'POST']),
      /** Path and query from the server root, redacted. The host is not stored. */
      path: z.string().startsWith('/'),
      /** The headers the recorder set, redacted. Not everything on the wire: fetch (undici)
       * adds its own, such as `host`, `connection`, `accept-language` and `sec-fetch-mode`. */
      headers: headerMap,
      /** The JSON body as sent (redacted); null when there was no body. */
      body: z.json().nullable(),
    }),
    response: z.strictObject({
      status: z.int().min(200).max(599),
      headersAtMs: ms,
      /** The allow-listed headers only; `omittedHeaders` names the others (no values). */
      headers: headerMap,
      omittedHeaders: z.array(z.string()),
      /** As received. A body cut short by a closed connection is recorded as it arrived. */
      chunks: z.array(BodyChunkSchema),
    }),
  })
  .superRefine((f, ctx) => {
    if (NULL_BODY_STATUSES.has(f.response.status) && f.response.chunks.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['response', 'chunks'],
        message: `status ${f.response.status} has no body`,
      });
    }
    let previous = f.response.headersAtMs;
    for (const [i, chunk] of f.response.chunks.entries()) {
      if (chunk.atMs < previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['response', 'chunks', i, 'atMs'],
          message: 'arrival offsets must not decrease or precede the headers',
        });
      }
      previous = chunk.atMs;
    }
  });
export type WireFixture = z.infer<typeof WireFixtureSchema>;

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function encodeChunk(bytes: Uint8Array, atMs: number): BodyChunk {
  try {
    return { atMs, utf8: strictUtf8.decode(bytes) };
  } catch {
    return { atMs, base64: Buffer.from(bytes).toString('base64') };
  }
}

export function decodeChunk(chunk: BodyChunk): Uint8Array {
  return 'utf8' in chunk
    ? new TextEncoder().encode(chunk.utf8)
    : new Uint8Array(Buffer.from(chunk.base64, 'base64'));
}

export function bodyBytes(f: WireFixture): Uint8Array {
  return new Uint8Array(Buffer.concat(f.response.chunks.map(decodeChunk)));
}

export function parseFixture(value: unknown): WireFixture {
  return WireFixtureSchema.parse(value);
}

export function serializeFixture(f: WireFixture): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}
