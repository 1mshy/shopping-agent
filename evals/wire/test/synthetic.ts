// Hand-written exchanges for the wire tooling's own tests. Every fixture here is
// `synthetic: true` and describes no real server: the family is `other` and the model id is
// made up. They are not recordings.
import { encodeChunk, FORMAT_VERSION, RECORDER_VERSION, type WireFixture } from '../format.ts';

const enc = new TextEncoder();

// One SSE event split across two chunks, and a two-byte UTF-8 character ('é' = C3 A9) split
// across two chunks.
const e = enc.encode('é');
export const SPLIT_CHUNKS: readonly Uint8Array[] = [
  enc.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choi'),
  enc.encode('ces":[{"delta":{"content":"lo caf'),
  Uint8Array.of(...enc.encode('x'), e[0] ?? 0),
  Uint8Array.of(e[1] ?? 0, ...enc.encode('"}}]}\n\ndata: [DONE]\n\n')),
];

export function syntheticStream(overrides: Partial<WireFixture['meta']> = {}): WireFixture {
  return {
    formatVersion: FORMAT_VERSION,
    meta: {
      serverFamily: 'other',
      serverVersion: null,
      model: 'synthetic-model',
      scenario: 'stream-usage',
      basePath: '/v1',
      recordedAt: '2026-01-01T00:00:00.000Z',
      recorderVersion: RECORDER_VERSION,
      synthetic: true,
      notes: 'Hand-written for the wire tooling tests. Not a recording of any server.',
      ...overrides,
    },
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { authorization: 'Bearer [REDACTED]', 'content-type': 'application/json' },
      body: { model: 'synthetic-model', messages: [{ role: 'user', content: 'hi' }], stream: true },
    },
    response: {
      status: 200,
      headersAtMs: 5,
      headers: { 'content-type': 'text/event-stream' },
      omittedHeaders: [],
      chunks: SPLIT_CHUNKS.map((bytes, i) => encodeChunk(bytes, 10 + i * 10)),
    },
  };
}

export function syntheticModels(): WireFixture {
  return {
    ...syntheticStream({ scenario: 'models-list' }),
    request: { method: 'GET', path: '/v1/models', headers: {}, body: null },
    response: {
      status: 200,
      headersAtMs: 1,
      headers: { 'content-type': 'application/json' },
      omittedHeaders: [],
      chunks: [encodeChunk(enc.encode('{"object":"list","data":[]}'), 2)],
    },
  };
}
