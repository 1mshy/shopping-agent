// The scoring rules of spike D, fixed before any result exists (see README "Scoring rules").
//
// One judgement is the judge's relation for one item. An invalid batch scores as `unknown` for
// every item in it (S§5.4: "Invalid output means unknown"), so it reaches here as `unknown`.
import type { MatchRelation } from '@agentic-dasher/shared';
import type { MatchExpected } from '../../corpus/areas/match-title-rules/contract.ts';

export const OUTCOMES = [
  /** The judge said exact and the gold is exact. */
  'true_accept',
  /** The judge said exact and the gold is a single non-exact relation or a set (sets never hold exact). */
  'false_accept',
  /** The judge said unknown: neither an accept nor an error of acceptance. */
  'abstain',
  /** A non-exact relation the gold accepts. */
  'correct_reject',
  /** A non-exact relation the gold does not accept, on a non-exact gold. Not a false accept. */
  'wrong_relation',
  /** A non-exact relation on an exact gold: a true match turned away. */
  'false_reject',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * `plain`: the model's answer as given. `veto-only`: S§5.4 "a small local model may only veto,
 * never accept": its `exact` is ignored (read as an abstention) and only its rejections count.
 */
export type View = 'plain' | 'veto-only';

export function goldAccepts(gold: MatchExpected): readonly MatchRelation[] {
  return 'relation' in gold ? [gold.relation] : gold.oneOf;
}

export function goldIsExact(gold: MatchExpected): boolean {
  return 'relation' in gold && gold.relation === 'exact';
}

export function scoreRelation(
  gold: MatchExpected,
  relation: MatchRelation,
  view: View = 'plain',
): Outcome {
  const said = view === 'veto-only' && relation === 'exact' ? 'unknown' : relation;
  if (said === 'unknown') return 'abstain';
  if (said === 'exact') return goldIsExact(gold) ? 'true_accept' : 'false_accept';
  if (goldIsExact(gold)) return 'false_reject';
  return goldAccepts(gold).includes(said) ? 'correct_reject' : 'wrong_relation';
}

/** A ratio that keeps its parts. `value` is null when the denominator is zero: undefined, not 0. */
export interface Ratio {
  readonly num: number;
  readonly den: number;
  readonly value: number | null;
}

export function ratio(num: number, den: number): Ratio {
  return { num, den, value: den === 0 ? null : num / den };
}

export function formatRatio(r: Ratio, digits = 3): string {
  return `${r.num}/${r.den} = ${r.value === null ? 'undefined' : r.value.toFixed(digits)}`;
}
