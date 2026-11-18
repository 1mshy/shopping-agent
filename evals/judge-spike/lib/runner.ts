// The spike D runner: judges every planned batch with one endpoint, under four budgets enforced
// in code before every call (S§2.6), and writes the result files (lib/records.ts). Started by a
// person, never by CI: `node evals/judge-spike/run.ts --help`.
//
// The key is read from an environment variable whose name is given; it is never an argument. No
// error message quotes an argument value. Every line written to a file or printed is checked for
// the key first (evals/wire/leak-check.ts); on a hit the run directory is deleted and the run
// fails closed.
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MinorUnitCurrency } from '@agentic-dasher/shared';
import { secretsIn } from '../../wire/leak-check.ts';
import { secretProblem } from '../../wire/recorder.ts';
import { compositionMarkdown, DATASET, datasetFingerprint, type JudgeItem } from '../dataset.ts';
import { loadPrompt, type RepairProblem, renderRepair, renderUser } from '../prompt/load.ts';
import {
  type Batch,
  composeBatches,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_PLAN,
  listingId,
  planEstimate,
  planMarkdown,
} from './batches.ts';
import { type BudgetHit, BudgetLedger, type Budgets, type Prices } from './budget.ts';
import {
  buildRequestBody,
  type ChatMessage,
  costOf,
  estimateInputTokens,
  FAILURE_REASONS,
  type InvalidReason,
  normaliseUsage,
  parseVerdicts,
  postChat,
  providerCostText,
  type RequestOptions,
  RUNGS,
  type Rung,
  replyParts,
} from './chat.ts';
import {
  type CallRecord,
  FORMAT_VERSION,
  type ItemRecord,
  type RunMeta,
  type RunSummary,
  type StopReason,
} from './records.ts';

export const DEFAULT_OUT = fileURLToPath(new URL('../../out/judge-spike', import.meta.url));
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_HOSTED_BATCH = 15;
const MAX_LOCAL_BATCH = 10;
const MAX_CONSECUTIVE_FAILURES = 3;

export const USAGE = `usage: node evals/judge-spike/run.ts [options]

Spike D: the rule-guided batched judge (S§5.4) on the matcher corpus. Makes model calls only
with --owner-approved, and only within the four budgets, which are required.

  --plan                     print the dataset composition and the plan estimate; no call
  --base-url URL             OpenAI-compatible base URL (…/v1); no user-info, no query
  --model ID                 model id as the endpoint names it
  --label NAME               endpoint label for the results (letters, digits, . _ -)
  --api-key-env NAME         name of the environment variable holding the key (never the key);
                             leave out for a server that needs none
  --local                    a local model: batches of at most 10, veto-only reading in the report
  --batch-sizes LIST         default 1,5,10,15 (local: 1,5,10)
  --trials N                 default 3
  --seed N                   batch composition seed, default 1
  --structured RUNG          json_schema (default) | json_object | text
  --temperature T            sent only when given (0-2)
  --reasoning-effort E       sent as reasoning_effort only when given: ${REASONING_EFFORTS.join(' | ')}
  --max-tokens-field F       max_completion_tokens (default) | max_tokens
  --max-output-tokens N      default 2048
  --timeout-ms N             per call, default 120000 (and never past the deadline)
  --price-input-nanos-per-mtok N   settings price, nano-units of --currency per million tokens
  --price-output-nanos-per-mtok N  (both or neither)
  --provider-cost-currency C the currency of the provider's usage.cost, if it reports one;
                             only then is that figure used (it must equal --currency)
  --max-calls N              budget: calls, repair retries included        (required)
  --max-input-tokens N       budget: input tokens over the run             (required)
  --deadline-ms N            budget: wall clock from the start             (required)
  --max-spend-nanos N        budget: spend in nano-units of --currency     (required)
  --currency C               ISO 4217 code of prices and the spend cap     (required)
  --accept-unknown-cost      run without prices: the spend cap then cannot be guaranteed
  --owner-approved           required to make any call
  --synthetic                mark the results synthetic (scripted servers, tests)
  --out DIR                  default evals/out/judge-spike
`;

export interface RunOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly label: string;
  readonly key: string | null;
  readonly local: boolean;
  readonly batchSizes: readonly number[];
  readonly trials: number;
  readonly seed: number;
  readonly rung: Rung;
  readonly temperature: number | null;
  readonly reasoningEffort: string | null;
  readonly maxTokensField: 'max_completion_tokens' | 'max_tokens';
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly prices: Prices | null;
  readonly providerCostCurrency: string | null;
  readonly currency: MinorUnitCurrency;
  readonly budgets: Budgets;
  readonly acceptUnknownCost: boolean;
  readonly synthetic: boolean;
  readonly out: string;
}

