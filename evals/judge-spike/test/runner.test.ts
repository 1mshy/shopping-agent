import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretsIn } from '../../wire/leak-check.ts';
import { runCli } from '../lib/runner.ts';
import {
  anthropicMessage,
  completion,
  type Script,
  scriptedFetch,
  verdicts,
} from './scripted-judge.ts';

const KEY_VAR = 'JUDGE_SPIKE_UNIT_TOKEN';
// Made up. Its characters share no 8-character run with any path or label the tests write (the
// leak check would rightly refuse a run whose directory name contained one).
const KEY = 'Qx7vR2mZ9kW4pL8sT3nB';
const env = { [KEY_VAR]: KEY };

let out: string;
let printed: string[];
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), 'judge-spike-unit-'));
  printed = [];
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

const DEFAULTS: Record<string, string | true> = {
  '--base-url': 'http://127.0.0.1:9/v1',
  '--model': 'scripted/judge',
  '--label': 'unit',
  '--api-key-env': KEY_VAR,
  '--batch-sizes': '15',
  '--trials': '1',
  '--seed': '1',
  '--max-calls': '1000',
  '--max-input-tokens': '10000000',
  '--deadline-ms': '600000',
  '--max-spend-nanos': '1000000000',
  '--currency': 'USD',
  '--price-input-nanos-per-mtok': '150000000',
  '--price-output-nanos-per-mtok': '600000000',
  '--owner-approved': true,
  '--synthetic': true,
};

function argv(over: Record<string, string | true | null> = {}): string[] {
  const all: Record<string, string | true | null> = { ...DEFAULTS, '--out': out, ...over };
  return Object.entries(all).flatMap(([k, v]) => (v === null ? [] : v === true ? [k] : [k, v]));
}

const valid: Script = (ids) => ({ body: completion(verdicts(ids)) });

async function run(over: Record<string, string | true | null>, script: Script, now?: () => number) {
  const s = scriptedFetch(script);
  const code = await runCli(argv(over), env, {
    fetch: s.fetch,
    print: (l) => printed.push(l),
    ...(now ? { now } : {}),
  });
  return { code, calls: s.calls };
}

async function runDir(): Promise<string> {
  const dirs = await readdir(out);
  expect(dirs).toHaveLength(1);
  return join(out, dirs[0] as string);
}

async function jsonl(name: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(await runDir(), name), 'utf8');
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function summary(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(await runDir(), 'summary.json'), 'utf8'));
}

describe('refusals before any call', () => {
  it('refuses to run without --owner-approved', async () => {
    const r = await run({ '--owner-approved': null }, valid);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(printed.join('\n')).toMatch(/--owner-approved/);
  });

  it('refuses without prices unless --accept-unknown-cost, saying why', async () => {
    const noPrices = {
      '--price-input-nanos-per-mtok': null,
      '--price-output-nanos-per-mtok': null,
    };
    const r = await run(noPrices, valid);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(printed.join('\n')).toMatch(/spend cap cannot be guaranteed/);
  });

  it('requires each of the four budgets', async () => {
    for (const flag of [
      '--max-calls',
      '--max-input-tokens',
      '--deadline-ms',
      '--max-spend-nanos',
    ]) {
      printed = [];
      const r = await run({ [flag]: null }, valid);
      expect(r.code, flag).toBe(2);
      expect(r.calls).toHaveLength(0);
      expect(printed.join('\n')).toContain(flag);
    }
  });

  it('takes the name of the key variable, never a value, and echoes no argument', async () => {
    const looksLikeAKey = 'sk-or-v1-0123456789abcdef0123';
    let r = await run({ '--api-key-env': looksLikeAKey }, valid);
    expect(r.code).toBe(2);
    r = await run({ '--api-key-env': 'UNSET_JUDGE_SPIKE_VAR' }, valid);
    expect(r.code).toBe(2);
    const s = scriptedFetch(valid);
    const code = await runCli([...argv(), '--api-key', looksLikeAKey], env, {
      fetch: s.fetch,
      print: (l) => printed.push(l),
    });
    expect(code).toBe(2);
    r = await run({ '--base-url': `http://user:${looksLikeAKey}@127.0.0.1:9/v1` }, valid);
    expect(r.code).toBe(2);
    expect(printed.join('\n')).not.toContain(looksLikeAKey);
    expect(printed.join('\n')).not.toContain('0123456789abcdef');
    expect(s.calls).toHaveLength(0);
  });

  it('keeps a local model to batches of 10 (S§5.4)', async () => {
    const r = await run({ '--local': true }, valid);
    expect(r.code).toBe(2);
    expect(printed.join('\n')).toMatch(/10/);
  });
});

