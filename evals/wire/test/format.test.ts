import { describe, expect, it } from 'vitest';
import {
  bodyBytes,
  decodeChunk,
  encodeChunk,
  parseFixture,
  serializeFixture,
  WireFixtureSchema,
} from '../format.ts';
import { SPLIT_CHUNKS, syntheticStream } from './synthetic.ts';

describe('chunk encoding', () => {
  it('stores valid UTF-8 as text and anything else as base64, byte for byte', () => {
    for (const bytes of SPLIT_CHUNKS) {
      expect(decodeChunk(encodeChunk(bytes, 0))).toEqual(bytes);
    }
    expect(encodeChunk(SPLIT_CHUNKS[0] ?? new Uint8Array(), 0)).toHaveProperty('utf8');
    // The chunks that end or start inside 'é' are not valid UTF-8 on their own.
    expect(encodeChunk(SPLIT_CHUNKS[2] ?? new Uint8Array(), 0)).toHaveProperty('base64');
    expect(encodeChunk(SPLIT_CHUNKS[3] ?? new Uint8Array(), 0)).toHaveProperty('base64');
  });

  it('keeps a leading byte-order mark', () => {
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf, 0x61);
    expect(decodeChunk(encodeChunk(bom, 0))).toEqual(bom);
  });

  it('reassembles the body from the chunks', () => {
    const text = new TextDecoder().decode(bodyBytes(syntheticStream()));
    expect(text).toContain('"content":"lo cafxé"');
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  });
});

describe('fixture validation', () => {
  it('accepts a well-formed fixture and survives serialisation', () => {
    const f = syntheticStream();
    expect(parseFixture(JSON.parse(serializeFixture(f)))).toEqual(f);
  });

  const broken: Record<string, (f: ReturnType<typeof syntheticStream>) => unknown> = {
    'missing synthetic flag': (f) => ({ ...f, meta: { ...f.meta, synthetic: undefined } }),
    'unknown server family': (f) => ({ ...f, meta: { ...f.meta, serverFamily: 'acme' } }),
    'bad scenario id': (f) => ({ ...f, meta: { ...f.meta, scenario: 'Stream Usage' } }),
    'relative path': (f) => ({ ...f, request: { ...f.request, path: 'v1/models' } }),
    'upper-case header name': (f) => ({
      ...f,
      request: { ...f.request, headers: { Authorization: 'x' } },
    }),
    'chunk with text and base64': (f) => ({
      ...f,
      response: { ...f.response, chunks: [{ atMs: 1, utf8: 'a', base64: 'YQ==' }] },
    }),
    'chunk that is not base64': (f) => ({
      ...f,
      response: { ...f.response, chunks: [{ atMs: 1, base64: '***' }] },
    }),
    'arrival offsets going backwards': (f) => ({
      ...f,
      response: {
        ...f.response,
        chunks: [
          { atMs: 20, utf8: 'a' },
          { atMs: 10, utf8: 'b' },
        ],
      },
    }),
    'chunk before the headers': (f) => ({
      ...f,
      response: { ...f.response, headersAtMs: 50, chunks: [{ atMs: 10, utf8: 'a' }] },
    }),
    'status out of range': (f) => ({ ...f, response: { ...f.response, status: 700 } }),
    'unknown top-level key': (f) => ({ ...f, extra: true }),
  };

  for (const [name, mutate] of Object.entries(broken)) {
    it(`rejects ${name}`, () => {
      expect(WireFixtureSchema.safeParse(mutate(syntheticStream())).success).toBe(false);
    });
  }
});
