// The recorder: sends scenarios to one server with raw fetch and writes one redacted fixture
// per exchange. Run on demand by a person (`node evals/wire/record.ts --help`), never in CI.
// The API key is read from a named environment variable and never accepted as an argument, and
// no error message quotes an argument or a secret.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  ANTHROPIC_VERSION,
  type BodyChunk,
  encodeChunk,
  FORMAT_VERSION,
  MetaSchema,
  parseFixture,
  RECORDER_VERSION,
  SERVER_FAMILIES,
  type ServerFamily,
  serializeFixture,
  type WireFixture,
  wireApiOf,
} from './format.ts';
import { findSecretLeaks, secretsIn } from './leak-check.ts';
import { redactExchange, redactText, selectResponseHeaders } from './redact.ts';
import { appliesTo, type MaxTokensField, SCENARIOS, type Scenario } from './scenarios.ts';

export const INVALID_KEY = 'invalid-key-for-wire-recording';
export const MIN_SECRET_LENGTH = 16;
const USER_AGENT = `agentic-dasher-wire-recorder/${RECORDER_VERSION}`;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class SecretLeakError extends Error {
  override name = 'SecretLeakError';
}
/** Bad options. The message never quotes the offending value. */
export class RecorderInputError extends Error {
  override name = 'RecorderInputError';
}
/** A scenario that cannot be recorded (e.g. a redirect). The message is safe to print. */
class ScenarioError extends Error {
  override name = 'ScenarioError';
}