describe('budgets stop the run before the call that would exceed them', () => {
  it('max calls', async () => {
    const r = await run({ '--max-calls': '3' }, valid);
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(3);
    expect((await summary()).stoppedBy).toBe('calls');
  });

  it('max input tokens', async () => {
    const r = await run({ '--max-input-tokens': '100' }, valid);
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(0);
    expect((await summary()).stoppedBy).toBe('input_tokens');
  });

  it('the wall-clock deadline', async () => {
    let t = 0;
    const r = await run(
      { '--deadline-ms': '2500' },
      (ids) => {
        t += 1000;
        return { body: completion(verdicts(ids)) };
      },
      () => t,
    );
    // Calls start at 0, 1,000 and 2,000 ms; at 3,000 the deadline has passed.
    expect(r.calls).toHaveLength(3);
    expect(r.code).toBe(3);
    expect((await summary()).stoppedBy).toBe('deadline');
  });

  it('max spend, reserved from the prices', async () => {
    const r = await run({ '--max-spend-nanos': '1' }, valid);
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(0);
    expect((await summary()).stoppedBy).toBe('spend');
  });

  it('proceeds on the other caps with --accept-unknown-cost, and records the cost as unknown', async () => {
    const r = await run(
      {
        '--price-input-nanos-per-mtok': null,
        '--price-output-nanos-per-mtok': null,
        '--accept-unknown-cost': true,
        '--max-calls': '2',
      },
      valid,
    );
    expect(r.calls).toHaveLength(2);
    expect(printed.join('\n')).toMatch(/spend cap cannot be guaranteed/);
    for (const c of await jsonl('calls.jsonl')) expect(c.cost).toEqual({ source: 'none' });
  });
});

describe('structured output and the one repair retry', () => {
  it('repairs an invalid reply once, in the same conversation', async () => {
    const r = await run({ '--max-calls': '2' }, (ids, n) => ({
      body: completion(n === 1 ? 'not json at all' : verdicts(ids)),
    }));
    expect(r.calls).toHaveLength(2);
    const second = r.calls[1]?.body.messages ?? [];
    expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(second[2]?.content).toBe('not json at all');
    const calls = await jsonl('calls.jsonl');
    expect(calls.map((c) => [c.attempt, c.valid, c.invalidReason])).toEqual([
      [0, false, 'not_json'],
      [1, true, null],
    ]);
    const items = await jsonl('items.jsonl');
    const first = items.filter((i) => i.batchId === calls[0]?.batchId);
    expect(first.every((i) => i.batchValid === true)).toBe(true);
  });

  it('counts the repair against the budgets', async () => {
    const r = await run({ '--max-calls': '1' }, () => ({ body: completion('nope') }));
    expect(r.calls).toHaveLength(1);
    const items = await jsonl('items.jsonl');
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.relation).toBe('unknown');
      expect(i.batchValid).toBe(false);
    }
    expect((await summary()).stoppedBy).toBe('calls');
  });

  it('scores a batch that stays invalid as unknown for every item, and goes on', async () => {
    const r = await run({ '--max-calls': '4' }, (ids, n) => ({
      body: completion(n <= 2 ? JSON.stringify({ verdicts: [] }) : verdicts(ids)),
    }));
    expect(r.calls).toHaveLength(4);
    const items = await jsonl('items.jsonl');
    const calls = await jsonl('calls.jsonl');
    const bad = items.filter((i) => i.batchId === calls[0]?.batchId);
    expect(bad.every((i) => i.relation === 'unknown' && i.batchValid === false)).toBe(true);
    expect(bad[0]?.invalidReason).toBe('schema');
    const good = items.filter((i) => i.batchId === calls[2]?.batchId);
    expect(good.every((i) => i.batchValid === true)).toBe(true);
  });

  it('does not retry an HTTP error, and stops after three failures in a row', async () => {
    const r = await run({}, () => ({ status: 500, body: { error: { message: 'down' } } }));
    expect(r.calls).toHaveLength(3);
    expect(r.code).toBe(3);
    expect((await summary()).stoppedBy).toBe('consecutive_failures');
  });
});

