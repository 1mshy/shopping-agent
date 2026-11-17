import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeChunk, parseFixture, type WireFixture } from '../format.ts';
import {
  detectServerVersion,
  fixtureDirName,
  recordExchange,
  recordSession,
  runCli,
  SecretLeakError,
  type SessionOptions,
} from '../recorder.ts';
import { createReplayFetch, startReplayServer } from '../replay.ts';
import { scenarioById } from '../scenarios.ts';
import { type ScriptedResponse, type SeenRequest, startScriptedServer } from './scripted-server.ts';
import { SPLIT_CHUNKS } from './synthetic.ts';

// Made-up values only. Never point these tests at a real key variable.
const SECRET = 'wire-test-secret-7f3a9c2e5b1d';
const ACCOUNT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const RECORD_TS = fileURLToPath(new URL('../record.ts', import.meta.url));

// The scripted server echoes the bearer token it received and the request path, sets a cookie
// and an organisation header, and answers a wrong key with 401, so redaction has work to do.
function route(req: SeenRequest): ScriptedResponse {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  const noise = { 'set-cookie': 'sid=s3ss10n', 'openai-organization': 'org-abcdefghijklmnop1234' };
  if (req.url === '/version') {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      chunks: ['{"version":"scripted-0.1"}'],
    };
  }
  if (token !== SECRET) {
    return {
      status: 401,
      headers: { 'content-type': 'application/json', ...noise },
      chunks: [`{"error":{"message":"Incorrect API key provided: ${token}"}}`],
    };
  }
  if (req.url.endsWith('/models')) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json', ...noise },
      chunks: [`{"object":"list","data":[{"id":"m","owned_by":"${token}","path":"${req.url}"}]}`],
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
let printed: string[];
beforeEach(async () => {
  server = await startScriptedServer(route);
  out = await mkdtemp(join(tmpdir(), 'wire-rec-'));
  printed = [];
  for (const method of ['error', 'warn', 'info', 'log'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
  }
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  await rm(out, { recursive: true, force: true });
});

async function restart(r: (req: SeenRequest) => ScriptedResponse): Promise<void> {
  await server.close();
  server = await startScriptedServer(r);
}

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

async function filesUnder(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of await readdir(dir, { recursive: true }).catch(() => [])) {
    if (name.endsWith('.json')) files.set(name, await readFile(join(dir, name), 'utf8'));
  }
  return files;
}

async function writtenFixtures(
  dir = join(out, 'other', 'scripted-model'),
): Promise<Map<string, { text: string; fixture: WireFixture }>> {
  const files = new Map<string, { text: string; fixture: WireFixture }>();
  for (const [name, text] of await filesUnder(dir)) {
    files.set(name, { text, fixture: parseFixture(JSON.parse(text)) });
  }
  return files;
}

function expectClean(text: string): void {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('s3ss10n');
  expect(text).not.toContain('org-abcdefghijklmnop1234');
}

