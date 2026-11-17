// S§4.4 run and run_step: the harness RunRecord (S§5.7, S§5.16).
//
// Attribute names follow the OpenTelemetry GenAI semantic conventions, which left the main
// repository in v1.45.0 for open-telemetry/semantic-conventions-genai (status: development, no
// tagged release; checked at commit e6658f1 of 2026-11-06). The usage attributes are the S§4.4
// normalisation: input includes cached tokens, cache reads and writes are parts of input, and
// reasoning is part of output.
//
// Money here is NanoMoney (common.ts): integer nano-units of the major unit with an explicit
// currency. A provider-reported cost is read from its decimal text exactly; any digit beyond the
// ninth decimal rounds the amount up, so a spend cap is never under-counted.
import { z } from 'zod';
import { distinct, Id, NanoMoney, notBefore, Timestamp, Version } from './common.ts';
import { MinorUnitCurrency } from './currency.ts';
import { BudgetKind, LlmEndpointRole, RunStatus, RunType } from './vocab.ts';

/** The four budgets every run carries (S§2.6, S§5.7). The deadline is from the run's start. */
export const RunBudget = z.strictObject({
  maxTurns: z.int().positive(),
  deadlineMs: z.int().positive(),
  maxInputTokens: z.int().positive(),
  maxSpend: NanoMoney,
});
export type RunBudget = z.infer<typeof RunBudget>;

/** Cost and where it came from (S§5.7). With `none` the cost is unknown: no amount, never zero. */
export const RunCost = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('none') }),
  z.strictObject({
    source: z.literal(['provider', 'settings']),
    amountNanos: z.int().nonnegative(),
    currency: MinorUnitCurrency,
  }),
]);
export type RunCost = z.infer<typeof RunCost>;

const tokens = z.int().nonnegative().nullable();
/** Token usage; null is "not reported", never zero. */
const usage = {
  'gen_ai.usage.input_tokens': tokens,
  'gen_ai.usage.cache_read.input_tokens': tokens,
  'gen_ai.usage.cache_write.input_tokens': tokens,
  'gen_ai.usage.output_tokens': tokens,
  'gen_ai.usage.reasoning.output_tokens': tokens,
};
type Usage = { [K in keyof typeof usage]: number | null };

function checkUsage(u: Usage, ctx: z.RefinementCtx): void {
  const input = u['gen_ai.usage.input_tokens'];
  const cached =
    (u['gen_ai.usage.cache_read.input_tokens'] ?? 0) +
    (u['gen_ai.usage.cache_write.input_tokens'] ?? 0);
  if (input !== null && cached > input) {
    const path = ['gen_ai.usage.input_tokens'];
    ctx.addIssue({ code: 'custom', path, message: 'input includes cached tokens' });
  }
  const output = u['gen_ai.usage.output_tokens'];
  if (output !== null && (u['gen_ai.usage.reasoning.output_tokens'] ?? 0) > output) {
    const path = ['gen_ai.usage.output_tokens'];
    ctx.addIssue({ code: 'custom', path, message: 'output includes reasoning tokens' });
  }
}

function endsAfterStart(t: { startedAt: string; endedAt: string | null }, ctx: z.RefinementCtx) {
  if (t.endedAt !== null && !notBefore(t.startedAt, t.endedAt)) {
    ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'ends no earlier than it starts' });
  }
}

/**
 * One harness run (S§4.4) of one type (S§5.7). A fast search is one run whose steps call the
 * planner and the judge, so the endpoint role, prompt version and model live on each model-call
 * step; usage and cost here are totals over the steps.
 */
export const RunRecord = z
  .strictObject({
    id: Id,
    profileId: Id,
    type: RunType,
    status: RunStatus,
    startedAt: Timestamp,
    endedAt: Timestamp.nullable(),
    budget: RunBudget,
    budgetHits: distinct(BudgetKind, 4),
    turns: z.int().nonnegative(),
    ...usage,
    cost: RunCost,
  })
  .superRefine((r, ctx) => {
    checkUsage(r, ctx);
    endsAfterStart(r, ctx);
    if ((r.status === 'running') !== (r.endedAt === null)) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'set exactly when finished' });
    }
    // Turns are checked before each call (S§2.6), so they never pass the cap. Tokens, time and
    // spend can overshoot within the last call, so they are not bounded here.
    if (r.turns > r.budget.maxTurns) {
      ctx.addIssue({ code: 'custom', path: ['turns'], message: 'turns never exceed maxTurns' });
    }
    if (r.cost.source === 'none') {
      // Where cost is unknown, spend cannot be measured, so it cannot have been hit (S§5.7).
      if (r.budgetHits.includes('spend')) {
        const message = 'a spend hit needs a known cost';
        ctx.addIssue({ code: 'custom', path: ['budgetHits'], message });
      }
    } else if (r.cost.currency !== r.budget.maxSpend.currency) {
      ctx.addIssue({ code: 'custom', path: ['cost'], message: 'cost is in the spend currency' });
    }
  });
export type RunRecord = z.infer<typeof RunRecord>;

/**
 * A refusal returned to the model (S§5.7). The hint refuses every decimal digit (`\p{Nd}`, so
 * "٣" and "３" too); a number spelled out in words is not caught.
 */
export const Refusal = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  whatTheEngineSaw: z.string().min(1).max(500),
  hint: z
    .string()
    .max(300)
    .regex(/^\P{Nd}*$/u, 'a hint carries no figure (S§5.7)'),
});
export type Refusal = z.infer<typeof Refusal>;

const step = {
  id: Id,
  runId: Id,
  profileId: Id,
  index: z.int().nonnegative(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  /** Request and response; trimmed to null after 14 days, keeping usage (S§4.4). */
  payload: z.json().nullable(),
};

/** One step of a run: a model call or a tool call, discriminated on `gen_ai.operation.name`. */
export const RunStep = z.discriminatedUnion('gen_ai.operation.name', [
  z
    .strictObject({
      'gen_ai.operation.name': z.literal('chat'),
      ...step,
      role: LlmEndpointRole,
      promptVersion: Version,
      'gen_ai.provider.name': z.string().min(1).max(64),
      'gen_ai.request.model': z.string().min(1).max(200),
      'gen_ai.response.model': z.string().min(1).max(200).nullable(),
      'gen_ai.response.id': z.string().min(1).max(200).nullable(),
      'gen_ai.response.finish_reasons': z.array(z.string().min(1).max(64)).max(16),
      ...usage,
      cost: RunCost,
    })
    .superRefine((s, ctx) => {
      checkUsage(s, ctx);
      endsAfterStart(s, ctx);
    }),
  z
    .strictObject({
      'gen_ai.operation.name': z.literal('execute_tool'),
      ...step,
      'gen_ai.tool.name': z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      'gen_ai.tool.call.id': z.string().min(1).max(200).nullable(),
      refusal: Refusal.nullable(),
    })
    .superRefine(endsAfterStart),
]);
export type RunStep = z.infer<typeof RunStep>;