describe('records', () => {
  it('record each call without credentials, with usage, cost source and prompt version', async () => {
    const r = await run({ '--max-calls': '1' }, valid);
    expect(r.calls[0]?.authorization).toBe(`Bearer ${KEY}`);
    const [call] = await jsonl('calls.jsonl');
    expect(call?.promptVersion).toBe('judge.v1');
    expect(call?.usage).toMatchObject({ 'gen_ai.usage.input_tokens': 800 });
    // 800 x 150,000,000 / 1e6 + 120 x 600,000,000 / 1e6 = 120,000 + 72,000.
    expect(call?.cost).toEqual({ source: 'settings', amountNanos: 192_000, currency: 'USD' });
    expect(JSON.stringify(call)).toContain('[REDACTED]');
    const items = await jsonl('items.jsonl');
    for (const i of items) {
      expect(i.promptVersion).toBe('judge.v1');
      expect(i.position).toBeGreaterThan(0);
      expect(Array.isArray(i.batchItemKeys)).toBe(true);
    }
  });

  it('fails closed when the key would be written: nothing is kept and nothing printed', async () => {
    const r = await run({}, () => ({ body: completion(`echo ${KEY}`) }));
    expect(r.code).toBe(1);
    expect(printed.some((l) => secretsIn(l, [KEY]))).toBe(false);
    const left = await readdir(out, { recursive: true });
    for (const f of left) {
      const text = await readFile(join(out, f), 'utf8').catch(() => '');
      expect(secretsIn(text, [KEY])).toBe(false);
    }
  });
});

