// Set-level requirements of the matcher gold set. Each constant cites where its value comes from.
// Do not lower one without changing the spec first (CONTRIBUTING ground rule 4).
import type { MatchRelation } from '@agentic-dasher/shared';

/** S§5.16 "~60 products"; the 40 + 20 split below needs at least 60. */
export const PRODUCTS_MIN = 60;
/** S§5.16 "15-25 frozen listing snapshots each". */
export const SNAPSHOTS_PER_PRODUCT = { min: 15, max: 25 } as const;
/** S§5.16 "(1,000-1,500 relation labels)": snapshots with a gold relation. */
export const LABELLED_SNAPSHOTS = { min: 1000, max: 1500 } as const;
/** S§5.16 "six categories". The categories themselves are the owner's data, not code. */
export const CATEGORY_COUNT = 6;
/** Plan P0 workstream 4: "three countries (CA, US, and one EU country, e.g. DE)". */
export const COUNTRY_COUNT = 3;
export const REQUIRED_COUNTRIES = ['CA', 'US'] as const;
/** S§5.16, plan P0 workstream 4: "≥40% hard negatives". */
export const HARD_NEGATIVE_MIN_SHARE = 0.4;
/** S§5.16, plan P0 workstream 4: "40 dev and 20 held-out products". */
export const SPLIT_TARGETS = { dev: 40, held_out: 20 } as const;
/** S§5.16, plan P0 exit criteria: "10% double-labelled". */
export const DOUBLE_LABEL_MIN_SHARE = 0.1;

/**
 * PROPOSED, needs the owner's confirmation (the spec does not define "hard negative").
 *
 * A hard negative is a listing whose gold relation is not `exact` but that is the same brand and
 * product line as the target: `variant`, `bundle`, `accessory_or_part` or `other_model`. These
 * are the listings store search pads its results with (S§5.4) and the ones the title rules and
 * the judge prompt exist to separate: variant words, accessory and part rejects, model-token
 * conflicts, "variants in size, colour, capacity, configuration or pack count are not matches".
 * `other_line` (a different product line) is the easy negative, and `unknown` is no decision.
 * The share is taken over every snapshot with a gold relation, `unknown` included.
 */
export const HARD_NEGATIVE_RELATIONS: ReadonlySet<MatchRelation> = new Set([
  'variant',
  'bundle',
  'accessory_or_part',
  'other_model',
]);

export function isHardNegative(relation: MatchRelation): boolean {
  return HARD_NEGATIVE_RELATIONS.has(relation);
}
