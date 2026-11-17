import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeChunk, type WireFixture } from '../format.ts';
import { createReplayFetch, startReplayServer, WireReplayMismatchError } from '../replay.ts';
import { useReplayFetch, useReplayServer } from '../replay-vitest.ts';
import { SPLIT_CHUNKS, syntheticModels, syntheticStream } from './synthetic.ts';

// The 127.0.0.1 tests below expect each chunk to arrive as its own read. They rely on the
// server writing each chunk separately with Nagle off and a pause between writes, and on
// undici handing every socket read to the body stream as one chunk (the reviewer saw this hold
// even under a 150 ms event-loop stall). The fetch form does not depend on any of that.

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

  it('serves a null-body status without a body', async () => {
    const server = await startReplayServer(noContent());
    const res = await fetch(`${server.baseUrl}/models`);
    expect(res.status).toBe(204);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    await server.close();
  });
});

function noContent(): WireFixture {
  const f = syntheticModels();
  return { ...f, response: { ...f.response, status: 204, chunks: [] } };
}

// Review item 12: the fixture slot is claimed in call order, not in body-read order.
describe('concurrent calls', () => {
  it('matches each call to the fixture in call order', async () => {
    const replay = createReplayFetch([syntheticStream(), syntheticModels()]);
    const [a, b] = await Promise.all([
      replay('http://x/v1/chat/completions', request()),
      replay('http://x/v1/models'),
    ]);
    expect(a.headers.get('content-type')).toBe('text/event-stream');
    expect(b.headers.get('content-type')).toBe('application/json');
    await a.arrayBuffer();
    await b.arrayBuffer();
    replay.assertDone();
  });
});

describe('replay options', () => {
  it("timing: 'recorded' waits for the recorded arrival offsets", async () => {
    const f = syntheticStream();
    f.response.headersAtMs = 5;
    f.response.chunks = f.response.chunks.map((c, i) => ({ ...c, atMs: 5 + i * 40 }));
    const started = performance.now();
    const res = await createReplayFetch(f, { timing: 'recorded' })(
      'http://x/v1/chat/completions',
      request(),
    );
    expect(await readChunks(res)).toEqual(SPLIT_CHUNKS);
    expect(performance.now() - started).toBeGreaterThanOrEqual(115);
  });

  it('serves a 204 with a null body', async () => {
    const res = await createReplayFetch(noContent())('http://x/v1/models');
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});

// Review item 13: the final assertion is tied to the test, so a swallowed mismatch still fails.
describe('useReplayFetch / useReplayServer', () => {
  it('pass when every exchange is requested and matches', async () => {
    const replay = useReplayFetch(syntheticModels());
    expect((await replay('http://x/v1/models')).status).toBe(200);
    const server = await useReplayServer(syntheticModels());
    expect((await fetch(`${server.baseUrl}/models`)).status).toBe(200);
  });

  it('fail a test that swallows a mismatch', { timeout: 60_000 }, async () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const dir = await mkdtemp(join(here, '.nested-'));
    const vitest = fileURLToPath(
      new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url),
    );
    const helper = fileURLToPath(new URL('../replay-vitest.ts', import.meta.url));
    const synthetic = fileURLToPath(new URL('./synthetic.ts', import.meta.url));
    try {
      await writeFile(join(dir, 'vitest.config.mjs'), 'export default {};\n');
      await writeFile(
        join(dir, 'nested.test.ts'),
        [
          "import { it } from 'vitest';",
          `import { useReplayFetch, useReplayServer } from ${JSON.stringify(helper)};`,
          `import { syntheticModels } from ${JSON.stringify(synthetic)};`,
          "it('fetch: swallowed', async () => {",
          '  const replay = useReplayFetch(syntheticModels());',
          "  await replay('http://x/v1/wrong').catch(() => 'treated as unsupported');",
          '});',
          "it('server: swallowed', async () => {",
          '  const server = await useReplayServer(syntheticModels());',
          "  await fetch(server.baseUrl + '/wrong').catch(() => 'treated as unsupported');",
          '});',
          "it('fetch: unused exchange', () => { useReplayFetch(syntheticModels()); });",
          "it('fetch: clean', async () => {",
          '  const replay = useReplayFetch(syntheticModels());',
          "  await replay('http://x/v1/models');",
          '});',
        ].join('\n'),
      );
      const run = spawnSync(
        process.execPath,
        [
          vitest,
          'run',
          '--root',
          dir,
          '--config',
          join(dir, 'vitest.config.mjs'),
          '--reporter=json',
          `--outputFile=${join(dir, 'report.json')}`,
        ],
        { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR } },
      );
      expect(run.status).toBe(1);
      const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as {
        testResults: { assertionResults: { title: string; status: string }[] }[];
      };
      const status = Object.fromEntries(
        report.testResults.flatMap((r) => r.assertionResults.map((a) => [a.title, a.status])),
      );
      expect(status).toEqual({
        'fetch: swallowed': 'failed',
        'server: swallowed': 'failed',
        'fetch: unused exchange': 'failed',
        'fetch: clean': 'passed',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
