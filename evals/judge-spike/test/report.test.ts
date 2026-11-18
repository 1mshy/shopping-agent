// Report arithmetic on hand-built records. Every expected value is worked out by hand in the
// comments, from the five items and the judgements below.
import type { MatchRelation } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import type { MatchCase } from '../../corpus/areas/match-title-rules/contract.ts';
import { asked, listing } from '../../corpus/areas/match-title-rules/contract.ts';
import { defineArea } from '../../corpus/harness.ts';
import { buildDataset, datasetFingerprint } from '../dataset.ts';
import type { CallRecord, ItemRecord, RunMeta } from '../lib/records.ts';
import {
  agreement,
  exactMetrics,
  invalidBatches,
  latency,
  renderReport,
  repairedBatches,
  tokensAndCost,
  vetoMetrics,
} from '../lib/report.ts';
import { ratio } from '../lib/score.ts';

const mk = (id: string, expected: MatchCase['expected']) =>
  ({
    id,
    what: id,
    input: { asked: asked('Acme Widget 3'), listing: listing(`Listing ${id}`) },
    expected,
    from: [{ kind: 'test', ref: 'hand-built' }],
    label: 'hand-built',
  }) as MatchCase;

// A: exact, B: exact, C: other_model, D: variant (unspecified), E: set {other_line, unknown}.
const dataset = buildDataset([
  defineArea<MatchCase>({
    id: 'fake',
    status: 'pending',
    sources: ['hand-built'],
    cases: [
      mk('a', { relation: 'exact' }),
      mk('b', { relation: 'exact' }),
      mk('c', { relation: 'other_model' }),
      mk('d', { relation: 'variant' }),
      mk('e', { oneOf: ['other_line', 'unknown'] }),
    ],
  }),
]);
const byKey = new Map(dataset.map((i) => [i.key, i]));

function item(
  batchId: string,
  trial: number,
  nominalSize: number,
  keys: string[],
  key: string,
  relation: MatchRelation,
  batchValid = true,
): ItemRecord {
  const position = keys.indexOf(key) + 1;
  return {
    kind: 'item',
    runId: 'r',
    trial,
    nominalSize,
    batchId,
    batchLength: keys.length,
    position,
    batchItemKeys: keys.map((k) => `fake/${k}`),
    itemKey: `fake/${key}`,
    listingId: `L${position}`,
    relation,
    batchValid,
    invalidReason: batchValid ? null : 'not_json',
    attempts: 1,
    promptVersion: 'judge.v1',
  };
}

const five = ['a', 'b', 'c', 'd', 'e'];
// Trial 1, size 5: A exact (true accept), B unknown (abstain), C exact (false accept, other_model),
// D bundle (wrong relation), E exact (false accept, set).
const t1 = (['exact', 'unknown', 'exact', 'bundle', 'exact'] as const).map((r, i) =>
  item('b1', 1, 5, five, five[i] as string, r),
);
// Trial 2, size 5: the same except C other_model (a correct rejection).
const t2 = (['exact', 'unknown', 'other_model', 'bundle', 'exact'] as const).map((r, i) =>
  item('b2', 2, 5, five, five[i] as string, r),
);
// Size 1: one batch of A, invalid, so A is unknown.
const s1 = [item('b3', 1, 1, ['a'], 'a', 'unknown', false)];

