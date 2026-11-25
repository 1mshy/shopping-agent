// The verdict cache (S§4.1 `match_verdict`, S§5.4): rows keyed on spec fingerprint, listing
// fingerprint, matcher version, prompt version and model id (plus who decided, as the table's
// unique index has it). A person's override takes precedence over every other verdict.
import { MatchVerdict } from '@agentic-dasher/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from './open.ts';
import { matchVerdict } from './schema/catalogue.ts';

/** The versions a fresh verdict would be keyed on now. */
export interface VerdictVersions {
  readonly matcherVersion: string;
  /** The judge's prompt version and model id; null when no model is configured. */
  readonly promptVersion: string | null;
  readonly modelId: string | null;
}

type Row = typeof matchVerdict.$inferSelect;

function toVerdict(r: Row): MatchVerdict {
  return MatchVerdict.parse({
    specFp: r.specFp,
    listingFp: r.listingFp,
    relation: r.relation,
    differingAttrs: r.differingAttrs,
    decidedBy: r.decidedBy,
    matcherVersion: r.matcherVersion,
    promptVersion: r.promptVersion,
    modelId: r.modelId,
    decidedAt: r.decidedAt,
  });
}

/**
 * Writes one verdict, replacing the one under the same cache key and decider (a re-decision, or
 * a person changing their mind). The verdict is checked against the contract first.
 */
export function writeVerdict(db: Database, verdict: MatchVerdict): void {
  const v = MatchVerdict.parse(verdict);
  db.orm.transaction((tx) => {
    tx.delete(matchVerdict)
      .where(
        and(
          eq(matchVerdict.specFp, v.specFp),
          eq(matchVerdict.listingFp, v.listingFp),
          eq(matchVerdict.matcherVersion, v.matcherVersion),
          sql`coalesce(${matchVerdict.promptVersion}, '') = ${v.promptVersion ?? ''}`,
          sql`coalesce(${matchVerdict.modelId}, '') = ${v.modelId ?? ''}`,
          eq(matchVerdict.decidedBy, v.decidedBy),
        ),
      )
      .run();
    tx.insert(matchVerdict).values(v).run();
  });
}

/** Every cached verdict for one spec and listing, newest first. */
export function readVerdicts(db: Database, specFp: string, listingFp: string): MatchVerdict[] {
  return db.orm
    .select()
    .from(matchVerdict)
    .where(and(eq(matchVerdict.specFp, specFp), eq(matchVerdict.listingFp, listingFp)))
    .orderBy(desc(matchVerdict.decidedAt), desc(matchVerdict.id))
    .all()
    .map(toVerdict);
}

/**
 * The verdict that holds for one spec and listing:
 * 1. the latest person override, whatever matcher, prompt or model it was made under;
 * 2. else the verdicts under the current key (the matcher version; for a model verdict also
 *    the prompt version and model id): a decided one (not `unknown`) before an undecided one,
 *    identifier before rules before model, then the latest;
 * 3. null when none holds, and the listing is matched afresh.
 * The same precedence as packages/core `effectiveVerdict`, read straight from the table.
 */
export function readEffectiveVerdict(
  db: Database,
  specFp: string,
  listingFp: string,
  now: VerdictVersions,
): MatchVerdict | null {
  const pair = and(eq(matchVerdict.specFp, specFp), eq(matchVerdict.listingFp, listingFp));
  const person = db.orm
    .select()
    .from(matchVerdict)
    .where(and(pair, eq(matchVerdict.decidedBy, 'person')))
    .orderBy(desc(matchVerdict.decidedAt), desc(matchVerdict.id))
    .limit(1)
    .get();
  if (person) return toVerdict(person);
  const model =
    now.promptVersion !== null && now.modelId !== null
      ? and(
          eq(matchVerdict.decidedBy, 'model'),
          eq(matchVerdict.promptVersion, now.promptVersion),
          eq(matchVerdict.modelId, now.modelId),
        )
      : sql`0`;
  const code = and(
    sql`${matchVerdict.decidedBy} in ('identifier', 'rules')`,
    isNull(matchVerdict.promptVersion),
    isNull(matchVerdict.modelId),
  );
  const row = db.orm
    .select()
    .from(matchVerdict)
    .where(
      and(pair, eq(matchVerdict.matcherVersion, now.matcherVersion), sql`(${code} or ${model})`),
    )
    .orderBy(
      asc(sql`case when ${matchVerdict.relation} = 'unknown' then 1 else 0 end`),
      asc(
        sql`case ${matchVerdict.decidedBy} when 'identifier' then 0 when 'rules' then 1 else 2 end`,
      ),
      desc(matchVerdict.decidedAt),
      desc(matchVerdict.id),
    )
    .limit(1)
    .get();
  return row ? toVerdict(row) : null;
}
