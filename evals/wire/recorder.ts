// The recorder: sends scenarios to one server with raw fetch and writes one redacted fixture
// per exchange. Run on demand by a person (`node evals/wire/record.ts --help`), never in CI.
// The API key is read from a named environment variable and never accepted as an argument.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type BodyChunk,
  encodeChunk,
  FORMAT_VERSION,
  parseFixture,
  RECORDER_VERSION,
  SERVER_FAMILIES,
  type ServerFamily,
  serializeFixture,
  type WireFixture,
} from './format.ts';
import { findSecretLeaks, redactExchange, redactText, selectResponseHeaders } from './redact.ts';
import {
  appliesTo,
  type MaxTokensField,
  SCENARIOS,
  type Scenario,
  scenarioById,
} from './scenarios.ts';

export const INVALID_KEY = 'invalid-key-for-wire-recording';
const USER_AGENT = `agentic-dasher-wire-recorder/${RECORDER_VERSION}`;

export class SecretLeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretLeakError';
  }
}

export interface SessionOptions {
  baseUrl: string;
  model: string;
  family: ServerFamily;
  scenarios: readonly Scenario[];
  apiKey: string | null;
  outDir: string;
  serverVersion: string | null;
  maxTokensField: MaxTokensField;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

function headersFor(key: string | null, hasBody: boolean, stream: boolean): Record<string, string> {
  return {
    accept: stream ? 'text/event-stream' : 'application/json',
    // Ask for an unencoded body so the recorded chunks are the bytes the server framed.
    'accept-encoding': 'identity',
    'user-agent': USER_AGENT,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(key === null ? {} : { authorization: `Bearer ${key}` }),
  };
}

/** Sends one scenario and returns the redacted, validated fixture. Nothing is written. */
export async function recordExchange(scenario: Scenario, o: SessionOptions): Promise<WireFixture> {
  const base = new URL(o.baseUrl);
  const ctx = { model: o.model, maxTokensField: o.maxTokensField };
  const url = new URL(
    (scenario.root === 'base' ? trimSlash(base.pathname) : '') + scenario.path(ctx),
    base.origin,
  );
  const body = scenario.body(ctx);
  const stream =
    typeof body === 'object' && body !== null && 'stream' in body && body.stream === true;
  const headers = headersFor(
    scenario.auth === 'invalid' ? INVALID_KEY : o.apiKey,
    body !== null,
    stream,
  );
  const recordedAt = new Date().toISOString();
  const started = performance.now();
  const at = () => Math.round((performance.now() - started) * 10) / 10;
  const res = await (o.fetch ?? fetch)(url, {
    method: scenario.method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(o.timeoutMs),
  });
  const headersAtMs = at();
  const chunks: BodyChunk[] = [];
  const reader = res.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader?.read()) {
    if (r.value.byteLength > 0) chunks.push(encodeChunk(r.value, at()));
  }
  const selected = selectResponseHeaders(res.headers);
  const raw: WireFixture = {
    formatVersion: FORMAT_VERSION,
    meta: {
      serverFamily: o.family,
      serverVersion: o.serverVersion,
      model: o.model,
      scenario: scenario.id,
      basePath: trimSlash(base.pathname) || '/',
      recordedAt,
      recorderVersion: RECORDER_VERSION,
      synthetic: false,
    },
    request: { method: scenario.method, path: url.pathname + url.search, headers, body },
    response: {
      status: res.status,
      headersAtMs,
      headers: selected.headers,
      omittedHeaders: selected.omitted,
      chunks,
    },
  };
  return parseFixture(redactExchange(raw, o.apiKey ? [o.apiKey] : []));
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

/** Writes a fixture unless a secret is still in it (fail closed). Returns the file path. */
export async function writeFixture(
  f: WireFixture,
  outDir: string,
  secrets: readonly string[],
): Promise<string> {
  const leaks = findSecretLeaks(f, secrets);
  if (leaks.length > 0) {
    throw new SecretLeakError(
      `refusing to write ${f.meta.scenario}: the API key is still present in ${leaks.join(', ')}`,
    );
  }
  const dir = join(outDir, f.meta.serverFamily, slug(f.meta.model));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${f.meta.scenario}.json`);
  await writeFile(file, serializeFixture(f));
  return file;
}

/** Records every scenario in order. A failed request is reported and the session goes on; a
 * secret leak stops the session at once. */
export async function recordSession(
  o: SessionOptions,
): Promise<{ written: string[]; failed: string[] }> {
  const secrets = o.apiKey ? [o.apiKey] : [];
  const written: string[] = [];
  const failed: string[] = [];
  for (const scenario of o.scenarios) {
    let fixture: WireFixture;
    try {
      fixture = await recordExchange(scenario, o);
    } catch (err) {
      const message = redactText(err instanceof Error ? err.message : String(err), secrets);
      failed.push(`${scenario.id}: ${message}`);
      console.error(`${scenario.id}: failed: ${message}`);
      continue;
    }
    const file = await writeFixture(fixture, o.outDir, secrets);
    written.push(file);
    console.info(`${scenario.id}: HTTP ${fixture.response.status} -> ${file}`);
  }
  return { written, failed };
}

/** Best effort, from the version endpoints the servers document; null when unknown. */
export async function detectServerVersion(o: SessionOptions): Promise<string | null> {
  const probe: Partial<Record<ServerFamily, [string, string]>> = {
    ollama: ['/api/version', 'version'],
    vllm: ['/version', 'version'],
    llamacpp: ['/props', 'build_info'],
  };
  const target = probe[o.family];
  if (!target) return null;
  try {
    const res = await (o.fetch ?? fetch)(new URL(target[0], o.baseUrl), {
      headers: headersFor(o.apiKey, false, false),
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    const value = res.ok ? ((await res.json()) as Record<string, unknown>)[target[1]] : undefined;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export const USAGE = `usage: node evals/wire/record.ts --base-url URL --model ID --family FAMILY --out DIR
         [--scenarios all|ID,ID,...] [--api-key-env ENV_VAR_NAME] [--server-version VERSION]
         [--max-tokens-field max_completion_tokens|max_tokens] [--timeout-ms 120000]
       node evals/wire/record.ts --list [--family FAMILY]
families: ${SERVER_FAMILIES.join(', ')}
The API key is read from the environment variable named by --api-key-env, never from argv.`;

function fail(message: string): number {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}

export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (argv.some((a) => /^--api-key(=|$)/.test(a))) {
    return fail(
      '--api-key is not accepted: put the key in an environment variable and pass its name with --api-key-env.',
    );
  }
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'base-url': { type: 'string' },
        model: { type: 'string' },
        family: { type: 'string' },
        out: { type: 'string' },
        scenarios: { type: 'string', default: 'all' },
        'api-key-env': { type: 'string' },
        'server-version': { type: 'string' },
        'max-tokens-field': { type: 'string', default: 'max_completion_tokens' },
        'timeout-ms': { type: 'string', default: '120000' },
        list: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  if (values.help) {
    console.info(USAGE);
    return 0;
  }
  const family = str('family') as ServerFamily | undefined;
  if (family !== undefined && !SERVER_FAMILIES.includes(family))
    return fail(`unknown family "${family}"`);
  if (values.list) {
    for (const s of SCENARIOS) {
      if (family && !appliesTo(s, family)) continue;
      const fams = s.families === 'all' ? 'all' : s.families.join(',');
      console.info(
        `${s.id.padEnd(30)} step ${s.probeSteps.join(',') || '-'}  [${fams}]  ${s.serves}`,
      );
    }
    return 0;
  }
  const baseUrl = str('base-url');
  const model = str('model');
  const outDir = str('out');
  if (!baseUrl || !model || !family || !outDir) {
    return fail('--base-url, --model, --family and --out are required');
  }
  if (!URL.canParse(baseUrl)) return fail('--base-url is not a URL');

  let scenarios: Scenario[];
  const wanted = str('scenarios') ?? 'all';
  if (wanted === 'all') {
    scenarios = SCENARIOS.filter((s) => appliesTo(s, family));
  } else {
    scenarios = [];
    for (const id of wanted.split(',').map((x) => x.trim())) {
      const s = SCENARIOS.find((x) => x.id === id);
      if (!s) return fail(`unknown scenario "${id}" (see --list)`);
      if (!appliesTo(s, family)) return fail(`scenario "${id}" does not apply to ${family}`);
      scenarios.push(scenarioById(id));
    }
  }

  let apiKey: string | null = null;
  const keyVar = str('api-key-env');
  if (keyVar !== undefined) {
    apiKey = env[keyVar] ?? '';
    if (apiKey === '') return fail(`environment variable ${keyVar} is unset or empty`);
  }
  const maxTokensField = str('max-tokens-field');
  if (maxTokensField !== 'max_completion_tokens' && maxTokensField !== 'max_tokens') {
    return fail('--max-tokens-field must be max_completion_tokens or max_tokens');
  }
  const timeoutMs = Number(str('timeout-ms'));
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    return fail('--timeout-ms must be a positive integer');

  const options: SessionOptions = {
    baseUrl,
    model,
    family,
    scenarios,
    apiKey,
    outDir,
    serverVersion: str('server-version') ?? null,
    maxTokensField,
    timeoutMs,
  };
  options.serverVersion ??= await detectServerVersion(options);
  try {
    const { written, failed } = await recordSession(options);
    console.info(`wrote ${written.length} fixture(s); ${failed.length} scenario(s) failed`);
    return failed.length === 0 ? 0 : 1;
  } catch (err) {
    const secrets = apiKey ? [apiKey] : [];
    console.error(redactText(err instanceof Error ? err.message : String(err), secrets));
    return 1;
  }
}
