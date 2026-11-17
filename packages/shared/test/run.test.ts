import { describe, it } from 'vitest';
import { RunRecord, RunStep } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

// A fast search: one run whose steps call the planner and the judge (S§5.6, S§5.7), at most two
// model turns, capped at the fast-mode $0.03.
// Money for runs is integer nano-units of the major unit: $0.03 = 30,000,000.
const usage = {
  'gen_ai.usage.input_tokens': 4200,
  'gen_ai.usage.cache_read.input_tokens': 3000,
  'gen_ai.usage.cache_write.input_tokens': 0,
  'gen_ai.usage.output_tokens': 610,
  'gen_ai.usage.reasoning.output_tokens': 128,
};
const run = {
  id: 77,
  profileId: 1,
  type: 'fast_search',
  status: 'completed',
  startedAt: '2026-11-17T10:00:00.000Z',
  endedAt: '2026-11-17T10:00:04.512Z',
  budget: {
    maxTurns: 2,
    deadlineMs: 60000,
    maxInputTokens: 30000,
    maxSpend: { amountNanos: 30_000_000, currency: 'USD' },
  },
  budgetHits: [],
  turns: 2,
  ...usage,
  cost: { source: 'provider', amountNanos: 412_350, currency: 'USD' },
};

describe('RunRecord (S§4.4, S§5.7)', () => {
  it('accepts a finished run, a running one and one with unknown cost and usage', () => {
    expectValid(RunRecord, run);
    expectValid(RunRecord, { ...run, status: 'running', endedAt: null });
    expectValid(RunRecord, {
      ...run,
      'gen_ai.usage.cache_read.input_tokens': null,
      'gen_ai.usage.cache_write.input_tokens': null,
      'gen_ai.usage.reasoning.output_tokens': null,
      cost: { source: 'none' },
      budgetHits: ['turns'],
    });
  });

  it('never records an unknown cost as zero', () => {
    expectRefused(
      RunRecord,
      { ...run, cost: { source: 'none', amountNanos: 0, currency: 'USD' } },
      'cost',
    );
    expectRefused(RunRecord, { ...run, cost: { source: 'settings' } }, 'cost.amountNanos');
    expectRefused(RunRecord, { ...run, cost: null }, 'cost');
  });

  it('holds cost and spend as integer nano-units in an explicit currency', () => {
    expectRefused(
      RunRecord,
      { ...run, cost: { ...run.cost, amountNanos: 0.0004 } },
      'cost.amountNanos',
    );
    expectRefused(
      RunRecord,
      { ...run, cost: { source: 'provider', amountNanos: 412_350 } },
      'cost.currency',
    );
    expectRefused(RunRecord, { ...run, cost: { ...run.cost, currency: 'EUR' } }, 'cost');
    const budget = { ...run.budget, maxSpend: { amountNanos: 0.03, currency: 'USD' } };
    expectRefused(RunRecord, { ...run, budget }, 'budget.maxSpend.amountNanos');
  });

  it('requires all four budgets (S§2.6)', () => {
    for (const key of ['maxTurns', 'deadlineMs', 'maxInputTokens', 'maxSpend']) {
      const budget: Record<string, unknown> = { ...run.budget };
      delete budget[key];
      expectRefused(RunRecord, { ...run, budget }, `budget.${key}`);
    }
    expectRefused(RunRecord, { ...run, budget: { ...run.budget, maxTurns: 0 } }, 'budget.maxTurns');
    expectRefused(RunRecord, { ...run, budgetHits: ['turns', 'turns'] }, 'budgetHits');
  });

  it('follows the OpenTelemetry usage rules: cached counts in input, reasoning in output', () => {
    expectRefused(
      RunRecord,
      { ...run, 'gen_ai.usage.cache_read.input_tokens': 5000 },
      'gen_ai.usage.input_tokens',
    );
    expectRefused(
      RunRecord,
      { ...run, 'gen_ai.usage.reasoning.output_tokens': 700 },
      'gen_ai.usage.output_tokens',
    );
    expectRefused(
      RunRecord,
      { ...run, 'gen_ai.usage.output_tokens': 1.5 },
      'gen_ai.usage.output_tokens',
    );
    expectRefused(RunRecord, { ...run, inputTokens: 4200 }, '');
  });

  it('ties the end time to the status', () => {
    expectRefused(RunRecord, { ...run, endedAt: null }, 'endedAt');
    expectRefused(RunRecord, { ...run, status: 'running' }, 'endedAt');
    expectRefused(RunRecord, { ...run, status: 'done' }, 'status');
    expectRefused(RunRecord, { ...run, endedAt: '2026-11-17T09:59:59.999Z' }, 'endedAt');
  });

  it('has one run type; roles belong to its model calls', () => {
    for (const type of ['fast_search', 'chat', 'store_run', 'deep_job', 'recommendation_job']) {
      expectValid(RunRecord, { ...run, type });
    }
    expectRefused(RunRecord, { ...run, type: 'judge' }, 'type');
    expectRefused(RunRecord, { ...run, role: 'judge' }, '');
    expectRefused(RunRecord, { ...run, 'gen_ai.request.model': 'openai/gpt-5-mini' }, '');
  });

  it('cannot record a spend hit when the cost is unknown (S§5.7)', () => {
    expectRefused(
      RunRecord,
      { ...run, cost: { source: 'none' }, budgetHits: ['spend'] },
      'budgetHits',
    );
    expectValid(RunRecord, { ...run, budgetHits: ['spend'] });
  });

  it('never takes more turns than its cap (checked before each call, S§2.6)', () => {
    expectRefused(RunRecord, { ...run, turns: 3 }, 'turns');
    // Tokens and spend may overshoot within the last call, so they are not bounded here.
    expectValid(RunRecord, {
      ...run,
      'gen_ai.usage.input_tokens': 31000,
      budgetHits: ['input_tokens'],
    });
  });
});

