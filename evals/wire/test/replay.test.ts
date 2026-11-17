import { describe, expect, it } from 'vitest';
import { decodeChunk } from '../format.ts';
import { createReplayFetch, startReplayServer, WireReplayMismatchError } from '../replay.ts';
import { SPLIT_CHUNKS, syntheticModels, syntheticStream } from './synthetic.ts';

async function readChunks(res: Response): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const reader = res.body?.getReader();
  for (;;) {
    const r = await reader?.read();
    if (!r || r.done) return out;
    out.push(r.value);
  }
}

const request = (body: unknown = syntheticStream().request.body): RequestInit => ({
  method: 'POST',
  headers: { authorization: 'Bearer anything', 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('replay fetch', () => {
  it('returns the recorded status, headers and exact chunk boundaries', async () => {
    const replay = createReplayFetch(syntheticStream());
    const res = await replay('http://127.0.0.1:1/v1/chat/completions', request());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await readChunks(res)).toEqual(SPLIT_CHUNKS);
    replay.assertDone();
  });

  it('serves a sequence in order and accepts a Request object', async () => {
    const replay = createReplayFetch([syntheticModels(), syntheticStream()]);
    expect((await replay(new Request('http://x/v1/models'))).status).toBe(200);
    await (await replay('http://x/v1/chat/completions', request())).arrayBuffer();
    replay.assertDone();
  });

  it.each([
    ['wrong path', 'http://x/v1/completions', request()],
    ['wrong method', 'http://x/v1/chat/completions', { ...request(), method: 'PUT' }],
    ['different body', 'http://x/v1/chat/completions', request({ model: 'other', stream: true })],
    ['no body', 'http://x/v1/chat/completions', { ...request(), body: undefined }],
    [
      'missing authorization',
      'http://x/v1/chat/completions',
      { ...request(), headers: { 'content-type': 'application/json' } },
    ],
    [
      'wrong content type',
      'http://x/v1/chat/completions',
      { ...request(), headers: { authorization: 'Bearer a', 'content-type': 'text/plain' } },
    ],
  ])('rejects a request with %s', async (_name, url, init) => {
    const replay = createReplayFetch(syntheticStream());
    await expect(replay(url, init)).rejects.toBeInstanceOf(WireReplayMismatchError);
    expect(() => replay.assertDone()).toThrow(WireReplayMismatchError);
  });

  it('names the first differing body field', async () => {
    const replay = createReplayFetch(syntheticStream());
    const body = { ...(syntheticStream().request.body as object), stream: false };
    await expect(replay('http://x/v1/chat/completions', request(body))).rejects.toThrow(
      /\$\.stream/,
    );
  });

  it('fails on an extra request and on an exchange that was never requested', async () => {
    const extra = createReplayFetch(syntheticModels());
    await extra('http://x/v1/models');
    await expect(extra('http://x/v1/models')).rejects.toThrow(/unexpected request #2/);

    const unused = createReplayFetch([syntheticModels(), syntheticStream()]);
    await unused('http://x/v1/models');
    expect(() => unused.assertDone()).toThrow(/not requested/);
  });
});

describe('replay server on 127.0.0.1', () => {
  it('serves the recorded exchange with its chunk boundaries', async () => {
    const server = await startReplayServer(syntheticStream(), { chunkGapMs: 30 });
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const res = await fetch(`${server.baseUrl}/chat/completions`, request());
    expect(res.status).toBe(200);
    const chunks = await readChunks(res);
    expect(Buffer.concat(chunks)).toEqual(
      Buffer.concat(syntheticStream().response.chunks.map(decodeChunk)),
    );
    expect(chunks).toEqual(SPLIT_CHUNKS);
    await server.close();
  });

  it('drops the connection on a mismatch and reports it on close', async () => {
    const server = await startReplayServer(syntheticStream());
    await expect(fetch(`${server.baseUrl}/models`)).rejects.toThrow();
    expect(server.mismatches.length).toBe(1);
    await expect(server.close()).rejects.toBeInstanceOf(WireReplayMismatchError);
  });
});
