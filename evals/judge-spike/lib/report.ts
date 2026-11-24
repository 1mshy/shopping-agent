// The spike D report generator: from result files, the tables the plan asks for (P0 workstream 5
// D: precision per error class, batch-size degradation, tokens and cost per batch). Every figure
// carries its numerator, denominator and n; a ratio over zero is shown as undefined.
//
// It writes a draft section for docs/spikes/d-model-judge.md only when asked (--draft) and only
// from real runs: a synthetic run is refused.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLASS_BUCKETS,
  type ClassBucket,
  DATASET,
  datasetFingerprint,
  type JudgeItem,
} from '../dataset.ts';
import type { CallRecord, ItemRecord, RunMeta, RunSummary } from './records.ts';
import {
  formatRatio,
  goldIsExact,
  OUTCOMES,
  type Outcome,
  type Ratio,
  ratio,
  scoreRelation,
  type View,
} from './score.ts';

export interface LoadedRun {
  readonly dir: string;
  readonly meta: RunMeta;
  readonly summary: RunSummary | null;
  readonly calls: readonly CallRecord[];
  readonly items: readonly ItemRecord[];
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

export function loadRun(dir: string): LoadedRun {
  const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunMeta;
  if (meta.formatVersion !== 1) throw new Error('a result file has an unknown format version');
  const summaryPath = join(dir, 'summary.json');
  const summary = existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as RunSummary)
    : null;
  return {
    dir,
    meta,
    summary,
    calls: readJsonl<CallRecord>(join(dir, 'calls.jsonl')),
    items: readJsonl<ItemRecord>(join(dir, 'items.jsonl')),
  };
}

export interface ClassFigures {
  /** Judgements of items in this bucket. */
  readonly items: number;
  readonly falseAccepts: number;
  /** False accepts over the bucket's judgements: how often this kind of wrong product passed. */
  readonly rate: Ratio;
  /** False accepts of this bucket over all accepts: this bucket's share of the imprecision. */
  readonly shareOfAccepts: Ratio;
}

export interface ExactMetrics {
  readonly n: number;
  readonly outcomes: Readonly<Record<Outcome, number>>;
  /** Right accepts over all accepts. */
  readonly precision: Ratio;
  /** Right accepts over judgements of exact golds. */
  readonly recall: Ratio;
  /** `unknown` answers (invalid batches included) over judgements. */
  readonly abstention: Ratio;
  /** Wrong non-exact relations over judgements of non-exact golds. */
  readonly wrongRelation: Ratio;
  /** Rejections of exact golds over judgements of exact golds. */
  readonly falseReject: Ratio;
  readonly byClass: Readonly<Record<ClassBucket, ClassFigures>>;
}

function goldOf(byKey: ReadonlyMap<string, JudgeItem>, key: string): JudgeItem {
  const item = byKey.get(key);
  if (!item) throw new Error('a result names an item that is not in the dataset');
  return item;
}

export function bucketOf(item: JudgeItem): ClassBucket | null {
  if (item.errorClass !== null) return item.errorClass;
  return 'oneOf' in item.gold ? 'set' : null;
}

export function exactMetrics(
  items: readonly ItemRecord[],
  byKey: ReadonlyMap<string, JudgeItem>,
  view: View = 'plain',
): ExactMetrics {
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const perBucket = new Map<ClassBucket, { items: number; falseAccepts: number }>();
  let exactGolds = 0;
  for (const r of items) {
    const item = goldOf(byKey, r.itemKey);
    const outcome = scoreRelation(item.gold, r.relation, view);
    outcomes[outcome]++;
    if (goldIsExact(item.gold)) exactGolds++;
    const bucket = bucketOf(item);
    if (bucket !== null) {
      const b = perBucket.get(bucket) ?? { items: 0, falseAccepts: 0 };
      perBucket.set(bucket, {
        items: b.items + 1,
        falseAccepts: b.falseAccepts + (outcome === 'false_accept' ? 1 : 0),
      });
    }
  }
  const accepts = outcomes.true_accept + outcomes.false_accept;
  const byClass = Object.fromEntries(
    CLASS_BUCKETS.map((c) => {
      const b = perBucket.get(c) ?? { items: 0, falseAccepts: 0 };
      return [
        c,
        {
          items: b.items,
          falseAccepts: b.falseAccepts,
          rate: ratio(b.falseAccepts, b.items),
          shareOfAccepts: ratio(b.falseAccepts, accepts),
        },
      ];
    }),
  ) as Record<ClassBucket, ClassFigures>;
  return {
    n: items.length,
    outcomes,
    precision: ratio(outcomes.true_accept, accepts),
    recall: ratio(outcomes.true_accept, exactGolds),
    abstention: ratio(outcomes.abstain, items.length),
    wrongRelation: ratio(outcomes.wrong_relation, items.length - exactGolds),
    falseReject: ratio(outcomes.false_reject, exactGolds),
    byClass,
  };
}

