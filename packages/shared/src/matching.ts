// S§4.1 match_verdict and the model judge's output (S§5.4).
import { z } from 'zod';
import { AttributeName, distinct, Timestamp, Version } from './common.ts';
import { DecidedBy, MatchRelation } from './vocab.ts';

const fingerprint = z.string().min(1).max(256);

/**
 * Cached identity decision, keyed on spec and listing fingerprints, matcher version, prompt version
 * and model id (S§5.4). Prompt version and model id are set exactly when the model decided.
 */
export const MatchVerdict = z
  .strictObject({
    specFp: fingerprint,
    listingFp: fingerprint,
    relation: MatchRelation,
    differingAttrs: distinct(AttributeName, 10),
    decidedBy: DecidedBy,
    matcherVersion: Version,
    promptVersion: Version.nullable(),
    modelId: z.string().min(1).max(200).nullable(),
    decidedAt: Timestamp,
  })
  .superRefine((v, ctx) => {
    const byModel = v.decidedBy === 'model';
    for (const path of ['promptVersion', 'modelId'] as const) {
      if (byModel !== (v[path] !== null)) {
        ctx.addIssue({ code: 'custom', path: [path], message: 'set exactly for model verdicts' });
      }
    }
  });
export type MatchVerdict = z.infer<typeof MatchVerdict>;

/**
 * One judged listing, as the model returns it: `{id, relation, differing_attrs, reason}` (S§5.4).
 * Strict, so no extra field can carry a figure. `differingAttrs` holds attribute names only.
 * `reason` is diagnostic: it stays in the run step payload and is never copied into a verdict or
 * shown as a fact. The id is the batch label code assigned; code checks it against the batch.
 */
export const JudgeVerdict = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
  relation: MatchRelation,
  differingAttrs: z.array(AttributeName).max(10),
  reason: z.string().max(300),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

/** A judge call's output: at most 15 listings (S§5.4), each id once. */
export const JudgeBatch = z.strictObject({
  verdicts: z
    .array(JudgeVerdict)
    .min(1)
    .max(15)
    .refine((vs) => new Set(vs.map((v) => v.id)).size === vs.length, 'each id once'),
});
export type JudgeBatch = z.infer<typeof JudgeBatch>;
