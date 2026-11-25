// Which cached verdict holds for a listing (S§4.1 `match_verdict`: "person overrides take
// precedence"; S§5.4 verdict cache). Pure: the caller reads the rows, this picks one.
import type { DecidedBy, MatchVerdict } from '@agentic-dasher/shared';

/** What the matcher would key a fresh verdict on now. */
export interface CurrentVersions {
  readonly matcherVersion: string;
  /** The judge's prompt version and model id now; null when no model is configured. */
  readonly promptVersion: string | null;
  readonly modelId: string | null;
}

/** Order among the verdicts of code and model, when no person has spoken (earlier is stronger). */
const RANK: Readonly<Record<Exclude<DecidedBy, 'person'>, number>> = {
  identifier: 0,
  rules: 1,
  model: 2,
};

/** Timestamps have one fixed width (S§4), so text order is time order. */
const later = (a: MatchVerdict, b: MatchVerdict): MatchVerdict =>
  b.decidedAt > a.decidedAt ? b : a;

/** A verdict made under the versions in use now (a person's word has no version to expire). */
export function isCurrent(v: MatchVerdict, now: CurrentVersions): boolean {
  if (v.decidedBy === 'person') return true;
  // The cache key holds all three (S§5.4); a model verdict also needs its prompt and model.
  if (v.matcherVersion !== now.matcherVersion) return false;
  return (
    v.decidedBy !== 'model' || (v.promptVersion === now.promptVersion && v.modelId === now.modelId)
  );
}

/**
 * The verdict that holds among the cached ones for one spec and listing:
 * 1. a person's override beats every other verdict, whatever its version; the latest one wins;
 * 2. otherwise only verdicts made under the current matcher (or prompt and model) count, a
 *    decided one (not `unknown`) before an undecided one, then identifier before rules before
 *    model, then the latest;
 * 3. null when none holds (the listing is matched afresh).
 */
export function effectiveVerdict(
  verdicts: readonly MatchVerdict[],
  now: CurrentVersions,
): MatchVerdict | null {
  let person: MatchVerdict | null = null;
  for (const v of verdicts) if (v.decidedBy === 'person') person = person ? later(person, v) : v;
  if (person) return person;
  let best: MatchVerdict | null = null;
  const score = (v: MatchVerdict) =>
    (v.relation === 'unknown' ? 10 : 0) + RANK[v.decidedBy as Exclude<DecidedBy, 'person'>];
  for (const v of verdicts) {
    if (!isCurrent(v, now)) continue;
    if (best === null || score(v) < score(best)) best = v;
    else if (score(v) === score(best)) best = later(best, v);
  }
  return best;
}