function call(batchId: string, nominalSize: number, more: Partial<CallRecord>): CallRecord {
  return {
    kind: 'call',
    runId: 'r',
    callIndex: 0,
    batchId,
    trial: 1,
    nominalSize,
    batchLength: 5,
    attempt: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 100,
    estimatedInputTokens: 900,
    reserveNanos: null,
    request: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: {} },
    response: null,
    transportError: null,
    valid: true,
    invalidReason: null,
    invalidDetail: null,
    verdicts: null,
    usage: {
      'gen_ai.usage.input_tokens': null,
      'gen_ai.usage.cache_read.input_tokens': null,
      'gen_ai.usage.cache_write.input_tokens': null,
      'gen_ai.usage.output_tokens': null,
      'gen_ai.usage.reasoning.output_tokens': null,
    },
    cost: { source: 'none' },
    providerCostText: null,
    promptVersion: 'judge.v1',
    model: 'm',
    endpointLabel: 'e',
    ...more,
  };
}
const usage = (input: number, output: number) => ({
  'gen_ai.usage.input_tokens': input,
  'gen_ai.usage.cache_read.input_tokens': null,
  'gen_ai.usage.cache_write.input_tokens': null,
  'gen_ai.usage.output_tokens': output,
  'gen_ai.usage.reasoning.output_tokens': null,
});
const calls = [
  call('b1', 5, {
    usage: usage(1000, 200),
    cost: { source: 'settings', amountNanos: 300, currency: 'USD' },
    latencyMs: 100,
  }),
  call('b2', 5, { usage: usage(1100, 210), latencyMs: 300 }),
];

describe('exact metrics (plain reading)', () => {
  const m = exactMetrics(t1, byKey, 'plain');
  it('precision is right accepts over all accepts', () => {
    // Accepts: A, C, E = 3; right: A = 1.
    expect(m.precision).toEqual(ratio(1, 3));
  });
  it('recall is right accepts over exact golds', () => {
    // Exact golds: A, B = 2; accepted: A.
    expect(m.recall).toEqual(ratio(1, 2));
  });
  it('abstention is unknown answers over judgements', () => {
    expect(m.abstention).toEqual(ratio(1, 5));
  });
  it('wrong non-exact relations are counted apart from false accepts', () => {
    // Non-exact golds: C, D, E = 3; wrong relation: D.
    expect(m.wrongRelation).toEqual(ratio(1, 3));
    expect(m.outcomes.false_accept).toBe(2);
  });
  it('false accepts by error class: rate within the class and share of all accepts', () => {
    expect(m.byClass.other_model).toEqual({
      items: 1,
      falseAccepts: 1,
      rate: ratio(1, 1),
      shareOfAccepts: ratio(1, 3),
    });
    expect(m.byClass.set).toEqual({
      items: 1,
      falseAccepts: 1,
      rate: ratio(1, 1),
      shareOfAccepts: ratio(1, 3),
    });
    expect(m.byClass['variant:unspecified']?.rate).toEqual(ratio(0, 1));
  });
  it('is undefined, not zero, with no accepts', () => {
    const m1 = exactMetrics(s1, byKey, 'plain');
    expect(m1.precision).toEqual(ratio(0, 0));
    expect(m1.precision.value).toBeNull();
    expect(m1.recall).toEqual(ratio(0, 1));
  });
});

describe('the veto-only reading', () => {
  it('counts only rejections', () => {
    // Exact answers become abstentions; the one rejection (D, bundle) is of a non-exact gold.
    const v = vetoMetrics(t1, byKey);
    expect(v.vetoes).toBe(1);
    expect(v.rightVetoes).toBe(1);
    expect(v.wrongVetoes).toBe(0);
    expect(v.precision).toEqual(ratio(1, 1));
    // Non-exact golds: C, D, E = 3; vetoed: D.
    expect(v.coverage).toEqual(ratio(1, 3));
  });
});

