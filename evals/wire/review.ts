// The mechanical half of the README's "Before committing a recording" checklist, run over a
// directory of recorded fixtures. It prints counts and names only, never a value from a file:
//
//   node evals/wire/review.ts <dir> [--key-env NAME]
//
// With --key-env, the key is read from that environment variable (never from argv) and searched
// for with the leak check's forms (any 8-character run, base64, masked echoes). Per file it
// reports: parse and `synthetic`; key hits; unmasked Anthropic request and message ids; UUIDs,
// e-mail addresses, IPv4 addresses and host names; the local user and host names; mask runs; how
// the body ends; the kept response header names; and the token usage the body reports. Then the
// totals and the cost at Claude Haiku 5.5 list prices. Exit 1 when any check that must be zero
// is not. The human half (reading every chunk and header) is still the reader's.
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  bodyBytes,
  parseFixture,
  serializeFixture,
  type WireFixture,
  wireApiOf,
} from './format.ts';
import { secretsIn } from './leak-check.ts';

/** USD per million tokens, Claude Haiku 5.5, prompts up to 100,000 tokens
 * (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-24). */
export const HAIKU_5_5_PRICES = { input: 0.1, cacheWrite5m: 0.125, cacheRead: 0.01, output: 0.5 };

export interface Usage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  thinking: number;
}

const ZERO: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const obj = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};