/** No staging directory may be left next to `out`. */
async function stagingLeftovers(): Promise<string[]> {
  return (await readdir(dirname(out))).filter((n) => n.startsWith(`${basename(out)}.`));
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
    expect(await stagingLeftovers()).toEqual([]);

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

    // Relies on one read per server write; see the note at the top of replay.test.ts.
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

  // Review item 7: a leak in any scenario means nothing from the session reaches --out.
  it('fails closed: writes nothing from the session when one exchange leaks', async () => {
    const escaped = [...SECRET].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    await restart((req) =>
      req.url.endsWith('/chat/completions')
        ? {
            status: 200,
            headers: { 'content-type': 'application/json' },
            chunks: [`{"echo":"${escaped.join('')}"}`],
          }
        : route(req),
    );
    await expect(
      recordSession(options({ scenarios: ['models-list', 'stream-usage'].map(scenarioById) })),
    ).rejects.toBeInstanceOf(SecretLeakError);
    expect(await filesUnder(out)).toEqual(new Map());
    expect(await stagingLeftovers()).toEqual([]);
    expect(printed.join('\n')).toMatch(/staging directory .*deleted|deleted .*staging/i);
  });

  // Review item 5.
  it.each([
    ['a local path', '/Users/alice/models/qwen3-8b.gguf', 'alice'],
    ['a fine-tuned id', 'ft:gpt-4o-mini:acme-corp::AbC123', 'acme'],
    ['the key', `m-${SECRET}`, SECRET],
  ])('redacts a model id with %s in meta and in the output path', async (_n, model, marker) => {
    const result = await recordSession(
      options({ model, scenarios: [scenarioById('models-list')] }),
    );
    expect(result.failed).toEqual([]);
    const files = await filesUnder(out);
    expect(files.size).toBe(1);
    for (const [path, text] of files) {
      expect(path).not.toContain(marker);
      expect(text).not.toContain(marker);
      expect(parseFixture(JSON.parse(text)).meta.model).toContain('[REDACTED]');
    }
  });

  it('names the directory after --label when given', async () => {
    await recordSession(options({ label: 'qwen3-8b', scenarios: [scenarioById('models-list')] }));
    expect([...(await filesUnder(out)).keys()]).toEqual([
      join('other', 'qwen3-8b', 'models-list.json'),
    ]);
  });

  // Review item 15.
  it('reports a redirect as a failed scenario and writes nothing for it', async () => {
    await restart(() => ({
      status: 302,
      headers: { location: 'https://login.test/?session=L0cati0nMarker' },
      chunks: ['moved'],
    }));
    const result = await recordSession(options({ scenarios: [scenarioById('models-list')] }));
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatch(/302/);
    expect(await filesUnder(out)).toEqual(new Map());
    expect(printed.join('\n')).not.toContain('L0cati0nMarker');
  });

  // Review item 6.
  it('redacts --redact-env values everywhere, including the base path', async () => {
    const result = await recordSession(
      options({
        baseUrl: `${server.origin}/v1/${ACCOUNT}/gw`,
        extraSecrets: [ACCOUNT],
        scenarios: [scenarioById('models-list')],
      }),
    );
    expect(result.failed).toEqual([]);
    const files = await writtenFixtures();
    const f = files.get('models-list.json');
    expect(f?.text).not.toContain(ACCOUNT);
    expect(f?.fixture.meta.basePath).toBe('/v1/[REDACTED]/gw');
    expect(f?.fixture.request.path).toBe('/v1/[REDACTED]/gw/models');
  });
});

describe('fixture directory names', () => {
  it('are collision-free and never . or ..', () => {
    const names = ['a/b', 'a_b', 'a:b', 'a~b', 'a b'].map(fixtureDirName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9._~-]+$/);
    for (const bad of ['', '.', '..']) expect(() => fixtureDirName(bad)).toThrow();
  });
});

// Review item E.
describe('detectServerVersion', () => {
  it('reads the documented version endpoint, and asks nothing of families without one', async () => {
    expect(await detectServerVersion(options({ family: 'vllm' }))).toBe('scripted-0.1');
    expect(await detectServerVersion(options({ family: 'openai' }))).toBeNull();
    expect(server.seen.map((r) => r.url)).toEqual(['/version']);
    expect(await detectServerVersion(options({ family: 'ollama' }))).toBeNull(); // 401 here
  });
});