describe('batches, trials, tokens, latency', () => {
  it('invalid-batch rate is over distinct batches', () => {
    expect(invalidBatches([...t1, ...s1])).toEqual(ratio(1, 2));
  });
  it('repaired-batch rate is over distinct batches', () => {
    // b1 took one call; a copy of b3 that took two (the repair) makes 1 of 2.
    const repaired = s1.map((r) => ({ ...r, attempts: 2 }));
    expect(repairedBatches([...t1, ...repaired])).toEqual(ratio(1, 2));
  });
  it('agreement across trials, by relation and by exact-or-not', () => {
    // Items with two trials: 5. Same relation: all but C (exact, other_model) = 4.
    // Same exact-or-not decision: C differs too = 4.
    const a = agreement([...t1, ...t2]);
    expect(a.eligible).toBe(5);
    expect(a.sameRelation).toEqual(ratio(4, 5));
    expect(a.sameDecision).toEqual(ratio(4, 5));
  });
  it('tokens per batch and per listing; cost unknown when any call lacks it', () => {
    const tc = tokensAndCost(calls, [...t1, ...t2]);
    expect(tc.batches).toBe(2);
    expect(tc.listings).toBe(10);
    // (1,000 + 1,100) / 2 batches = 1,050; / 10 listings = 210.
    expect(tc.input.perBatch).toBe(1050);
    expect(tc.input.perListing).toBe(210);
    // (200 + 210) / 2 = 205; / 10 = 41.
    expect(tc.output.perBatch).toBe(205);
    expect(tc.output.perListing).toBe(41);
    expect(tc.cost.knownNanos).toBe(300);
    expect(tc.cost.unknownCalls).toBe(1);
    expect(tc.cost.perBatchNanos).toBeNull();
  });
  it('latency: median, nearest-rank p95 and max', () => {
    // [100, 300]: median (100 + 300) / 2 = 200; p95 rank ceil(0.95 x 2) = 2 → 300.
    expect(latency(calls)).toEqual({ n: 2, median: 200, p95: 300, max: 300 });
    expect(latency([])).toEqual({ n: 0, median: null, p95: null, max: null });
  });
});

describe('the rendered report', () => {
  const meta: RunMeta = {
    formatVersion: 1,
    runId: 'r',
    synthetic: true,
    label: 'e',
    model: 'm',
    baseUrl: 'http://127.0.0.1:9/v1',
    local: false,
    rung: 'json_schema',
    temperature: null,
    reasoningEffort: null,
    maxTokensField: 'max_completion_tokens',
    maxOutputTokens: 1024,
    batchSizes: [1, 5],
    trials: 2,
    seed: 1,
    prices: null,
    currency: 'USD',
    providerCostCurrency: null,
    acceptUnknownCost: true,
    budgets: { maxCalls: 10, maxInputTokens: 10_000, deadlineMs: 1000, maxSpendNanos: 1 },
    promptVersion: 'judge.v1',
    promptSha256: 'x',
    datasetFingerprint: datasetFingerprint(dataset),
    plannedBatches: 3,
    plannedJudgements: 11,
    startedAt: '2026-01-01T00:00:00.000Z',
  };
  const text = renderReport(
    [{ dir: 'x', meta, summary: null, calls, items: [...t1, ...t2, ...s1] }],
    dataset,
  );

  it('labels a synthetic run as such', () => {
    expect(text).toMatch(/SYNTHETIC/);
  });
  it('adds the veto-only reading for a local model only', () => {
    expect(text).not.toMatch(/Veto-only reading/);
    const local = renderReport(
      [{ dir: 'x', meta: { ...meta, local: true }, summary: null, calls, items: t1 }],
      dataset,
    );
    // Size 5, trial 1: one veto (D), right; non-exact golds C, D, E.
    expect(local).toMatch(/Veto-only reading/);
    expect(local).toContain('| 5 | 5 | 1 | 1/1 = 1.000 | 0 | 1/3 = 0.333 |');
  });
  it('shows numerator, denominator and undefined ratios', () => {
    expect(text).toContain('1/3 = 0.333');
    expect(text).toContain('0/0 = undefined');
  });
  it('says that the lift over rules cannot be measured in Phase 0', () => {
    expect(text).toMatch(/lift over rules cannot be measured in Phase 0/i);
  });
  it('refuses results made on another dataset', () => {
    expect(() =>
      renderReport(
        [
          {
            dir: 'x',
            meta: { ...meta, datasetFingerprint: 'f'.repeat(64) },
            summary: null,
            calls,
            items: t1,
          },
        ],
        dataset,
      ),
    ).toThrow(/dataset/);
  });
});