function fromMessagesUsage(u: Record<string, unknown>): Usage {
  return {
    input: num(u.input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    output: num(u.output_tokens),
    thinking: num(obj(u.output_tokens_details).thinking_tokens),
  };
}

function fromChatUsage(u: Record<string, unknown>): Usage {
  return {
    ...ZERO,
    input: num(u.prompt_tokens),
    cacheRead: num(obj(u.prompt_tokens_details).cached_tokens),
    output: num(u.completion_tokens),
    thinking: num(obj(u.completion_tokens_details).reasoning_tokens),
  };
}

/** The usage a recorded body reports, or null when it reports none (errors, lists, counts). */
export function usageOf(f: WireFixture): Usage | null {
  if (f.response.status !== 200 || f.request.path.endsWith('/count_tokens')) return null;
  const body = Buffer.from(bodyBytes(f)).toString('utf8');
  const messages = wireApiOf(f.meta.serverFamily) === 'messages';
  const datas = body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .filter((d) => d !== '[DONE]');
  if (datas.length === 0) {
    const u = obj(obj(JSON.parse(body)).usage);
    if (Object.keys(u).length === 0) return null;
    return messages ? fromMessagesUsage(u) : fromChatUsage(u);
  }
  const events = datas.map((d) => obj(JSON.parse(d)));
  if (messages) {
    // message_start carries the input side; message_delta usage is cumulative (streaming docs).
    const start = obj(obj(events.find((e) => e.type === 'message_start')?.message).usage);
    const delta = obj(events.findLast((e) => e.type === 'message_delta')?.usage);
    if (Object.keys(start).length === 0 && Object.keys(delta).length === 0) return null;
    return fromMessagesUsage({ ...start, ...delta });
  }
  const last = events.findLast((e) => e.usage !== undefined && e.usage !== null);
  return last ? fromChatUsage(obj(last.usage)) : null;
}

export function costOf(u: Usage): number {
  const p = HAIKU_5_5_PRICES;
  return (
    (u.input * p.input + u.cacheWrite * p.cacheWrite5m + u.cacheRead * p.cacheRead) / 1e6 +
    (u.output * p.output) / 1e6
  );
}

/** How the body ends, as a label (no content). */
export function endingOf(f: WireFixture): string {
  const body = Buffer.from(bodyBytes(f)).toString('utf8');
  if (!(f.response.headers['content-type'] ?? '').startsWith('text/event-stream')) {
    try {
      JSON.parse(body);
      return 'json';
    } catch {
      return 'NOT-JSON';
    }
  }
  if (wireApiOf(f.meta.serverFamily) === 'messages') {
    const events = [...body.matchAll(/^event: (\S+)$/gm)].map((m) => m[1]);
    return `sse:last=${events.at(-1) ?? 'none'}:events=${events.length}`;
  }
  return body.trimEnd().endsWith('data: [DONE]') ? 'sse:[DONE]' : 'sse:NO-DONE';
}

const count = (text: string, re: RegExp) => [...text.matchAll(re)].length;

function localTerms(): string[] {
  const terms = [userInfo().username, hostname().split('.')[0] ?? ''];
  for (const key of ['user.name', 'user.email']) {
    try {
      terms.push(...execFileSync('git', ['config', key], { encoding: 'utf8' }).trim().split(/\s+/));
    } catch {
      // not configured
    }
  }
  return [...new Set(terms.filter((t) => t.length >= 4).map((t) => t.toLowerCase()))];
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { 'key-env': { type: 'string' } },
  });
  const dir = positionals[0];
  if (!dir) {
    console.error('usage: node evals/wire/review.ts <dir> [--key-env NAME]');
    return 2;
  }
  const keyName = values['key-env'];
  const key = keyName ? process.env[keyName] : undefined;
  if (keyName && !key) {
    console.error('the variable named by --key-env is unset or empty');
    return 2;
  }
  const terms = localTerms();
  const names = (await readdir(dir, { recursive: true })).filter((n) => n.endsWith('.json')).sort();
  let bad = 0;
  const total: Usage = { ...ZERO };
  let requests = 0;
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8');
    let f: WireFixture;
    try {
      f = parseFixture(JSON.parse(text));
    } catch {
      console.info(`${name}: DOES NOT PARSE`);
      bad += 1;
      continue;
    }
    requests += 1;
    const body = Buffer.from(bodyBytes(f)).toString('utf8');
    const all = `${serializeFixture(f)}\n${body}`;
    const lower = all.toLowerCase();
    const must = {
      synthetic: f.meta.synthetic ? 1 : 0,
      keyHits: key && secretsIn(all, [key]) ? 1 : 0,
      skAnt: count(all, /sk-ant/gi),
      reqIds: count(all, /\breq_[A-Za-z0-9]{8,}/g),
      msgIds: count(all, /\bmsg_[A-Za-z0-9]{8,}/g),
      uuids: count(all, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi),
      emails: count(all, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
      ipv4: count(all, /\b(?:\d{1,3}\.){3}\d{1,3}\b/g),
      workspaceOrOrg: count(all, /\b(?:wrkspc|org|user|proj)[-_][A-Za-z0-9]{12,}/g),
      fileBatchContainerIds: count(
        all,
        /\b(?:file|batch|msgbatch|container|cntr)_[A-Za-z0-9]{8,}/g,
      ),
      nonNullContainer: count(all, /"container"[ \t\r\n]*:[ \t\r\n]*(?!null\b)[^ \t\r\n]/g),
      // A thinking signature or redacted-thinking blob longer than its 8 kept characters.
      unmaskedBlobs: count(all, /"(?:signature|data)"[ \t\r\n]*:[ \t\r\n]*"[^"*]{8}[^"*]/g),
      localTerms: terms.reduce((n, t) => n + lower.split(t).length - 1, 0),
    };
    const info = {
      status: f.response.status,
      hosts: count(all, /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|dev|cloud)\b/gi),
      maskRuns: count(body, /\*{4,}/g),
      ending: endingOf(f),
      keptHeaders: Object.keys(f.response.headers).sort().join(','),
      omitted: f.response.omittedHeaders.length,
    };
    const u = usageOf(f);
    if (u) for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += u[k];
    const flags = Object.entries(must).filter(([, v]) => v > 0);
    bad += flags.length;
    console.info(
      `${name}: ${JSON.stringify({ ...info, usage: u })}${flags.length ? ` CHECK ${JSON.stringify(Object.fromEntries(flags))}` : ''}`,
    );
  }
  console.info(
    `files=${names.length} parsed=${requests} usage=${JSON.stringify(total)} cost_usd=${costOf(total).toFixed(6)} flagged=${bad}`,
  );
  return bad === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
