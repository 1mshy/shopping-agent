// Batch composition, deterministic from a seed, and the plan estimate the README quotes.
//
// A batch has the product's shape (S§5.4, S§5.6): one asked product and up to N of its listings.
// So items are grouped by their asked side, each group is shuffled and cut into batches of the
// nominal size; the last batch of a group is shorter, and a group smaller than the nominal size
// gives one short batch. Every item appears once per batch size per trial. Within a trial the
// batch order is shuffled too. Trials come first, so a run cut short by a budget has covered
// every batch size of its first trial.
import type { MatchAsked } from '../../corpus/areas/match-title-rules/contract.ts';
import type { JudgeItem } from '../dataset.ts';
import {
  fixedPartTokens,
  type JudgePrompt,
  listingView,
  quoteJson,
  renderUser,
} from '../prompt/load.ts';
import { estimateInputTokens, JUDGE_JSON_SCHEMA } from './chat.ts';
import { estimateTokens } from './tokens.ts';

export interface PlanOptions {
  readonly batchSizes: readonly number[];
  readonly trials: number;
  readonly seed: number;
}

export const DEFAULT_PLAN: PlanOptions = { batchSizes: [1, 5, 10, 15], trials: 3, seed: 1 };
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export interface Batch {
  /** `t<trial>-s<size>-<index>`, unique in a plan. */
  readonly id: string;
  readonly trial: number;
  readonly nominalSize: number;
  readonly groupKey: string;
  /** Item keys in listing order: position p (1-based) is listing id `L<p>`. */
  readonly itemKeys: readonly string[];
}

export function listingId(position: number): string {
  return `L${position}`;
}

export function groupKeyOf(asked: MatchAsked): string {
  return JSON.stringify(asked);
}

/** mulberry32: a small, well-known 32-bit PRNG. Deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const mix = (seed: number, trial: number, size: number) =>
  (Math.imul(seed >>> 0, 0x9e3779b1) ^
    Math.imul(trial, 0x85ebca77) ^
    Math.imul(size, 0xc2b2ae3d)) >>>
  0;

export function composeBatches(items: readonly JudgeItem[], o: PlanOptions): Batch[] {
  const groups = new Map<string, JudgeItem[]>();
  for (const i of items) {
    const k = groupKeyOf(i.asked);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const batches: Batch[] = [];
  for (let trial = 1; trial <= o.trials; trial++) {
    for (const size of o.batchSizes) {
      const rand = mulberry32(mix(o.seed, trial, size));
      const cut: { groupKey: string; itemKeys: string[] }[] = [];
      for (const [groupKey, members] of groups) {
        const order = shuffle(members, rand);
        for (let i = 0; i < order.length; i += size) {
          cut.push({ groupKey, itemKeys: order.slice(i, i + size).map((m) => m.key) });
        }
      }
      shuffle(cut, rand).forEach((b, index) => {
        batches.push({ id: `t${trial}-s${size}-${index + 1}`, trial, nominalSize: size, ...b });
      });
    }
  }
  return batches;
}

export interface SizeEstimate {
  readonly size: number;
  readonly batchesPerTrial: number;
  readonly fullBatchesPerTrial: number;
  readonly meanListingsPerBatch: number;
  /** Over every trial. */
  readonly inputTokens: number;
}

export interface PlanEstimate {
  readonly plan: PlanOptions;
  readonly items: number;
  readonly bySize: readonly SizeEstimate[];
  /** Batches over all sizes and trials: one call each when no repair is needed. */
  readonly calls: number;
  /** The most calls the plan can make: every batch repaired once. */
  readonly callsWithRepairs: number;
  /** Estimated input tokens of the first attempt of every batch, json_schema rung, as the
   * runner's budget check estimates them. */
  readonly inputTokens: number;
  readonly fixedPartTokens: number;
  readonly schemaTokens: number;
  /** Mean estimated tokens of one listing line. */
  readonly perListingTokens: number;
  readonly maxOutputTokens: number;
  /** The output cap over first attempts: calls x max output tokens. */
  readonly outputTokenCap: number;
}

/** The plan's calls and input tokens, computed by rendering every planned batch. */
export function planEstimate(
  items: readonly JudgeItem[],
  o: PlanOptions,
  prompt: JudgePrompt,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
): PlanEstimate {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const batches = composeBatches(items, o);
  const inputOf = (b: Batch) => {
    const members = b.itemKeys.map((k) => byKey.get(k) as JudgeItem);
    const listings = members.map((m, i) => ({ id: listingId(i + 1), listing: m.listing }));
    const asked = (members[0] as JudgeItem).asked;
    const messages = [
      { role: 'system' as const, content: prompt.system },
      { role: 'user' as const, content: renderUser(prompt, asked, listings) },
    ];
    return estimateInputTokens(messages, 'json_schema');
  };
  const bySize = o.batchSizes.map((size) => {
    const mine = batches.filter((b) => b.nominalSize === size);
    const first = mine.filter((b) => b.trial === 1);
    return {
      size,
      batchesPerTrial: first.length,
      fullBatchesPerTrial: first.filter((b) => b.itemKeys.length === size).length,
      meanListingsPerBatch: first.length === 0 ? 0 : items.length / first.length,
      inputTokens: mine.reduce((n, b) => n + inputOf(b), 0),
    };
  });
  const lines = items.map((i) => estimateTokens(quoteJson(listingView('L10', i.listing))) + 1);
  const calls = batches.length;
  return {
    plan: o,
    items: items.length,
    bySize,
    calls,
    callsWithRepairs: calls * 2,
    inputTokens: bySize.reduce((n, s) => n + s.inputTokens, 0),
    fixedPartTokens: fixedPartTokens(prompt),
    schemaTokens: estimateTokens(JSON.stringify(JUDGE_JSON_SCHEMA)),
    perListingTokens: Math.round(lines.reduce((a, b) => a + b, 0) / Math.max(1, lines.length)),
    maxOutputTokens,
    outputTokenCap: calls * maxOutputTokens,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** The plan table the README shows (a test keeps the two equal). */
export function planMarkdown(e: PlanEstimate): string {
  const rows = e.bySize.map(
    (s) =>
      `| ${s.size} | ${s.batchesPerTrial} | ${s.fullBatchesPerTrial} | ${s.meanListingsPerBatch.toFixed(2)} | ${fmt(s.inputTokens)} |`,
  );
  return [
    `Plan: batch sizes ${e.plan.batchSizes.join(', ')}; ${e.plan.trials} trials; seed ${e.plan.seed}; ${e.items} items.`,
    '',
    `| Nominal batch size | Batches per trial | Of them full | Mean listings per batch | Estimated input tokens, ${e.plan.trials} trials |`,
    '|--:|--:|--:|--:|--:|',
    ...rows,
    '',
    `- Calls: **${fmt(e.calls)}** (batches per trial, summed over sizes, times ${e.plan.trials} trials); at most **${fmt(e.callsWithRepairs)}** if every batch needs its one repair retry.`,
    `- Estimated input tokens, first attempts only: **${fmt(e.inputTokens)}**. Each call carries the fixed part (${e.fixedPartTokens} estimated tokens) and, on the \`json_schema\` rung, the schema (${e.schemaTokens}) once; a listing line averages ${e.perListingTokens} estimated tokens. A repair retry resends the whole conversation, so it adds at least its batch's input again.`,
    `- Output is capped at ${fmt(e.maxOutputTokens)} tokens a call (\`--max-output-tokens\`), so first attempts can produce at most **${fmt(e.outputTokenCap)}** output tokens (reasoning included). The real figure is what the run records.`,
  ].join('\n');
}