const stepBase = {
  id: 1,
  runId: 77,
  profileId: 1,
  index: 0,
  startedAt: '2026-11-17T10:00:00.000Z',
  endedAt: '2026-11-17T10:00:04.000Z',
  payload: null,
};
const modelCall = {
  ...stepBase,
  'gen_ai.operation.name': 'chat',
  role: 'judge',
  promptVersion: 'judge-2',
  'gen_ai.provider.name': 'openrouter',
  'gen_ai.request.model': 'openai/gpt-5-mini',
  'gen_ai.response.model': 'openai/gpt-5-mini-2026-08-07',
  'gen_ai.response.id': 'gen-123',
  'gen_ai.response.finish_reasons': ['stop'],
  ...usage,
  cost: { source: 'settings', amountNanos: 412_350, currency: 'USD' },
};
const toolCall = {
  ...stepBase,
  index: 1,
  'gen_ai.operation.name': 'execute_tool',
  'gen_ai.tool.name': 'page_read',
  'gen_ai.tool.call.id': 'call_1',
  refusal: {
    code: 'not_on_page',
    whatTheEngineSaw: 'No product markup on the page.',
    hint: 'Open the product page first.',
  },
  payload: { request: { ref: 'e12' }, response: null },
};

describe('RunStep', () => {
  it('accepts a model call and a tool call', () => {
    expectValid(RunStep, modelCall);
    expectValid(RunStep, toolCall);
    expectValid(RunStep, { ...toolCall, refusal: null, 'gen_ai.tool.call.id': null });
  });

  it('discriminates on gen_ai.operation.name and refuses a hint with a figure (S§5.7)', () => {
    expectRefused(
      RunStep,
      { ...modelCall, 'gen_ai.operation.name': 'embeddings' },
      'gen_ai.operation.name',
    );
    const refusal = { ...toolCall.refusal, hint: 'Try 199.99 instead.' };
    expectRefused(RunStep, { ...toolCall, refusal }, 'refusal.hint');
    expectRefused(RunStep, { ...modelCall, cost: { source: 'none', amountNanos: 0 } }, 'cost');
    for (const hint of ['Try ٣ instead.', 'Try ３ instead.', 'Try 1 more.']) {
      expectRefused(
        RunStep,
        { ...toolCall, refusal: { ...toolCall.refusal, hint } },
        'refusal.hint',
      );
    }
  });

  it('puts the role, prompt version, provider and model on the model call', () => {
    expectValid(RunStep, { ...modelCall, role: 'planner', promptVersion: 'plan-1' });
    expectRefused(RunStep, { ...modelCall, role: 'buyer' }, 'role');
    const { role: _, ...noRole } = modelCall;
    expectRefused(RunStep, noRole, 'role');
    expectRefused(RunStep, { ...modelCall, 'gen_ai.provider.name': '' }, 'gen_ai.provider.name');
    expectRefused(RunStep, { ...modelCall, endedAt: '2026-11-17T09:00:00.000Z' }, 'endedAt');
  });
});
