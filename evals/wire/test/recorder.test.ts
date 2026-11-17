import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeChunk, parseFixture, type WireFixture } from '../format.ts';
import {
  recordExchange,
  recordSession,
  runCli,
  SecretLeakError,
  type SessionOptions,
} from '../recorder.ts';
import { createReplayFetch, startReplayServer } from '../replay.ts';
import { scenarioById } from '../scenarios.ts';
import { type SeenRequest, startScriptedServer } from './scripted-server.ts';
import { SPLIT_CHUNKS } from './synthetic.ts';

const SECRET = 'wire-test-secret-7f3a9c2e5b1d';
const RECORD_TS = fileURLToPath(new URL('../record.ts', import.meta.url));

// The scripted server echoes the bearer token it received, sets a cookie and an organisation
// header, and answers a wrong key with 401, so redaction has something real to remove.
function route(req: SeenRequest) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const noise = { 'set-cookie': 'sid=s3ss10n', 'openai-organization': 'org-abcdefghijklmnop1234' };
  if (token !== SECRET) {
    return {
      status: 401,
      headers: { 'content-type': 'application/json', ...noise },
      chunks: [`{"error":{"message":"Incorrect API key provided: ${token}"}}`],
    };
  }
  if (req.url === '/v1/models') {
    return {
      status: 200,
      headers: { 'content-type': 'application/json', ...noise },
      chunks: [`{"object":"list","data":[{"id":"m","owned_by":"${token}"}]}`],
    };
  }
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...noise },
    chunks: SPLIT_CHUNKS,
  };
}

let server: Awaited<ReturnType<typeof startScriptedServer>>;
let out: string;
beforeEach(async () => {
  server = await startScriptedServer(route);
  out = await mkdtemp(join(tmpdir(), 'wire-rec-'));
});
afterEach(async () => {
  await server.close();
  await rm(out, { recursive: true, force: true });
});

function options(over: Partial<SessionOptions> = {}): SessionOptions {
  return {
    baseUrl: `${server.origin}/v1`,
    model: 'scripted-model',
    family: 'other',
    scenarios: ['models-list', 'stream-usage', 'error-bad-credentials'].map(scenarioById),
    apiKey: SECRET,
    outDir: out,
    serverVersion: null,
    maxTokensField: 'max_completion_tokens',
    timeoutMs: 10_000,
    ...over,
  };
}

async function writtenFixtures(): Promise<Map<string, { text: string; fixture: WireFixture }>> {
  const dir = join(out, 'other', 'scripted-model');
  const files = new Map<string, { text: string; fixture: WireFixture }>();
  for (const name of await readdir(dir)) {
    const text = await readFile(join(dir, name), 'utf8');
    files.set(name, { text, fixture: parseFixture(JSON.parse(text)) });
  }
  return files;
}

function expectClean(text: string): void {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('s3ss10n');
  expect(text).not.toContain('org-abcdefghijklmnop1234');
}

describe('record then replay against a scripted server', () => {
  it('writes valid, redacted fixtures that keep chunk boundaries', async () => {
    const result = await recordSession(options());
    expect(result.failed).toEqual([]);
    const files = await writtenFixtures();
    expect([...files.keys()].sort()).toEqual([
      'error-bad-credentials.json',
      'models-list.json',
      'stream-usage.json',
    ]);
    for (const { text } of files.values()) expectClean(text);

    const stream = files.get('stream-usage.json')?.fixture as WireFixture;
    expect(stream.meta).toMatchObject({
      synthetic: false,
      basePath: '/v1',
      scenario: 'stream-usage',
    });
    expect(stream.request.headers.authorization).toBe('Bearer [REDACTED]');
    expect(stream.response.omittedHeaders).toEqual(
      expect.arrayContaining(['openai-organization', 'set-cookie']),
    );
    expect(stream.response.chunks.map(decodeChunk)).toEqual(SPLIT_CHUNKS);

    const bad = files.get('error-bad-credentials.json')?.fixture as WireFixture;
    expect(bad.response.status).toBe(401);

    // Replay the stream fixture the way a client under test would see it.
    const body = JSON.stringify(stream.request.body);
    const init = {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body,
    };
    const replayFetch = createReplayFetch(stream);
    const res = await replayFetch('http://any/v1/chat/completions', init);
    const viaFetch: Uint8Array[] = [];
    for await (const c of res.body ?? []) viaFetch.push(c);
    expect(viaFetch).toEqual(SPLIT_CHUNKS);

    const replayServer = await startReplayServer(stream, { chunkGapMs: 30 });
    const res2 = await fetch(`${replayServer.baseUrl}/chat/completions`, init);
    const viaServer: Uint8Array[] = [];
    for await (const c of res2.body ?? []) viaServer.push(c);
    expect(viaServer).toEqual(SPLIT_CHUNKS);
    await replayServer.close();
  });

  it('records exactly the chunks fetch yields', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            for (const chunk of SPLIT_CHUNKS) c.enqueue(chunk);
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const f = await recordExchange(scenarioById('stream-usage'), options({ fetch: fakeFetch }));
    expect(f.response.chunks.map(decodeChunk)).toEqual(SPLIT_CHUNKS);
  });

  it('fails closed: refuses to write when the secret survives redaction', async () => {
    await server.close();
    const escaped = [...SECRET].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    server = await startScriptedServer(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      chunks: [`{"echo":"${escaped.join('')}"}`],
    }));
    await expect(
      recordSession(options({ scenarios: [scenarioById('models-list')] })),
    ).rejects.toBeInstanceOf(SecretLeakError);
    expect(await readdir(out)).toEqual([]);
  });

  it('refuses a model id that contains the secret', async () => {
    await expect(
      recordSession(options({ model: `m-${SECRET}`, scenarios: [scenarioById('models-list')] })),
    ).rejects.toBeInstanceOf(SecretLeakError);
    expect(await readdir(out)).toEqual([]);
  });
});

describe('command line', () => {
  it('runs end to end as `node evals/wire/record.ts`', async () => {
    const args = [
      RECORD_TS,
      ...['--base-url', `${server.origin}/v1`, '--model', 'scripted-model', '--family', 'other'],
      ...['--scenarios', 'models-list,stream-usage,error-bad-credentials'],
      ...['--api-key-env', 'WIRE_TEST_KEY', '--out', out, '--server-version', 'scripted-1'],
    ];
    await promisify(execFile)(process.execPath, args, {
      env: { ...process.env, WIRE_TEST_KEY: SECRET },
    });
    const files = await writtenFixtures();
    expect(files.size).toBe(3);
    for (const { text, fixture } of files.values()) {
      expectClean(text);
      expect(fixture.meta.serverVersion).toBe('scripted-1');
    }
  });

  it.each([
    ['a key on the command line', ['--api-key', SECRET]],
    ['an unset key variable', ['--api-key-env', 'WIRE_TEST_UNSET_VARIABLE']],
    ['an unknown scenario', ['--scenarios', 'no-such-scenario']],
    ['a scenario for another family', ['--scenarios', 'side-door-props']],
    ['an unknown family', ['--family', 'acme']],
  ])('refuses %s', async (_name, extra) => {
    const base = ['--base-url', `${server.origin}/v1`, '--model', 'm', '--family', 'other'];
    const code = await runCli([...base, '--out', out, ...extra], {});
    expect(code).toBe(2);
    expect(server.seen).toEqual([]);
  });
});