export interface VetoMetrics {
  readonly n: number;
  readonly vetoes: number;
  /** Vetoes of non-exact golds, whatever relation they named. */
  readonly rightVetoes: number;
  /** Vetoes of exact golds: a true match turned away. */
  readonly wrongVetoes: number;
  readonly precision: Ratio;
  /** Right vetoes over judgements of non-exact golds. */
  readonly coverage: Ratio;
}

/** S§5.4's veto-only reading: the model's exact is ignored, only its rejections count. */
export function vetoMetrics(
  items: readonly ItemRecord[],
  byKey: ReadonlyMap<string, JudgeItem>,
): VetoMetrics {
  const m = exactMetrics(items, byKey, 'veto-only');
  const right = m.outcomes.correct_reject + m.outcomes.wrong_relation;
  const wrong = m.outcomes.false_reject;
  const nonExact = items.filter((r) => !goldIsExact(goldOf(byKey, r.itemKey).gold)).length;
  return {
    n: items.length,
    vetoes: right + wrong,
    rightVetoes: right,
    wrongVetoes: wrong,
    precision: ratio(right, right + wrong),
    coverage: ratio(right, nonExact),
  };
}

/** Invalid batches over batches, each batch counted once. */
export function invalidBatches(items: readonly ItemRecord[]): Ratio {
  const valid = new Map<string, boolean>();
  for (const r of items) valid.set(r.batchId, r.batchValid);
  return ratio([...valid.values()].filter((v) => !v).length, valid.size);
}

/** Batches that needed the repair retry (two calls) over batches, each batch counted once. */
export function repairedBatches(items: readonly ItemRecord[]): Ratio {
  const attempts = new Map<string, number>();
  for (const r of items) attempts.set(r.batchId, r.attempts);
  return ratio([...attempts.values()].filter((a) => a > 1).length, attempts.size);
}

export interface Agreement {
  /** Items judged in two or more trials at the same nominal batch size. */
  readonly eligible: number;
  readonly sameRelation: Ratio;
  /** The same exact-or-not decision in every trial. */
  readonly sameDecision: Ratio;
}

export function agreement(items: readonly ItemRecord[]): Agreement {
  const seen = new Map<string, string[]>();
  for (const r of items) {
    const k = `${r.nominalSize}|${r.itemKey}`;
    seen.set(k, [...(seen.get(k) ?? []), r.relation]);
  }
  const groups = [...seen.values()].filter((g) => g.length >= 2);
  const same = groups.filter((g) => g.every((x) => x === g[0])).length;
  const sameDecision = groups.filter((g) =>
    g.every((x) => (x === 'exact') === (g[0] === 'exact')),
  ).length;
  return {
    eligible: groups.length,
    sameRelation: ratio(same, groups.length),
    sameDecision: ratio(sameDecision, groups.length),
  };
}

export interface TokenFigures {
  readonly sum: number;
  readonly unreportedCalls: number;
  /** Null when a call did not report this count. */
  readonly perBatch: number | null;
  readonly perListing: number | null;
}

export interface TokensAndCost {
  readonly batches: number;
  readonly calls: number;
  readonly listings: number;
  readonly input: TokenFigures;
  readonly output: TokenFigures;
  readonly cost: {
    readonly knownNanos: number;
    readonly unknownCalls: number;
    /** Null when any call's cost is unknown: never shown as zero. */
    readonly perBatchNanos: number | null;
    readonly perListingNanos: number | null;
  };
}