describe('command line', () => {
  const base = () => [
    ...['--base-url', `${server.origin}/v1`, '--model', 'scripted-model', '--family', 'other'],
    ...['--out', out],
  ];
  const keyEnv = { WIRE_TEST_KEY: SECRET };

  it('runs end to end as `node evals/wire/record.ts`', async () => {
    const args = [
      RECORD_TS,
      ...base(),
      ...['--scenarios', 'models-list,stream-usage,error-bad-credentials'],
      ...['--api-key-env', 'WIRE_TEST_KEY', '--server-version', 'scripted-1'],
    ];
    const { stdout, stderr } = await promisify(execFile)(process.execPath, args, {
      env: { PATH: process.env.PATH, WIRE_TEST_KEY: SECRET },
    });
    expect(`${stdout}${stderr}`).not.toContain(SECRET);
    const files = await writtenFixtures();
    expect(files.size).toBe(3);
    for (const { text, fixture } of files.values()) {
      expectClean(text);
      expect(fixture.meta.serverVersion).toBe('scripted-1');
    }
  });

  it('prints --help and --list to stdout and exits 0', async () => {
    expect(await runCli(['--help'], {})).toBe(0);
    expect(printed.join('\n')).toMatch(/--api-key-env/);
    printed.length = 0;
    expect(await runCli(['--list'], {})).toBe(0);
    expect(printed.join('\n')).toMatch(/tool-choice-none/);
    printed.length = 0;
    expect(await runCli(['--list', '--family', 'ollama'], {})).toBe(0);
    expect(printed.join('\n')).toMatch(/side-door-show/);
    expect(printed.join('\n')).not.toMatch(/side-door-props/);
  });

  // Review items 1, 2, 4, 6, 8, 16: refused before any request, and no value is echoed.
  const LOOKS_LIKE_ENV_NAME = 'WIRE_TEST_SECRET_7F3A9C2E5B1D';
  it.each([
    ['the key as --api-key', ['--api-key', SECRET], keyEnv],
    ['the key as --api-key=', [`--api-key=${SECRET}`], keyEnv],
    ['the key as --api-key-env', ['--api-key-env', SECRET], keyEnv],
    ['an env-name-shaped key as --api-key-env', ['--api-key-env', LOOKS_LIKE_ENV_NAME], {}],
    ['the key as a stray positional', [SECRET], keyEnv],
    ['the key as an unknown option', [`--${SECRET}`], keyEnv],
    ['the key as --family', ['--family', SECRET], keyEnv],
    ['the key as --scenarios', ['--scenarios', SECRET], keyEnv],
    ['the key as --base-url', ['--base-url', SECRET], keyEnv],
    ['the key as --max-tokens-field', ['--max-tokens-field', SECRET], keyEnv],
    ['the key as --timeout-ms', ['--timeout-ms', SECRET], keyEnv],
    ['the key in --label', ['--label', `x/${SECRET}`], keyEnv],
    ['the key as --redact-env', ['--redact-env', SECRET], keyEnv],
    ['a key with a trailing CR', ['--api-key-env', 'K'], { K: `${SECRET}\r` }],
    ['a key with a space', ['--api-key-env', 'K'], { K: `${SECRET} x` }],
    ['a non-ASCII key', ['--api-key-env', 'K'], { K: `${SECRET}é` }],
    ['a short key', ['--api-key-env', 'K'], { K: 'tst-k3y-9' }],
    ['a short --redact-env value', ['--redact-env', 'K'], { K: 'tst-k3y-9' }],
    ['user-info in --base-url', ['--base-url', `http://u:${SECRET}@127.0.0.1:9/v1`], {}],
    ['a query in --base-url', ['--base-url', `http://127.0.0.1:9/v1?key=${SECRET}`], {}],
    ['an empty --server-version', ['--server-version', ''], {}],
    ['a duplicate scenario', ['--scenarios', 'models-list,models-list'], {}],
    ['cache-prefix-second alone', ['--scenarios', 'cache-prefix-second'], {}],
    [
      'cache-prefix-second not right after first',
      ['--scenarios', 'cache-prefix-first,models-list,cache-prefix-second'],
      {},
    ],
    ['an unknown scenario', ['--scenarios', 'no-such-scenario'], {}],
    ['a scenario for another family', ['--scenarios', 'side-door-props'], {}],
    ['an invalid --label', ['--label', '..'], {}],
  ])('refuses %s', async (_name, extra, env: Record<string, string>) => {
    const code = await runCli([...base(), ...extra], env);
    expect(code).toBe(2);
    expect(server.seen).toEqual([]);
    const output = printed.join('\n');
    expect(output).not.toContain(SECRET.slice(0, 10));
    expect(output).not.toContain(SECRET.slice(-10));
    expect(output).not.toContain('tst-k3y-9');
    expect(output).not.toContain(LOOKS_LIKE_ENV_NAME);
  });

  it('says a server without a key is recorded without --api-key-env', async () => {
    expect(await runCli([...base(), '--api-key-env', 'K'], { K: 'tst-k3y-9' })).toBe(2);
    expect(printed.join('\n')).toMatch(/without --api-key-env/);
  });

  // Review item 7.
  it('refuses to overwrite existing fixtures unless --overwrite is given', async () => {
    const args = [...base(), '--scenarios', 'models-list', '--api-key-env', 'WIRE_TEST_KEY'];
    expect(await runCli(args, keyEnv)).toBe(0);
    const before = server.seen.length;
    expect(await runCli(args, keyEnv)).toBe(2);
    expect(server.seen.length).toBe(before);
    expect(await runCli([...args, '--overwrite'], keyEnv)).toBe(0);
    expect(await stagingLeftovers()).toEqual([]);
  });

  // Review item 17.
  it('prints the error code of a failed connection, not the URL', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const code = await runCli(
      [
        '--base-url',
        `http://127.0.0.1:${port}/v1`,
        '--model',
        'm',
        '--family',
        'other',
        '--out',
        out,
      ],
      {},
    );
    expect(code).toBe(1);
    const output = printed.join('\n');
    expect(output).toMatch(/ECONNREFUSED/);
    expect(output).not.toContain(String(port));
  });
});