describe('the native Anthropic Messages path (--api anthropic)', () => {
  const ANTHROPIC = {
    '--api': 'anthropic',
    '--model': 'claude-haiku-5-5',
    '--reasoning-effort': 'low',
    // $0.10 / $0.50 per million input / output tokens.
    '--price-input-nanos-per-mtok': '100000000',
    '--price-output-nanos-per-mtok': '500000000',
  } as const;
  const validMessage: Script = (ids) => ({ body: anthropicMessage(verdicts(ids)) });

  it('refuses what the Messages API or Haiku 5.5 does not take, before any call', async () => {
    const refused: Record<string, string | true | null>[] = [
      { '--temperature': '0' },
      { '--structured': 'json_object' },
      { '--max-tokens-field': 'max_tokens' },
      { '--provider-cost-currency': 'USD' },
      { '--reasoning-effort': 'minimal' },
      { '--api-key-env': null },
      { '--local': true, '--batch-sizes': '5' },
      { '--api': 'openai' },
    ];
    for (const over of refused) {
      printed = [];
      const r = await run({ ...ANTHROPIC, ...over }, validMessage);
      expect(r.code, JSON.stringify(over)).toBe(2);
      expect(r.calls).toHaveLength(0);
    }
  });

  it('judges through the SDK with structured output, the effort given and no sampling', async () => {
    const r = await run({ ...ANTHROPIC, '--max-calls': '2' }, validMessage);
    expect(r.calls).toHaveLength(2);
    const seen = r.calls[0];
    expect(new URL(seen?.url ?? '').pathname).toBe('/v1/messages');
    expect(seen?.authorization).toBe(`Bearer ${KEY}`);
    expect(seen?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(typeof seen?.body.system).toBe('string');
    expect(seen?.body.messages.map((m) => m.role)).toEqual(['user']);
    expect(seen?.body).not.toHaveProperty('temperature');
    const items = await jsonl('items.jsonl');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.batchValid === true)).toBe(true);
    const meta = JSON.parse(await readFile(join(await runDir(), 'run.json'), 'utf8'));
    expect(meta.api).toBe('anthropic');
  });

  it('records usage normalised, cost from the prices, and no credential', async () => {
    await run({ ...ANTHROPIC, '--max-calls': '1' }, validMessage);
    const [call] = await jsonl('calls.jsonl');
    expect(call?.usage).toEqual({
      'gen_ai.usage.input_tokens': 800,
      'gen_ai.usage.cache_read.input_tokens': 100,
      'gen_ai.usage.cache_write.input_tokens': 0,
      'gen_ai.usage.output_tokens': 120,
      'gen_ai.usage.reasoning.output_tokens': 40,
    });
    // 800 x 100,000,000 / 1e6 + 120 x 500,000,000 / 1e6 = 80,000 + 60,000.
    expect(call?.cost).toEqual({ source: 'settings', amountNanos: 140_000, currency: 'USD' });
    expect(call?.request).toMatchObject({
      path: '/v1/messages',
      headers: { authorization: '[REDACTED]' },
    });
    expect(secretsIn(JSON.stringify(call), [KEY])).toBe(false);
  });

  it('repairs a refused reply once, with no trailing assistant turn', async () => {
    const r = await run({ ...ANTHROPIC, '--max-calls': '2' }, (ids, n) => ({
      body:
        n === 1
          ? anthropicMessage(null, {
              stopReason: 'refusal',
              stopDetails: { type: 'refusal', category: null, explanation: null },
            })
          : anthropicMessage(verdicts(ids)),
    }));
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]?.body.messages.map((m) => m.role)).toEqual(['user', 'user']);
    const calls = await jsonl('calls.jsonl');
    expect(calls.map((c) => [c.attempt, c.valid, c.invalidReason, c.invalidDetail])).toEqual([
      [0, false, 'refusal', 'refusal:none'],
      [1, true, null, null],
    ]);
  });

  it('sends the reply back as an assistant turn on a truncation repair', async () => {
    const r = await run({ ...ANTHROPIC, '--max-calls': '2' }, (ids, n) => ({
      body:
        n === 1
          ? anthropicMessage('{"verdicts":[', { stopReason: 'max_tokens' })
          : anthropicMessage(verdicts(ids)),
    }));
    expect(r.calls[1]?.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(r.calls[1]?.body.messages[1]?.content).toBe('{"verdicts":[');
  });

  it('keeps every budget: the spend reserve stops it before the call', async () => {
    const r = await run({ ...ANTHROPIC, '--max-spend-nanos': '1' }, validMessage);
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(0);
    expect((await summary()).stoppedBy).toBe('spend');
  });

  it('does not retry an HTTP error, and stops after three in a row', async () => {
    const r = await run(ANTHROPIC, () => ({
      status: 500,
      body: { type: 'error', error: { type: 'api_error', message: 'down' } },
    }));
    expect(r.calls).toHaveLength(3);
    expect(r.code).toBe(3);
    expect((await summary()).stoppedBy).toBe('consecutive_failures');
    const [call] = await jsonl('calls.jsonl');
    expect(call?.invalidReason).toBe('http_status');
    expect(call?.cost).toEqual({ source: 'none' });
  });

  it('fails closed when a reply echoes the key', async () => {
    const r = await run(ANTHROPIC, () => ({ body: anthropicMessage(`echo ${KEY}`) }));
    expect(r.code).toBe(1);
    expect(printed.some((l) => secretsIn(l, [KEY]))).toBe(false);
  });
});