export interface SessionOptions {
  baseUrl: string;
  model: string;
  family: ServerFamily;
  scenarios: readonly Scenario[];
  apiKey: string | null;
  /** More values to redact everywhere (from --redact-env), e.g. an account id in the URL. */
  extraSecrets?: readonly string[];
  outDir: string;
  /** Directory name under <out>/<family>/; defaults to an encoding of the redacted model id. */
  label?: string;
  overwrite?: boolean;
  serverVersion: string | null;
  maxTokensField: MaxTokensField;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** Why a secret value is unusable, without quoting it; null when it is fine. */
export function secretProblem(value: string): string | null {
  if (!/^[\x21-\x7e]+$/.test(value)) {
    return 'contains whitespace, a control character or a non-ASCII character (a .env file with CRLF line endings adds a trailing \\r); fix the value';
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return `is shorter than ${MIN_SECRET_LENGTH} characters, too short to redact without damaging the recording. A server that needs no key is recorded without --api-key-env`;
  }
  return null;
}

const secretsOf = (o: SessionOptions) => [
  ...(o.apiKey ? [o.apiKey] : []),
  ...(o.extraSecrets ?? []),
];

/** A directory name for a model id: collision-free (`~` plus hex escapes every byte outside
 * `[A-Za-z0-9._-]`) and never empty, `.` or `..`. Pass the redacted model id. */
export function fixtureDirName(model: string): string {
  const name = [...Buffer.from(model, 'utf8')]
    .map((b) => {
      const c = String.fromCharCode(b);
      return /[A-Za-z0-9._-]/.test(c) ? c : `~${b.toString(16).padStart(2, '0')}`;
    })
    .join('');
  if (name === '' || name === '.' || name === '..') {
    throw new RecorderInputError('the model id gives an empty, "." or ".." directory; use --label');
  }
  return name;
}

function sessionDir(o: SessionOptions): string {
  return o.label ?? fixtureDirName(redactText(o.model, secretsOf(o)));
}

const relativeFile = (o: SessionOptions, s: Scenario) =>
  join(o.family, sessionDir(o), `${s.id}.json`);

/** Checks everything that can be checked before the first request. Never quotes a value. */
export function validateSession(o: SessionOptions): string | null {
  if (o.apiKey !== null) {
    const p = secretProblem(o.apiKey);
    if (p) return `the API key ${p}.`;
  }
  for (const s of o.extraSecrets ?? []) {
    const p = secretProblem(s);
    if (p) return `a value named by --redact-env ${p}.`;
  }
  if (!URL.canParse(o.baseUrl)) return '--base-url is not a URL (the value is not printed)';
  const url = new URL(o.baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return '--base-url must be http or https';
  if (url.username || url.password) {
    return '--base-url must not carry user-info (user:password@); use --api-key-env';
  }
  if (url.search || url.hash) return '--base-url must not carry a query string or a fragment';
  if (!Number.isInteger(o.timeoutMs) || o.timeoutMs <= 0)
    return '--timeout-ms must be a positive integer';
  if (o.scenarios.length === 0) return 'no scenario to record';
  const ids = o.scenarios.map((s) => s.id);
  if (new Set(ids).size !== ids.length) return '--scenarios lists a scenario twice';
  for (const [i, s] of o.scenarios.entries()) {
    if (s.mustFollow !== undefined && ids[i - 1] !== s.mustFollow) {
      return `${s.id} must come immediately after ${s.mustFollow}`;
    }
    if (!appliesTo(s, o.family)) return `${s.id} does not apply to --family ${o.family}`;
  }
  if (o.label !== undefined && !LABEL.test(o.label)) {
    return "--label must be 1-100 letters, digits, '.', '_' or '-', not starting with '.'";
  }
  let dir: string;
  try {
    dir = sessionDir(o);
  } catch (err) {
    return err instanceof RecorderInputError ? err.message : 'the output directory name is invalid';
  }
  if (secretsIn(dir, secretsOf(o))) return 'the output directory name would contain a secret';
  for (const s of o.scenarios) {
    const meta = MetaSchema.safeParse({
      serverFamily: o.family,
      serverVersion: o.serverVersion === null ? null : redactText(o.serverVersion, secretsOf(o)),
      model: redactText(o.model, secretsOf(o)),
      scenario: s.id,
      basePath: url.pathname.replace(/\/+$/, '') || '/',
      recordedAt: new Date().toISOString(),
      recorderVersion: RECORDER_VERSION,
      synthetic: false,
    });
    if (!meta.success) {
      const fields = meta.error.issues.map((i) => String(i.path[0]));
      const flag: Record<string, string> = { serverVersion: '--server-version', model: '--model' };
      return `${[...new Set(fields)].map((f) => flag[f] ?? f).join(', ')} is not valid`;
    }
  }
  return null;
}

/** Fixture files this session would overwrite. */
export function existingTargets(o: SessionOptions): string[] {
  return o.scenarios
    .map((s) => relativeFile(o, s))
    .filter((rel) => existsSync(join(o.outDir, rel)));
}

const trimSlash = (p: string) => p.replace(/\/+$/, '');

/** The headers the recorder sets. Chat Completions families get the key as a bearer token; the
 * Messages API gets it as `x-api-key`, with the `anthropic-version` it requires. */
export function headersFor(
  family: ServerFamily,
  key: string | null,
  hasBody: boolean,
  stream: boolean,
): Record<string, string> {
  const messages = wireApiOf(family) === 'messages';
  const auth: Record<string, string> =
    key === null ? {} : messages ? { 'x-api-key': key } : { authorization: `Bearer ${key}` };
  return {
    accept: stream ? 'text/event-stream' : 'application/json',
    // Ask for an unencoded body so the recorded chunks are the bytes the server framed.
    'accept-encoding': 'identity',
    'user-agent': USER_AGENT,
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(messages ? { 'anthropic-version': ANTHROPIC_VERSION } : {}),
    ...auth,
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
    o.family,
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
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new ScenarioError(
      `HTTP ${res.status} redirect; not recorded (redirects are not followed)`,
    );
  }
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
  return parseFixture(redactExchange(raw, secretsOf(o)));
}

/** A printable account of an error: our own messages, or the error's name and system code
 * (e.g. ECONNREFUSED). Never the URL, never a value from the exchange. */
export function describeError(err: unknown, secrets: readonly string[]): string {
  if (err instanceof ScenarioError || err instanceof RecorderInputError) return err.message;
  if (err instanceof SecretLeakError) return err.message;
  if (err instanceof z.ZodError) {
    const paths = [...new Set(err.issues.map((i) => i.path.join('.')))];
    return `the exchange did not validate as a fixture (at ${paths.join(', ')})`;
  }
  const e = err as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  const code = e?.cause?.code ?? e?.code;
  const safeCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? ` (${code})` : '';
  const name = typeof e?.name === 'string' && /^[A-Za-z]+$/.test(e.name) ? e.name : 'Error';
  const what = e?.message === 'fetch failed' ? 'fetch failed' : name;
  return redactText(`${what}${safeCode}`, secrets);
}

/** Records every scenario into a staging directory next to `outDir`, and moves the files into
 * place only when every exchange passed the leak check. A failed request is reported and the
 * session goes on; a leak stops it, deletes the staging directory and writes nothing. */
export async function recordSession(
  o: SessionOptions,
): Promise<{ written: string[]; failed: string[] }> {
  const problem = validateSession(o);
  if (problem) throw new RecorderInputError(problem);
  if (!o.overwrite && existingTargets(o).length > 0) {
    throw new RecorderInputError(
      `${existingTargets(o).length} fixture file(s) already exist under --out; pass --overwrite to replace them`,
    );
  }
  const secrets = secretsOf(o);
  const out = resolve(o.outDir);
  await mkdir(dirname(out), { recursive: true });
  const stage = await mkdtemp(`${out}.staging-`);
  const staged: string[] = [];
  const failed: string[] = [];
  try {
    for (const scenario of o.scenarios) {
      let fixture: WireFixture;
      try {
        fixture = await recordExchange(scenario, o);
      } catch (err) {
        const message = describeError(err, secrets);
        failed.push(`${scenario.id}: ${message}`);
        console.error(`${scenario.id}: failed: ${message}`);
        continue;
      }
      const rel = relativeFile(o, scenario);
      const leaks = findSecretLeaks(fixture, secrets, { 'output path': rel });
      if (leaks.length > 0) {
        throw new SecretLeakError(
          `${scenario.id}: a secret is still present in the ${leaks.join(' and the ')} after redaction`,
        );
      }
      await mkdir(dirname(join(stage, rel)), { recursive: true });
      await writeFile(join(stage, rel), serializeFixture(fixture));
      staged.push(rel);
      console.info(`${scenario.id}: HTTP ${fixture.response.status}`);
    }
    for (const rel of staged) {
      await mkdir(dirname(join(out, rel)), { recursive: true });
      await rename(join(stage, rel), join(out, rel));
    }
  } catch (err) {
    if (err instanceof SecretLeakError) {
      console.error(
        `${err.message}. Refusing to write: deleted the staging directory; nothing from this session was written.`,
      );
    }
    throw err;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  const written = staged.map((rel) => join(out, rel));
  if (staged.length > 0) {
    console.info(
      `wrote ${staged.length} fixture(s) to ${join(o.family, sessionDir(o))} under --out`,
    );
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
      headers: headersFor(o.family, o.apiKey, false, false),
      redirect: 'manual',
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    const value = res.ok ? ((await res.json()) as Record<string, unknown>)[target[1]] : undefined;
    return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export const USAGE = `usage: node evals/wire/record.ts --base-url URL --model ID --family FAMILY --out DIR
         [--scenarios all|ID,ID,...] [--api-key-env ENV_VAR_NAME] [--redact-env ENV_VAR_NAME]...
         [--label NAME] [--overwrite] [--server-version VERSION]
         [--max-tokens-field max_completion_tokens|max_tokens] [--timeout-ms 120000]
       node evals/wire/record.ts --list [--family FAMILY]
families: ${SERVER_FAMILIES.join(', ')}
--family anthropic records the native Messages API (key as x-api-key, anthropic-version
${ANTHROPIC_VERSION}, the messages-* scenarios); every other family records Chat Completions
(key as a bearer token). --max-tokens-field applies to Chat Completions only.
The API key is read from the environment variable named by --api-key-env, never from argv.
Secrets must be at least ${MIN_SECRET_LENGTH} printable ASCII characters with no whitespace.
Exit codes: 0 all recorded, 1 a request failed or a leak was refused, 2 bad arguments.`;

function fail(message: string): number {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}

const PARSE_ERRORS: Readonly<Record<string, string>> = {
  ERR_PARSE_ARGS_UNKNOWN_OPTION:
    'an unknown option was given (not printed, in case it is a secret)',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL:
    'an unexpected positional argument was given (not printed, in case it is a secret)',
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE:
    'an option is missing its value or was given one it does not take',
};

/** Reads a secret from the environment variable an option names. */
function secretFromEnv(
  option: string,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): { value: string } | { error: string } {
  if (!ENV_NAME.test(name)) {
    return {
      error: `${option} takes the name of an environment variable (letters, digits, '_'), not a value; what was given is not printed`,
    };
  }
  const value = env[name];
  if (!value) return { error: `the environment variable named by ${option} is unset or empty` };
  const problem = secretProblem(value);
  return problem ? { error: `the value named by ${option} ${problem}.` } : { value };
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
  let values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'base-url': { type: 'string' },
        model: { type: 'string' },
        family: { type: 'string' },
        out: { type: 'string' },
        label: { type: 'string' },
        overwrite: { type: 'boolean' },
        scenarios: { type: 'string', default: 'all' },
        'api-key-env': { type: 'string' },
        'redact-env': { type: 'string', multiple: true },
        'server-version': { type: 'string' },
        'max-tokens-field': { type: 'string', default: 'max_completion_tokens' },
        'timeout-ms': { type: 'string', default: '120000' },
        list: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    }));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return fail(PARSE_ERRORS[String(code)] ?? 'the arguments could not be parsed');
  }
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  if (values.help) {
    console.info(USAGE);
    return 0;
  }
  const family = str('family') as ServerFamily | undefined;
  if (family !== undefined && !SERVER_FAMILIES.includes(family)) {
    return fail(`--family must be one of: ${SERVER_FAMILIES.join(', ')}`);
  }
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
  const maxTokensField = str('max-tokens-field');
  if (maxTokensField !== 'max_completion_tokens' && maxTokensField !== 'max_tokens') {
    return fail('--max-tokens-field must be max_completion_tokens or max_tokens');
  }
  const timeoutText = str('timeout-ms') ?? '';
  if (!/^[1-9][0-9]{0,8}$/.test(timeoutText))
    return fail('--timeout-ms must be a positive integer');

  let scenarios: Scenario[];
  const wanted = str('scenarios') ?? 'all';
  if (wanted === 'all') {
    scenarios = SCENARIOS.filter((s) => appliesTo(s, family));
  } else {
    scenarios = [];
    for (const [i, id] of wanted.split(',').entries()) {
      const s = SCENARIOS.find((x) => x.id === id.trim());
      if (!s) return fail(`--scenarios: entry ${i + 1} is not a scenario id (see --list)`);
      if (!appliesTo(s, family)) {
        return fail(`--scenarios: entry ${i + 1} does not apply to --family ${family}`);
      }
      scenarios.push(s);
    }
  }

  let apiKey: string | null = null;
  const keyVar = str('api-key-env');
  if (keyVar !== undefined) {
    const got = secretFromEnv('--api-key-env', keyVar, env);
    if ('error' in got) return fail(got.error);
    apiKey = got.value;
  }
  const extraSecrets: string[] = [];
  for (const name of (values['redact-env'] as string[] | undefined) ?? []) {
    const got = secretFromEnv('--redact-env', name, env);
    if ('error' in got) return fail(got.error);
    extraSecrets.push(got.value);
  }

  const options: SessionOptions = {
    baseUrl,
    model,
    family,
    scenarios,
    apiKey,
    extraSecrets,
    outDir,
    ...(str('label') === undefined ? {} : { label: str('label') }),
    overwrite: values.overwrite === true,
    serverVersion: str('server-version') ?? null,
    maxTokensField,
    timeoutMs: Number(timeoutText),
  };
  const problem = validateSession(options);
  if (problem) return fail(problem);
  const existing = existingTargets(options);
  if (!options.overwrite && existing.length > 0) {
    return fail(
      `${existing.length} fixture file(s) already exist under --out; pass --overwrite to replace them`,
    );
  }
  options.serverVersion ??= await detectServerVersion(options);
  const secrets = secretsOf(options);
  try {
    const { written, failed } = await recordSession(options);
    console.info(`${written.length} fixture(s) written; ${failed.length} scenario(s) failed`);
    return failed.length === 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof RecorderInputError) return fail(err.message);
    if (!(err instanceof SecretLeakError)) console.error(describeError(err, secrets));
    return 1;
  }
}
