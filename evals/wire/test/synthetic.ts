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

/** Messages API SSE (named events), split mid-event. Made up, in the documented event order. */
export const MESSAGES_CHUNKS: readonly Uint8Array[] = [
  enc.encode(
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_synthetic","type":"message","role":"assistant","content":[],"model":"synthetic-model","stop_reason":null,"usage":{"input_tokens":5,"output_tokens":1}}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  ),
  enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"del'),
  enc.encode(
    'ta":{"type":"text_delta","text":"ready"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
  ),
];

export function syntheticMessagesStream(): WireFixture {
  const f = syntheticStream({ serverFamily: 'anthropic', scenario: 'messages-stream' });
  return {
    ...f,
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: {
        'x-api-key': '[REDACTED]',
        'anthropic-version': '2026-10-21',
        'content-type': 'application/json',
      },
      body: {
        model: 'synthetic-model',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
    },
    response: {
      ...f.response,
      chunks: MESSAGES_CHUNKS.map((bytes, i) => encodeChunk(bytes, 10 + i * 10)),
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