/** Per batch and per listing, over the calls of the given items' batches, repairs included. */
export function tokensAndCost(
  calls: readonly CallRecord[],
  items: readonly ItemRecord[],
): TokensAndCost {
  const batchIds = new Set(items.map((r) => r.batchId));
  const mine = calls.filter((c) => batchIds.has(c.batchId));
  const batches = batchIds.size;
  const listings = items.length;
  const figures = (field: 'gen_ai.usage.input_tokens' | 'gen_ai.usage.output_tokens') => {
    const values = mine.map((c) => c.usage[field]);
    const unreported = values.filter((v) => v === null).length;
    const sum = values.reduce<number>((a, v) => a + (v ?? 0), 0);
    const complete = unreported === 0 && batches > 0;
    return {
      sum,
      unreportedCalls: unreported,
      perBatch: complete ? sum / batches : null,
      perListing: complete && listings > 0 ? sum / listings : null,
    };
  };
  const unknownCalls = mine.filter((c) => c.cost.source === 'none').length;
  const knownNanos = mine.reduce(
    (a, c) => a + (c.cost.source === 'none' ? 0 : c.cost.amountNanos),
    0,
  );
  const costComplete = unknownCalls === 0 && batches > 0;
  return {
    batches,
    calls: mine.length,
    listings,
    input: figures('gen_ai.usage.input_tokens'),
    output: figures('gen_ai.usage.output_tokens'),
    cost: {
      knownNanos,
      unknownCalls,
      perBatchNanos: costComplete ? knownNanos / batches : null,
      perListingNanos: costComplete && listings > 0 ? knownNanos / listings : null,
    },
  };
}

