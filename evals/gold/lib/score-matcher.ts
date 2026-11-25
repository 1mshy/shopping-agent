// Scoring the matcher's code tiers (S§5.4 tiers 1-2, packages/core) against a gold set's labels.
// Pure: the CLI (`score-matcher.ts`) reads the files of one split and hands the rows in here.
//
// Identity precision is the gate's question (S§6, plan P1 exit criteria): of the listings the
// matcher calls `exact`, the share whose gold label is `exact`. Recall is the share of gold
// `exact` listings the matcher calls `exact`. `unknown` is the code tiers declining to decide
// (the listing would go to the judge or stay "unconfirmed"), so it is counted, not scored.
import {
  attributeKey,
  type MatchAsked,
  type MatchListing,
  normaliseGtin,
} from '@agentic-dasher/core';
import { MATCH_RELATIONS, type MatchRelation } from '@agentic-dasher/shared';
import type { GoldProduct, ListingSnapshot, RelationLabel } from './formats.ts';

/** The asked side for a gold product: its identity in the SearchIntent shape the matcher reads. */
export function askedFor(product: GoldProduct): MatchAsked {
  const id = product.identity;
  const model = id.model ?? null;
  const startsWithBrand = model !== null && model.toLowerCase().startsWith(id.brand.toLowerCase());
  const name = model === null ? id.brand : startsWithBrand ? model : `${id.brand} ${model}`;
  return {
    name,
    brand: id.brand,
    model,
    mpn: id.mpn ?? null,
    gtin: id.gtin === undefined ? null : normaliseGtin(id.gtin),
    mustHave: Object.entries(id.mustHave).map(([attribute, value]) => ({
      attribute: attributeKey(attribute),
      value,
    })),
    packQuantity: id.packQuantity,
  };
}

/** The listing as a reader would hand it to the matcher (the snapshot's `context` is never read). */
export function listingFor(snapshot: ListingSnapshot): MatchListing {
  const l = snapshot.listing;
  return {
    title: l.title,
    brand: l.brand ?? null,
    mpn: l.mpn ?? l.model ?? null,
    gtin: l.gtin ?? null,
    variant: l.variantAttributes,
    url: snapshot.capture.url,
  };
}

/** The gold relation of each snapshot: an adjudicated label replaces the primary one. */
export function goldRelations(labels: readonly RelationLabel[]): Map<string, MatchRelation> {
  const primary = new Map<string, MatchRelation>();
  const adjudicated = new Map<string, MatchRelation>();
  for (const l of labels) {
    if (l.pass === 'primary') primary.set(l.snapshotId, l.relation);
    if (l.pass === 'adjudicated') adjudicated.set(l.snapshotId, l.relation);
  }
  return new Map([...primary, ...adjudicated]);
}

export interface ScoredRow {
  readonly snapshotId: string;
  readonly gold: MatchRelation;
  readonly predicted: MatchRelation;
}

export interface MatcherScore {
  /** Snapshots scored. */
  readonly n: number;
  /** Listings the matcher called exact, and how many of those are gold exact. */
  readonly predictedExact: number;
  readonly truePositives: number;
  /** Gold exact listings. */
  readonly goldExact: number;
  /** truePositives / predictedExact; null when nothing was called exact. */
  readonly precision: number | null;
  /** truePositives / goldExact; null when the split has no gold exact listing. */
  readonly recall: number | null;
  /** Listings left `unknown` by the code tiers. */
  readonly unknown: number;
  /** confusion[gold][predicted] = count, over MATCH_RELATIONS on both axes. */
  readonly confusion: Readonly<Record<MatchRelation, Readonly<Record<MatchRelation, number>>>>;
}

/** Precision and recall of `exact`, the confusion table, and the `unknown` count. */
export function scoreRows(rows: readonly ScoredRow[]): MatcherScore {
  const confusion = Object.fromEntries(
    MATCH_RELATIONS.map((g) => [g, Object.fromEntries(MATCH_RELATIONS.map((p) => [p, 0]))]),
  ) as Record<MatchRelation, Record<MatchRelation, number>>;
  let predictedExact = 0;
  let truePositives = 0;
  let goldExact = 0;
  let unknown = 0;
  for (const r of rows) {
    confusion[r.gold][r.predicted]++;
    if (r.predicted === 'exact') predictedExact++;
    if (r.gold === 'exact') goldExact++;
    if (r.predicted === 'exact' && r.gold === 'exact') truePositives++;
    if (r.predicted === 'unknown') unknown++;
  }
  return {
    n: rows.length,
    predictedExact,
    truePositives,
    goldExact,
    precision: predictedExact === 0 ? null : truePositives / predictedExact,
    recall: goldExact === 0 ? null : truePositives / goldExact,
    unknown,
    confusion,
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

/** The report as printed: every figure with the count it rests on. */
export function formatScore(score: MatcherScore, heading: string): string {
  const short: Record<MatchRelation, string> = {
    exact: 'exact',
    variant: 'variant',
    bundle: 'bundle',
    accessory_or_part: 'acc/part',
    other_model: 'oth_model',
    other_line: 'oth_line',
    unknown: 'unknown',
  };
  const w = 10;
  const lines = [
    heading,
    `snapshots scored: n = ${score.n}`,
    `identity precision (exact): ${pct(score.precision)} = ${score.truePositives} / ${score.predictedExact} called exact`,
    `recall (exact): ${pct(score.recall)} = ${score.truePositives} / ${score.goldExact} gold exact`,
    `left unknown: ${score.unknown} of ${score.n} (${pct(score.n === 0 ? null : score.unknown / score.n)})`,
    '',
    'confusion (rows gold, columns matcher):',
    [
      'gold \\ matcher'.padEnd(16),
      ...MATCH_RELATIONS.map((r) => short[r].padStart(w)),
      'total'.padStart(w),
    ].join(''),
  ];
  for (const g of MATCH_RELATIONS) {
    const row = score.confusion[g];
    const total = MATCH_RELATIONS.reduce((s, p) => s + row[p], 0);
    lines.push(
      [
        short[g].padEnd(16),
        ...MATCH_RELATIONS.map((p) => String(row[p]).padStart(w)),
        String(total).padStart(w),
      ].join(''),
    );
  }
  const colTotals = MATCH_RELATIONS.map((p) =>
    MATCH_RELATIONS.reduce((s, g) => s + score.confusion[g][p], 0),
  );
  lines.push(
    [
      'total'.padEnd(16),
      ...colTotals.map((t) => String(t).padStart(w)),
      String(score.n).padStart(w),
    ].join(''),
  );
  return lines.join('\n');
}
