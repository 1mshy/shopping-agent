// S§4.4 run and run_step: the harness RunRecord (S§5.7, S§5.16).
//
// Attribute names follow the OpenTelemetry GenAI semantic conventions, which left the main
// repository in v1.45.0 for open-telemetry/semantic-conventions-genai (status: development, no
// tagged release; checked at commit e6658f1 of 2026-11-06). The usage attributes are the S§4.4
// normalisation: input includes cached tokens, cache reads and writes are parts of input, and
// reasoning is part of output.
import { z } from 'zod';
import { distinct, Id, NanoMoney, Timestamp, Version } from './common.ts';
import { MinorUnitCurrency } from './currency.ts';
import { BudgetKind, LlmEndpointRole, RunStatus } from './vocab.ts';

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

/** One harness run (S§4.4). Usage and cost are totals over its steps. */
export const RunRecord = z
  .strictObject({
    id: Id,
    profileId: Id,
    role: LlmEndpointRole,
    promptVersion: Version,
    'gen_ai.provider.name': z.string().min(1).max(64),
    'gen_ai.request.model': z.string().min(1).max(200),
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
    if ((r.status === 'running') !== (r.endedAt === null)) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'set exactly when finished' });
    }
    if (r.cost.source !== 'none' && r.cost.currency !== r.budget.maxSpend.currency) {
      ctx.addIssue({ code: 'custom', path: ['cost'], message: 'cost is in the spend currency' });
    }
  });
export type RunRecord = z.infer<typeof RunRecord>;

/** A refusal returned to the model (S§5.7). A hint never contains a figure to try. */
export const Refusal = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  whatTheEngineSaw: z.string().min(1).max(500),
  hint: z
    .string()
    .max(300)
    .regex(/^[^0-9]*$/, 'a hint carries no figure (S§5.7)'),
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
      'gen_ai.request.model': z.string().min(1).max(200),
      'gen_ai.response.model': z.string().min(1).max(200).nullable(),
      'gen_ai.response.id': z.string().min(1).max(200).nullable(),
      'gen_ai.response.finish_reasons': z.array(z.string().min(1).max(64)).max(16),
      ...usage,
      cost: RunCost,
    })
    .superRefine(checkUsage),
  z.strictObject({
    'gen_ai.operation.name': z.literal('execute_tool'),
    ...step,
    'gen_ai.tool.name': z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    'gen_ai.tool.call.id': z.string().min(1).max(200).nullable(),
    refusal: Refusal.nullable(),
  }),
]);
export type RunStep = z.infer<typeof RunStep>;