export interface Latency {
  readonly n: number;
  readonly median: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

/** Call latency in ms: median, nearest-rank p95 and max. */
export function latency(calls: readonly CallRecord[]): Latency {
  const xs = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { n, median: null, p95: null, max: null };
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 1 ? (xs[mid] as number) : ((xs[mid - 1] as number) + (xs[mid] as number)) / 2;
  return { n, median, p95: xs[Math.ceil(0.95 * n) - 1] as number, max: xs[n - 1] as number };
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const align = headers.map((_, i) => (i === 0 ? '---' : '--:'));
  return [
    `| ${headers.join(' | ')} |`,
    `|${align.join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const f = formatRatio;
const num = (x: number | null, digits = 1) => (x === null ? 'not reported' : x.toFixed(digits));
const money = (nanos: number, currency: string) => `${(nanos / 1e9).toFixed(6)} ${currency}`;

function costCell(tc: TokensAndCost, per: 'batch' | 'listing', currency: string): string {
  const v = per === 'batch' ? tc.cost.perBatchNanos : tc.cost.perListingNanos;
  if (v !== null) return money(v, currency);
  return `unknown (${tc.cost.unknownCalls} of ${tc.calls} calls without a cost; known part ${money(tc.cost.knownNanos, currency)})`;
}

/**
 * All calls of a run: output tokens, the reasoning part where reported, the largest output against
 * the cap, and the known spend. Reasoning is summed only over calls that report it.
 */
export function outputLine(calls: readonly CallRecord[], currency: string): string {
  const outs = calls.map((c) => c.usage['gen_ai.usage.output_tokens']);
  const reportedOut = outs.filter((x): x is number => x !== null);
  const withReasoning = calls.filter(
    (c) =>
      c.usage['gen_ai.usage.reasoning.output_tokens'] !== null &&
      c.usage['gen_ai.usage.output_tokens'] !== null,
  );
  const reasoning = withReasoning.reduce(
    (a, c) => a + (c.usage['gen_ai.usage.reasoning.output_tokens'] ?? 0),
    0,
  );
  const outOfThose = withReasoning.reduce(
    (a, c) => a + (c.usage['gen_ai.usage.output_tokens'] ?? 0),
    0,
  );
  const known = calls.filter((c) => c.cost.source !== 'none');
  const spend = known.reduce((a, c) => a + (c.cost.source === 'none' ? 0 : c.cost.amountNanos), 0);
  return [
    `All ${calls.length} calls: output tokens reported by ${reportedOut.length}`,
    reportedOut.length === 0
      ? ''
      : `, sum ${reportedOut.reduce((a, x) => a + x, 0)}, largest ${Math.max(...reportedOut)}`,
    withReasoning.length === 0
      ? '; reasoning tokens not reported'
      : `; reasoning tokens reported by ${withReasoning.length}: ${formatRatio(ratio(reasoning, outOfThose))} of their output`,
    `; known spend ${money(spend, currency)} over ${known.length} calls`,
    known.length === calls.length ? '.' : `; without a cost: ${calls.length - known.length}.`,
  ].join('');
}

export const STANDING_TEXT = [
  '**What this does not show.** The lift over rules cannot be measured in Phase 0: tier 2 (the',
  'title rules) is not implemented yet, so what the judge would have to beat is not available.',
  'These are the judge’s stand-alone numbers on a hard set. They are not the S§6',
  'identity-precision gate (held-out gold set, ≥90% to ship).',
  '',
  '**The set.** 158 query/listing pairs from one owner’s shopping, ported from the predecessor’s',
  'tests, reviews and reports; labels partly from tests and partly from reviews; 37 items have a',
  'set of relations, not one label; no held-out split; heavily weighted to hard cases. A precision',
  'here is a precision on this set. A batch holds one asked product, so most batches are shorter',
  'than their nominal size (see the batch-length table).',
].join('\n');

function sizeRows(run: LoadedRun, byKey: ReadonlyMap<string, JudgeItem>, view: View): string[][] {
  return run.meta.batchSizes.map((size) => {
    const items = run.items.filter((r) => r.nominalSize === size);
    const m = exactMetrics(items, byKey, view);
    return [
      String(size),
      String(m.n),
      f(m.precision),
      f(m.recall),
      f(m.abstention),
      f(m.wrongRelation),
      f(m.falseReject),
      f(repairedBatches(items)),
      f(invalidBatches(items)),
    ];
  });
}

function renderRun(run: LoadedRun, byKey: ReadonlyMap<string, JudgeItem>): string {
  const { meta, summary } = run;
  const out: string[] = [];
  out.push(`## ${meta.label}: \`${meta.model}\`${meta.synthetic ? ' (SYNTHETIC)' : ''}`, '');
  if (meta.synthetic) {
    out.push(
      '> **SYNTHETIC.** This run was made against a scripted server. Its figures describe the',
      '> script, not a model. Never quote them as a result.',
      '',
    );
  }
  out.push(
    `- Prompt \`${meta.promptVersion}\`; API \`${meta.api ?? 'chat'}\`; structured output \`${meta.rung}\`; ${meta.local ? 'local model' : 'hosted model'}; temperature ${meta.temperature ?? 'not sent'}; reasoning effort ${meta.reasoningEffort ?? 'not sent'}; seed ${meta.seed}; ${meta.trials} trials; batch sizes ${meta.batchSizes.join(', ')}.`,
    `- Budgets: ${meta.budgets.maxCalls} calls, ${meta.budgets.maxInputTokens} input tokens, ${meta.budgets.deadlineMs} ms, ${money(meta.budgets.maxSpendNanos, meta.currency)}; spend cap ${meta.prices === null ? 'not guaranteed (no prices)' : 'reserved from prices before each call'}.`,
    summary === null
      ? '- The run has no summary: it did not finish writing (crashed or still running).'
      : `- Judged ${summary.batchesJudged} of ${meta.plannedBatches} planned batches (${summary.judgements} of ${meta.plannedJudgements} judgements) with ${summary.callsMade} calls; ${summary.stoppedBy === null ? 'completed' : `stopped by ${summary.stoppedBy}`}.`,
    '',
  );

  out.push('### Precision of exact, by nominal batch size', '');
  const headers = [
    'Nominal size',
    'n judgements',
    'Precision of exact',
    'Recall of exact',
    'Abstention',
    'Wrong non-exact relation',
    'False reject',
    'Needed the repair',
    'Invalid batches (after it)',
  ];
  out.push(table(headers, sizeRows(run, byKey, 'plain')), '');
  const all = exactMetrics(run.items, byKey, 'plain');
  out.push(
    `All sizes: n ${all.n}; precision ${f(all.precision)}; recall ${f(all.recall)}; abstention ${f(all.abstention)}; invalid batches ${f(invalidBatches(run.items))}.`,
    '',
  );

  out.push('### False accepts by error class', '');
  out.push(
    'Each cell: false accepts over judgements of that class (rate), then the share of all accepts.',
    '',
  );
  const sizes = meta.batchSizes;
  const classRows = CLASS_BUCKETS.map((c) => {
    const cells = sizes.map((size) => {
      const m = exactMetrics(
        run.items.filter((r) => r.nominalSize === size),
        byKey,
      ).byClass[c];
      return `${f(m.rate)}; ${f(m.shareOfAccepts)}`;
    });
    const a = all.byClass[c];
    return [`\`${c}\``, ...cells, `${f(a.rate)}; ${f(a.shareOfAccepts)}`];
  });
  out.push(table(['Class', ...sizes.map((s) => `size ${s}`), 'all sizes'], classRows), '');

  out.push('### By actual batch length', '');
  const lengths = [...new Set(run.items.map((r) => r.batchLength))].sort((a, b) => a - b);
  out.push(
    table(
      [
        'Listings in the batch',
        'Batches',
        'n judgements',
        'Precision of exact',
        'Recall of exact',
        'Abstention',
        'Invalid batches',
      ],
      lengths.map((len) => {
        const items = run.items.filter((r) => r.batchLength === len);
        const m = exactMetrics(items, byKey);
        return [
          String(len),
          String(new Set(items.map((r) => r.batchId)).size),
          String(m.n),
          f(m.precision),
          f(m.recall),
          f(m.abstention),
          f(invalidBatches(items)),
        ];
      }),
    ),
    '',
  );

  out.push('### By position in the batch', '');
  for (const size of sizes.filter((s) => s > 1)) {
    const items = run.items.filter((r) => r.nominalSize === size);
    const positions = [...new Set(items.map((r) => r.position))].sort((a, b) => a - b);
    out.push(`Nominal size ${size}:`, '');
    out.push(
      table(
        ['Position', 'n', 'Precision of exact', 'Recall of exact', 'Abstention'],
        positions.map((p) => {
          const m = exactMetrics(
            items.filter((r) => r.position === p),
            byKey,
          );
          return [String(p), String(m.n), f(m.precision), f(m.recall), f(m.abstention)];
        }),
      ),
      '',
    );
  }

  out.push('### Agreement across trials', '');
  out.push(
    table(
      [
        'Nominal size',
        'Items in 2+ trials',
        'Same relation every trial',
        'Same exact-or-not decision',
      ],
      sizes.map((size) => {
        const a = agreement(run.items.filter((r) => r.nominalSize === size));
        return [String(size), String(a.eligible), f(a.sameRelation), f(a.sameDecision)];
      }),
    ),
    '',
  );

  out.push('### Tokens and cost', '');
  out.push(
    'Over all calls of the batches, repair retries included. Token counts are as the server reported them; a mean is shown only when every call reported the count.',
    '',
  );
  out.push(
    table(
      [
        'Nominal size',
        'Batches',
        'Calls',
        'Input tokens / batch',
        'Output tokens / batch',
        'Input / listing',
        'Output / listing',
        'Cost / batch',
        'Cost / listing',
      ],
      sizes.map((size) => {
        const items = run.items.filter((r) => r.nominalSize === size);
        const tc = tokensAndCost(run.calls, items);
        return [
          String(size),
          String(tc.batches),
          String(tc.calls),
          num(tc.input.perBatch),
          num(tc.output.perBatch),
          num(tc.input.perListing),
          num(tc.output.perListing),
          costCell(tc, 'batch', meta.currency),
          costCell(tc, 'listing', meta.currency),
        ];
      }),
    ),
    '',
  );
  const ones = run.calls.filter((c) => c.batchLength === 1 && c.attempt === 0);
  const reported = ones
    .map((c) => c.usage['gen_ai.usage.input_tokens'])
    .filter((x): x is number => x !== null);
  out.push(
    reported.length === 0
      ? 'Prompt size check: no one-listing call reported its input tokens.'
      : `Prompt size check: one-listing calls reported ${Math.min(...reported)} to ${Math.max(...reported)} input tokens (n ${reported.length}); the code estimated ${Math.min(...ones.map((c) => c.estimatedInputTokens))} to ${Math.max(...ones.map((c) => c.estimatedInputTokens))}. The fixed part must stay under 800 (S§5.7).`,
    '',
  );
  out.push(outputLine(run.calls, meta.currency), '');

  out.push('### Latency per call (ms)', '');
  out.push(
    table(
      ['Nominal size', 'Calls', 'Median', 'p95 (nearest rank)', 'Max'],
      sizes.map((size) => {
        const ids = new Set(run.items.filter((r) => r.nominalSize === size).map((r) => r.batchId));
        const l = latency(run.calls.filter((c) => ids.has(c.batchId)));
        return [String(size), String(l.n), num(l.median, 0), num(l.p95, 0), num(l.max, 0)];
      }),
    ),
    '',
  );

  if (meta.local) {
    out.push('### Veto-only reading (S§5.4: a small local model may only veto)', '');
    out.push(
      'The model’s `exact` is ignored; only its rejections count. A right veto rejects a non-exact gold (whatever relation it names); a wrong veto rejects an exact gold.',
      '',
    );
    out.push(
      table(
        [
          'Nominal size',
          'n',
          'Vetoes',
          'Veto precision (right / vetoes)',
          'Wrong vetoes',
          'Non-exact golds vetoed',
        ],
        sizes.map((size) => {
          const v = vetoMetrics(
            run.items.filter((r) => r.nominalSize === size),
            byKey,
          );
          return [
            String(size),
            String(v.n),
            String(v.vetoes),
            f(v.precision),
            String(v.wrongVetoes),
            f(v.coverage),
          ];
        }),
      ),
      '',
    );
  }
  return out.join('\n');
}

/** The report for one or more runs. Refuses results made on another dataset. */
export function renderReport(runs: readonly LoadedRun[], dataset: readonly JudgeItem[]): string {
  const fp = datasetFingerprint(dataset);
  for (const r of runs) {
    if (r.meta.datasetFingerprint !== fp) {
      throw new Error(
        'a run was made on another version of the dataset; it cannot be scored on this one',
      );
    }
  }
  const byKey = new Map(dataset.map((i) => [i.key, i]));
  const synthetic = runs.some((r) => r.meta.synthetic);
  const out: string[] = ['# Spike D: model judge on the matcher corpus', ''];
  if (synthetic) {
    out.push(
      '> **SYNTHETIC RESULTS.** At least one run below was made against a scripted server. Its',
      '> figures describe the script, not a model, and must never be quoted as a result.',
      '',
    );
  }
  out.push(STANDING_TEXT, '');
  for (const r of runs) out.push(renderRun(r, byKey));
  return out.join('\n');
}

/** `node evals/judge-spike/report.ts <run-dir>... [--draft <path>]`. */
export async function runReportCli(
  argv: readonly string[],
  print: (text: string) => void = (t) => console.info(t),
  printError: (text: string) => void = (t) => console.error(t),
): Promise<number> {
  let positionals: string[];
  let draft: string | undefined;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { draft: { type: 'string' }, help: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    draft = parsed.values.draft;
    if (parsed.values.help) {
      print('usage: node evals/judge-spike/report.ts <run-dir>... [--draft <new file>]');
      return 0;
    }
  } catch {
    printError('refused: the arguments could not be parsed (not printed)');
    return 2;
  }
  if (positionals.length === 0) {
    printError('refused: give one or more run directories');
    return 2;
  }
  let runs: LoadedRun[];
  let text: string;
  try {
    runs = positionals.map(loadRun);
    text = renderReport(runs, DATASET);
  } catch (err) {
    // A file-system or JSON error message can quote a path or file content: print its kind only.
    const e = err as Error & { code?: unknown };
    const own = !('code' in e) && e.name === 'Error';
    printError(
      own
        ? `refused: ${e.message}`
        : `refused: a run directory could not be read (${String(e.code ?? e.name)})`,
    );
    return 2;
  }
  if (draft !== undefined) {
    if (runs.some((r) => r.meta.synthetic)) {
      printError('refused: a draft is written only from real runs, and a run given is synthetic');
      return 2;
    }
    if (runs.some((r) => r.summary === null)) {
      printError('refused: a run given has no summary (it did not finish)');
      return 2;
    }
    try {
      await writeFile(
        draft,
        `<!-- Draft generated by evals/judge-spike/report.ts. Review every figure against the run files before it goes into docs/spikes/d-model-judge.md. -->\n\n${text}\n`,
        { flag: 'wx' },
      );
    } catch (err) {
      printError(
        `refused: the draft could not be written (${(err as Error).name}); an existing file is never overwritten`,
      );
      return 2;
    }
  }
  print(text);
  return 0;
}
