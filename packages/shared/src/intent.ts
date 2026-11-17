// S§5.4 SearchIntent: the planner's part (model output) and the stored intent.
import { z } from 'zod';
import { distinct, Gtin14, ModelAttributeName, modelText } from './common.ts';
import { MinorUnitCurrency } from './currency.ts';
import { Money } from './money.ts';
import { Condition, Fulfilment, IntentKind } from './vocab.ts';

/**
 * What the planner may write (S§5.6 step 1). Its text is search input, matched against listings as
 * text and never parsed into a figure (see `modelText`). It has no field for a budget, a currency,
 * a location or an identifier (GTIN, MPN): tier 1 confirms identity on identifiers and alerts follow
 * from it (S§5.4), so code sets them from the user's input and settings (S§2.1, S§2.3).
 *
 * Fields are nullable rather than optional, as strict JSON-schema output needs. The patterns are
 * enforced by Zod after the reply: `z.toJSONSchema` exports only the pattern source, without the
 * `u` flag, and compiled without it `^[^\p{Sc}%]*$` refuses "Sony" and accepts "$300". The Phase 2
 * structured-output unit must not rely on patterns in an exported schema.
 */
export const PlannerIntent = z.strictObject({
  kind: IntentKind,
  name: modelText(200),
  brand: modelText(100).nullable(),
  model: modelText(100).nullable(),
  mustHave: z
    .array(z.strictObject({ attribute: ModelAttributeName, value: modelText(64) }))
    .max(10)
    .refine(
      (items) => new Set(items.map((i) => i.attribute)).size === items.length,
      'each attribute once',
    ),
  substitutes: distinct(modelText(120), 5),
  conditions: distinct(Condition, 8).min(1),
  packQuantity: z.int().min(1).max(1000).nullable(),
  fulfilment: distinct(Fulfilment, 2).min(1),
});
export type PlannerIntent = z.infer<typeof PlannerIntent>;

/** The interpret call's output: the intent plus 3-5 query variants (S§5.6). */
export const PlannerOutput = z.strictObject({
  intent: PlannerIntent,
  queries: z.array(modelText(200)).min(3).max(5),
});
export type PlannerOutput = z.infer<typeof PlannerOutput>;

/**
 * The stored intent (`watch.spec_json`, `search_run.intent_json`). Code adds the identifiers (GTIN
 * parsed and check-digit validated, MPN), the user's currency and location, and the budget, which
 * is Money in the user's currency taken from the user's own input, never from model output.
 */
export const SearchIntent = PlannerIntent.extend({
  gtin: Gtin14.nullable(),
  mpn: z.string().min(1).max(64).nullable(),
  currency: MinorUnitCurrency,
  location: z.strictObject({
    country: z.string().regex(/^[A-Z]{2}$/),
    postalCode: z.string().min(1).max(16).nullable(),
  }),
  budget: Money.nullable(),
}).superRefine((intent, ctx) => {
  const { budget } = intent;
  if (budget !== null && (budget.currency !== intent.currency || budget.amountMinor <= 0)) {
    ctx.addIssue({
      code: 'custom',
      path: ['budget'],
      message: 'a budget is a positive amount in the intent currency',
    });
  }
});
export type SearchIntent = z.infer<typeof SearchIntent>;