type Parsed =
  | { readonly mode: 'help' }
  | { readonly mode: 'plan'; readonly plan: { batchSizes: number[]; trials: number; seed: number } }
  | { readonly mode: 'run'; readonly options: RunOptions };

class InputError extends Error {
  override name = 'InputError';
}

const PARSE_ERRORS: Readonly<Record<string, string>> = {
  ERR_PARSE_ARGS_UNKNOWN_OPTION:
    'an unknown option was given (not printed, in case it is a secret)',
  ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL:
    'an unexpected positional argument was given (not printed, in case it is a secret)',
  ERR_PARSE_ARGS_INVALID_OPTION_VALUE:
    'an option is missing its value or was given one it does not take',
};

const STRING_OPTIONS = [
  'base-url',
  'model',
  'label',
  'api-key-env',
  'batch-sizes',
  'trials',
  'seed',
  'structured',
  'temperature',
  'reasoning-effort',
  'max-tokens-field',
  'max-output-tokens',
  'timeout-ms',
  'price-input-nanos-per-mtok',
  'price-output-nanos-per-mtok',
  'provider-cost-currency',
  'max-calls',
  'max-input-tokens',
  'deadline-ms',
  'max-spend-nanos',
  'currency',
  'out',
] as const;
const BOOLEAN_OPTIONS = [
  'plan',
  'help',
  'local',
  'accept-unknown-cost',
  'owner-approved',
  'synthetic',
] as const;

function integer(text: string | undefined, flag: string, min: number, max: number): number {
  if (text === undefined || !/^[0-9]{1,16}$/.test(text)) {
    throw new InputError(`${flag} must be a whole number (the value is not printed)`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new InputError(`${flag} must be between ${min} and ${max}`);
  }
  return n;
}

function required(v: string | undefined, flag: string): string {
  if (v === undefined) throw new InputError(`${flag} is required`);
  return v;
}

function batchSizes(text: string | undefined, local: boolean): number[] {
  const cap = local ? MAX_LOCAL_BATCH : MAX_HOSTED_BATCH;
  if (text === undefined) return local ? [1, 5, 10] : [...DEFAULT_PLAN.batchSizes];
  if (!/^[0-9]{1,2}(,[0-9]{1,2}){0,14}$/.test(text)) {
    throw new InputError('--batch-sizes must be a comma-separated list of whole numbers');
  }
  const sizes = text.split(',').map(Number);
  if (sizes.some((s) => s < 1 || s > cap)) {
    throw new InputError(
      local
        ? `--batch-sizes: a local model takes at most ${MAX_LOCAL_BATCH} listings a call (S§5.4)`
        : `--batch-sizes: at most ${MAX_HOSTED_BATCH} listings a call (S§5.4)`,
    );
  }
  if (new Set(sizes).size !== sizes.length) throw new InputError('--batch-sizes repeats a size');
  return sizes;
}

function baseUrl(text: string): string {
  if (!URL.canParse(text))
    throw new InputError('--base-url is not a URL (the value is not printed)');
  const url = new URL(text);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InputError('--base-url must be http or https');
  }
  if (url.username || url.password) {
    throw new InputError('--base-url must not carry user-info; put the key in --api-key-env');
  }
  if (url.search || url.hash) throw new InputError('--base-url must not carry a query or fragment');
  return text.replace(/\/+$/, '');
}

/** Parses and validates everything before any call. Messages never quote a value. */
export function parseCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Parsed {
  if (argv.some((a) => /^--api-key(=|$)/.test(a))) {
    throw new InputError(
      '--api-key is not accepted: put the key in an environment variable and pass its name with --api-key-env',
    );
  }
  let values: Record<string, string | boolean | undefined>;
  try {
    const options: Record<string, { type: 'string' | 'boolean' }> = {};
    for (const o of STRING_OPTIONS) options[o] = { type: 'string' };
    for (const o of BOOLEAN_OPTIONS) options[o] = { type: 'boolean' };
    ({ values } = parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }));
  } catch (err) {
    const code = String((err as { code?: unknown }).code);
    throw new InputError(PARSE_ERRORS[code] ?? 'the arguments could not be parsed');
  }
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const flag = (k: string) => values[k] === true;
  if (flag('help')) return { mode: 'help' };

  const local = flag('local');
  const sizes = batchSizes(str('batch-sizes'), local);
  const trials = str('trials') === undefined ? 3 : integer(str('trials'), '--trials', 1, 20);
  const seed = str('seed') === undefined ? 1 : integer(str('seed'), '--seed', 0, 4294967295);
  if (flag('plan')) return { mode: 'plan', plan: { batchSizes: sizes, trials, seed } };

  const url = baseUrl(required(str('base-url'), '--base-url'));
  const model = required(str('model'), '--model');
  if (!/^[\x21-\x7e]{1,200}$/.test(model)) {
    throw new InputError('--model must be 1-200 printable characters without spaces');
  }
  const label = required(str('label'), '--label');
  if (!LABEL.test(label)) {
    throw new InputError(
      "--label must be 1-64 letters, digits, '.', '_' or '-', not starting with one of '._-'",
    );
  }
  let key: string | null = null;
  const keyEnv = str('api-key-env');
  if (keyEnv !== undefined) {
    if (!ENV_NAME.test(keyEnv)) {
      throw new InputError(
        '--api-key-env takes the name of an environment variable (letters, digits, _), not a value; what was given is not printed',
      );
    }
    const value = env[keyEnv];
    if (!value)
      throw new InputError('the environment variable named by --api-key-env is unset or empty');
    const problem = secretProblem(value);
    if (problem) throw new InputError(`the value named by --api-key-env ${problem}.`);
    key = value;
  }
  const rung = (str('structured') ?? 'json_schema') as Rung;
  if (!RUNGS.includes(rung))
    throw new InputError(`--structured must be one of: ${RUNGS.join(', ')}`);
  let temperature: number | null = null;
  const t = str('temperature');
  if (t !== undefined) {
    if (!/^(?:[01](?:\.[0-9]{1,3})?|2(?:\.0{1,3})?)$/.test(t)) {
      throw new InputError('--temperature must be a decimal from 0 to 2');
    }
    temperature = Number(t);
  }
  const effort = str('reasoning-effort') ?? null;
  if (effort !== null && !(REASONING_EFFORTS as readonly string[]).includes(effort)) {
    throw new InputError(`--reasoning-effort must be one of: ${REASONING_EFFORTS.join(', ')}`);
  }
  const field = str('max-tokens-field') ?? 'max_completion_tokens';
  if (field !== 'max_completion_tokens' && field !== 'max_tokens') {
    throw new InputError('--max-tokens-field must be max_completion_tokens or max_tokens');
  }
  const maxOutputTokens =
    str('max-output-tokens') === undefined
      ? DEFAULT_MAX_OUTPUT_TOKENS
      : integer(str('max-output-tokens'), '--max-output-tokens', 64, 65536);
  const timeoutMs =
    str('timeout-ms') === undefined
      ? 120_000
      : integer(str('timeout-ms'), '--timeout-ms', 1, 3_600_000);

  const currencyParsed = MinorUnitCurrency.safeParse(required(str('currency'), '--currency'));
  if (!currencyParsed.success) {
    throw new InputError('--currency must be an ISO 4217 code with minor units');
  }
  const currency = currencyParsed.data;
  const providerCostCurrency = str('provider-cost-currency') ?? null;
  if (providerCostCurrency !== null && providerCostCurrency !== currency) {
    throw new InputError('--provider-cost-currency must equal --currency (no conversion is done)');
  }
  const pin = str('price-input-nanos-per-mtok');
  const pout = str('price-output-nanos-per-mtok');
  if ((pin === undefined) !== (pout === undefined)) {
    throw new InputError(
      'give both --price-input-nanos-per-mtok and --price-output-nanos-per-mtok, or neither',
    );
  }
  const prices =
    pin === undefined
      ? null
      : {
          inputNanosPerMTok: integer(pin, '--price-input-nanos-per-mtok', 0, 1e15),
          outputNanosPerMTok: integer(pout, '--price-output-nanos-per-mtok', 0, 1e15),
        };
  const max = Number.MAX_SAFE_INTEGER;
  const budgets: Budgets = {
    maxCalls: integer(required(str('max-calls'), '--max-calls'), '--max-calls', 1, 1_000_000),
    maxInputTokens: integer(
      required(str('max-input-tokens'), '--max-input-tokens'),
      '--max-input-tokens',
      1,
      max,
    ),
    deadlineMs: integer(required(str('deadline-ms'), '--deadline-ms'), '--deadline-ms', 1, max),
    maxSpendNanos: integer(
      required(str('max-spend-nanos'), '--max-spend-nanos'),
      '--max-spend-nanos',
      1,
      max,
    ),
  };
  if (prices === null && !flag('accept-unknown-cost')) {
    throw new InputError(
      `${UNKNOWN_COST} Give settings prices, or pass --accept-unknown-cost to run on the call, input-token and time caps alone.`,
    );
  }
  if (!flag('owner-approved')) {
    throw new InputError('this makes paid model calls: it runs only with --owner-approved');
  }
  return {
    mode: 'run',
    options: {
      baseUrl: url,
      model,
      label,
      key,
      local,
      batchSizes: sizes,
      trials,
      seed,
      rung,
      temperature,
      reasoningEffort: effort,
      maxTokensField: field,
      maxOutputTokens,
      timeoutMs,
      prices,
      providerCostCurrency,
      currency,
      budgets,
      acceptUnknownCost: flag('accept-unknown-cost'),
      synthetic: flag('synthetic'),
      out: str('out') ?? DEFAULT_OUT,
    },
  };
}

const UNKNOWN_COST =
  'The spend cap cannot be guaranteed: no settings prices were given, so a call’s cost is known ' +
  'only after it returns, and only when the provider reports it in --currency ' +
  '(--provider-cost-currency).';

export interface RunDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Every line the runner prints, each leak-checked first. Default: stderr. */
  readonly print?: (line: string) => void;
  readonly dataset?: readonly JudgeItem[];
}

class LeakError extends Error {
  override name = 'LeakError';
}

const LEAK_MESSAGE =
  'refused: the key would have appeared in a result file or in the output. The run directory ' +
  'was deleted and nothing from this run was kept.';

interface Attempt {
  readonly stop: BudgetHit | null;
  readonly valid: boolean;
  readonly reason: InvalidReason | null;
  readonly verdicts: CallRecord['verdicts'];
  readonly content: string | null;
}

/** Runs the plan. Returns the exit code: 0 completed, 3 stopped early, 1 refused on a leak. */
export async function runSpike(o: RunOptions, deps: RunDeps = {}): Promise<number> {
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const rawPrint = deps.print ?? ((l: string) => console.error(l));
  const secrets = o.key === null ? [] : [o.key];
  const say = (line: string) => {
    if (secretsIn(line, secrets)) throw new LeakError();
    rawPrint(line);
  };
  const dataset = deps.dataset ?? DATASET;
  const byKey = new Map(dataset.map((i) => [i.key, i]));
  const prompt = loadPrompt();
  const batches = composeBatches(dataset, o);
  const startMs = now();
  const startedAt = new Date(startMs).toISOString();
  const runId = `${o.label}-${startedAt.replace(/[:.]/g, '-')}`;
  const dir = join(o.out, runId);
  const endpoint = `${o.baseUrl}/chat/completions`;
  const endpointPath = new URL(endpoint).pathname;

  const checked = (text: string) => {
    if (secretsIn(text, secrets)) throw new LeakError();
    return text;
  };
  const writeJson = (name: string, value: unknown) =>
    writeFile(join(dir, name), checked(`${JSON.stringify(value, null, 2)}\n`), { flag: 'wx' });
  const appendLine = (name: string, value: unknown) =>
    appendFile(join(dir, name), checked(`${JSON.stringify(value)}\n`));

  try {
    checked(dir);
    await mkdir(o.out, { recursive: true });
    await mkdir(dir);
  } catch (err) {
    if (err instanceof LeakError) {
      rawPrint(LEAK_MESSAGE);
      return 1;
    }
    rawPrint(`refused: the run directory could not be created (${(err as Error).name})`);
    return 1;
  }

  const ledger = new BudgetLedger(o.budgets, o.prices, now);
  const reqOpts: RequestOptions = {
    model: o.model,
    rung: o.rung,
    maxTokensField: o.maxTokensField,
    maxOutputTokens: o.maxOutputTokens,
    temperature: o.temperature,
    reasoningEffort: o.reasoningEffort,
  };
  let callIndex = 0;
  let consecutiveFailures = 0;
  let batchesJudged = 0;
  let judgements = 0;
  let stoppedBy: StopReason | null = null;

  async function attempt(
    batch: Batch,
    messages: ChatMessage[],
    n: 0 | 1,
    ids: string[],
  ): Promise<Attempt> {
    const estimatedInputTokens = estimateInputTokens(messages, o.rung);
    const admission = ledger.admit({ estimatedInputTokens, maxOutputTokens: o.maxOutputTokens });
    if (!admission.ok) {
      return { stop: admission.hit, valid: false, reason: null, verdicts: null, content: null };
    }
    const body = buildRequestBody(reqOpts, messages);
    const t0 = now();
    const startedAtCall = new Date(t0).toISOString();
    const posted = await postChat(
      fetchFn,
      endpoint,
      o.key,
      body,
      Math.min(o.timeoutMs, ledger.remainingMs()),
    );
    const latencyMs = now() - t0;
    let reason: InvalidReason | null = null;
    let detail: string | null = null;
    let verdicts: CallRecord['verdicts'] = null;
    let content: string | null = null;
    let usageRaw: unknown;
    let costText: string | null = null;
    if (!posted.ok) reason = posted.error;
    else {
      costText = providerCostText(posted.reply.text, posted.reply.headers);
      const parts = replyParts(posted.reply.text);
      usageRaw = parts?.usage;
      if (posted.reply.status < 200 || posted.reply.status > 299) reason = 'http_status';
      else if (parts === null) reason = 'bad_response';
      else {
        content = parts.content;
        const r = parseVerdicts(parts, o.rung, ids);
        if (r.ok) verdicts = r.verdicts;
        else {
          reason = r.reason;
          detail = r.detail;
        }
      }
    }
    const usage = normaliseUsage(usageRaw);
    const cost = costOf({
      providerText: costText,
      providerCurrency: o.providerCostCurrency,
      currency: o.currency,
      usage,
      prices: o.prices,
    });
    ledger.settle({
      inputTokens: usage['gen_ai.usage.input_tokens'],
      estimatedInputTokens,
      costNanos: cost.source === 'none' ? null : cost.amountNanos,
      reserveNanos: admission.reserveNanos,
    });
    const record: CallRecord = {
      kind: 'call',
      runId,
      callIndex: callIndex++,
      batchId: batch.id,
      trial: batch.trial,
      nominalSize: batch.nominalSize,
      batchLength: batch.itemKeys.length,
      attempt: n,
      startedAt: startedAtCall,
      latencyMs,
      estimatedInputTokens,
      reserveNanos: admission.reserveNanos,
      request: {
        method: 'POST',
        path: endpointPath,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(o.key === null ? {} : { authorization: 'Bearer [REDACTED]' }),
        },
        body,
      },
      response: posted.ok ? posted.reply : null,
      transportError: posted.ok ? null : posted.errorName,
      valid: reason === null,
      invalidReason: reason,
      invalidDetail: detail,
      verdicts,
      usage,
      cost,
      providerCostText: costText,
      promptVersion: prompt.version,
      model: o.model,
      endpointLabel: o.label,
    };
    await appendLine('calls.jsonl', record);
    if (reason !== null && FAILURE_REASONS.includes(reason)) consecutiveFailures++;
    else consecutiveFailures = 0;
    return { stop: null, valid: reason === null, reason, verdicts, content };
  }

  try {
    say(
      `judge-spike: ${batches.length} batches planned, ${dataset.length} items, prompt ${prompt.version}${o.synthetic ? ' (SYNTHETIC run)' : ''}`,
    );
    if (o.prices === null) {
      say(
        `${UNKNOWN_COST} Proceeding on the call, input-token and time caps (--accept-unknown-cost); the run can stop on spend only once known spend has reached the cap.`,
      );
    }
    const meta: RunMeta = {
      formatVersion: FORMAT_VERSION,
      runId,
      synthetic: o.synthetic,
      label: o.label,
      model: o.model,
      baseUrl: o.baseUrl,
      local: o.local,
      rung: o.rung,
      temperature: o.temperature,
      reasoningEffort: o.reasoningEffort,
      maxTokensField: o.maxTokensField,
      maxOutputTokens: o.maxOutputTokens,
      batchSizes: o.batchSizes,
      trials: o.trials,
      seed: o.seed,
      prices: o.prices,
      currency: o.currency,
      providerCostCurrency: o.providerCostCurrency,
      acceptUnknownCost: o.acceptUnknownCost,
      budgets: o.budgets,
      promptVersion: prompt.version,
      promptSha256: prompt.sha256,
      datasetFingerprint: datasetFingerprint(dataset),
      plannedBatches: batches.length,
      plannedJudgements: batches.reduce((n, b) => n + b.itemKeys.length, 0),
      startedAt,
    };
    await writeJson('run.json', meta);

    for (const batch of batches) {
      const members = batch.itemKeys.map((k) => byKey.get(k) as JudgeItem);
      const ids = members.map((_, i) => listingId(i + 1));
      const asked = (members[0] as JudgeItem).asked;
      const messages: ChatMessage[] = [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: renderUser(
            prompt,
            asked,
            members.map((m, i) => ({ id: ids[i] as string, listing: m.listing })),
          ),
        },
      ];
      const first = await attempt(batch, messages, 0, ids);
      if (first.stop !== null) {
        stoppedBy = first.stop;
        break;
      }
      let final = first;
      let attempts = 1;
      if (!first.valid && first.reason !== null && !FAILURE_REASONS.includes(first.reason)) {
        const repair: ChatMessage[] = [
          ...messages,
          ...(first.content ? [{ role: 'assistant' as const, content: first.content }] : []),
          {
            role: 'user',
            content: renderRepair(prompt, first.reason as RepairProblem, ids.length),
          },
        ];
        const second = await attempt(batch, repair, 1, ids);
        if (second.stop !== null) stoppedBy = second.stop;
        else {
          final = second;
          attempts = 2;
        }
      }
      const byId = new Map(
        (final.valid ? (final.verdicts ?? []) : []).map((v) => [v.id, v.relation]),
      );
      for (const [i, key] of batch.itemKeys.entries()) {
        const id = ids[i] as string;
        const record: ItemRecord = {
          kind: 'item',
          runId,
          trial: batch.trial,
          nominalSize: batch.nominalSize,
          batchId: batch.id,
          batchLength: batch.itemKeys.length,
          position: i + 1,
          batchItemKeys: batch.itemKeys,
          itemKey: key,
          listingId: id,
          relation: final.valid ? (byId.get(id) ?? 'unknown') : 'unknown',
          batchValid: final.valid,
          invalidReason: final.valid ? null : final.reason,
          attempts,
          promptVersion: prompt.version,
        };
        await appendLine('items.jsonl', record);
      }
      batchesJudged++;
      judgements += batch.itemKeys.length;
      if (batchesJudged % 25 === 0) say(`judge-spike: ${batchesJudged}/${batches.length} batches`);
      if (stoppedBy !== null) break;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        stoppedBy = 'consecutive_failures';
        break;
      }
    }

    const state = ledger.state();
    const summary: RunSummary = {
      runId,
      endedAt: new Date(now()).toISOString(),
      completed: stoppedBy === null && batchesJudged === batches.length,
      stoppedBy,
      callsMade: state.calls,
      batchesJudged,
      judgements,
      inputTokensCharged: state.inputTokens,
      spendNanosCharged: state.spendNanos,
      unknownCostCalls: state.unknownCostCalls,
      costGuarantee: o.prices === null ? 'not_guaranteed' : 'reserved_from_prices',
      elapsedMs: state.elapsedMs,
    };
    await writeJson('summary.json', summary);
    say(
      `judge-spike: ${batchesJudged}/${batches.length} batches judged with ${state.calls} calls` +
        (stoppedBy === null ? '; completed.' : `; stopped by ${stoppedBy}.`) +
        ` Results: ${dir}`,
    );
    return stoppedBy === null ? 0 : 3;
  } catch (err) {
    if (err instanceof LeakError) {
      await rm(dir, { recursive: true, force: true });
      rawPrint(LEAK_MESSAGE);
      return 1;
    }
    rawPrint(
      `error: the run failed (${(err as Error).name}); its partial results are in the run directory`,
    );
    return 1;
  }
}

export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  deps: RunDeps = {},
): Promise<number> {
  const print = deps.print ?? ((l: string) => console.error(l));
  let parsed: Parsed;
  try {
    parsed = parseCli(argv, env);
  } catch (err) {
    if (err instanceof InputError) {
      print(`refused: ${err.message}`);
      print('see: node evals/judge-spike/run.ts --help');
      return 2;
    }
    throw err;
  }
  if (parsed.mode === 'help') {
    (deps.print ?? ((l: string) => console.info(l)))(USAGE);
    return 0;
  }
  if (parsed.mode === 'plan') {
    const out = deps.print ?? ((l: string) => console.info(l));
    const dataset = deps.dataset ?? DATASET;
    out(compositionMarkdown(dataset));
    out('');
    out(planMarkdown(planEstimate(dataset, parsed.plan, loadPrompt())));
    return 0;
  }
  return runSpike(parsed.options, deps);
}
