// Double labelling (S§5.16 "10% double-labelled", plan P0 exit criteria "agreement reported"):
// a seeded, per-product pick of snapshots for a second, independent label, and the agreement
// report between the primary and second labels.
import { MATCH_RELATIONS, type MatchRelation } from '@agentic-dasher/shared';
import {
  type DoubleLabelWorklist,
  GOLD_TOOL_VERSION,
  type GoldSet,
  type RelationLabel,
} from './formats.ts';
import { DOUBLE_LABEL_MIN_SHARE } from './requirements.ts';
import { seededRank } from './seeded.ts';

export class AgreementRefusal extends Error {
  override name = 'AgreementRefusal';
}

/** ceil(count * rate), without float noise turning 0.1 * 30 into 4. */
export const quota = (count: number, rate: number) => Math.ceil(count * rate - 1e-9);

/**
 * Picks ceil(rate * snapshots) of every product, so the pick is stratified by product and through
 * it by category, country and split side. Each snapshot's rank is a hash of the seed and its own
 * id, so earlier picks are kept and adding snapshots only tops a product up. The worklist carries
 * what the second labeller needs (the product identity, the frozen listing) and no label.
 */
export function pickDoubleLabel(
  set: Pick<GoldSet, 'products' | 'snapshots'>,
  existing: DoubleLabelWorklist | undefined,
  seed: string,
  rate: number = DOUBLE_LABEL_MIN_SHARE,
): DoubleLabelWorklist {
  if (existing && existing.seed !== seed) {
    throw new Error(`the worklist was made with seed "${existing.seed}", not "${seed}"`);
  }
  const kept = new Set(existing?.items.map((i) => i.snapshotId));
  const items: DoubleLabelWorklist['items'] = [];
  for (const product of [...set.products].sort((a, b) => a.id.localeCompare(b.id))) {
    const own = set.snapshots
      .filter((s) => s.productId === product.id)
      .sort((a, b) => seededRank(seed, a.id) - seededRank(seed, b.id) || a.id.localeCompare(b.id));
    const chosen = own.filter((s) => kept.has(s.id));
    for (const s of own)
      if (chosen.length < quota(own.length, rate) && !kept.has(s.id)) chosen.push(s);
    for (const s of chosen.sort((a, b) => a.id.localeCompare(b.id))) {
      items.push({
        snapshotId: s.id,
        productId: product.id,
        identity: product.identity,
        listing: s.listing,
      });
    }
  }
  return { formatVersion: 1, seed, toolVersion: GOLD_TOOL_VERSION, rate, items };
}

export interface Kappa {
  n: number;
  /** p_o, raw agreement. */
  observed: number;
  /** p_e, chance agreement from the two labellers' marginals. */
  expected: number;
  /** (p_o - p_e) / (1 - p_e); null when p_e = 1, where kappa is 0/0 and undefined. */
  kappa: number | null;
  undefinedReason?: string;
}

/** Cohen's kappa for two labellers over paired categorical labels. Refuses n = 0. */
export function cohenKappa<T extends string>(pairs: readonly (readonly [T, T])[]): Kappa {
  const n = pairs.length;
  if (n === 0) throw new AgreementRefusal('no paired labels: agreement is undefined for n = 0');
  const a = new Map<T, number>();
  const b = new Map<T, number>();
  let agree = 0;
  for (const [x, y] of pairs) {
    if (x === y) agree++;
    a.set(x, (a.get(x) ?? 0) + 1);
    b.set(y, (b.get(y) ?? 0) + 1);
  }
  let expectedCount = 0;
  for (const [k, ca] of a) expectedCount += ca * (b.get(k) ?? 0);
  const observed = agree / n;
  const expected = expectedCount / (n * n);
  if (expectedCount === n * n) {
    return {
      n,
      observed,
      expected,
      kappa: null,
      undefinedReason: 'both labellers used one relation only',
    };
  }
  return { n, observed, expected, kappa: (observed - expected) / (1 - expected) };
}

export interface AgreementReport {
  n: number;
  /** Worklist items with a primary label but no second label yet. */
  missingSecond: number;
  relations: Kappa;
  /** Rows: primary label; columns: second label. */
  confusion: Record<MatchRelation, Record<MatchRelation, number>>;
  /** The question the precision gate asks (S§6): is the listing `exact` or not. */
  exactVsNot: Kappa;
}

export function agreementReport(
  labels: readonly RelationLabel[],
  worklist: DoubleLabelWorklist,
): AgreementReport {
  const byPass = (pass: RelationLabel['pass']) =>
    new Map(labels.filter((l) => l.pass === pass).map((l) => [l.snapshotId, l.relation]));
  const primary = byPass('primary');
  const second = byPass('second');
  const pairs: [MatchRelation, MatchRelation][] = [];
  let missingSecond = 0;
  for (const { snapshotId } of worklist.items) {
    const p = primary.get(snapshotId);
    const s = second.get(snapshotId);
    if (p && s) pairs.push([p, s]);
    else if (p) missingSecond++;
  }
  if (pairs.length === 0) {
    throw new AgreementRefusal('no worklist item has both a primary and a second label (n = 0)');
  }
  const row = () => Object.fromEntries(MATCH_RELATIONS.map((r) => [r, 0]));
  const confusion = Object.fromEntries(
    MATCH_RELATIONS.map((r) => [r, row()]),
  ) as AgreementReport['confusion'];
  for (const [p, s] of pairs) confusion[p][s]++;
  const binary = (r: MatchRelation) => (r === 'exact' ? 'exact' : 'not_exact');
  return {
    n: pairs.length,
    missingSecond,
    relations: cohenKappa(pairs),
    confusion,
    exactVsNot: cohenKappa(pairs.map(([p, s]) => [binary(p), binary(s)] as const)),
  };
}

const fmt = (k: Kappa) =>
  `n=${k.n} raw agreement=${k.observed.toFixed(3)} chance=${k.expected.toFixed(3)} kappa=${
    k.kappa === null ? `undefined (${k.undefinedReason})` : k.kappa.toFixed(3)
  }`;

export function formatAgreement(r: AgreementReport): string {
  const width = Math.max(...MATCH_RELATIONS.map((x) => x.length));
  const lines = [
    `seven relations: ${fmt(r.relations)}`,
    `exact vs not exact: ${fmt(r.exactVsNot)}`,
    `worklist items still missing a second label: ${r.missingSecond}`,
    '',
    `confusion (rows: primary, columns: second; order ${MATCH_RELATIONS.join(', ')})`,
  ];
  for (const p of MATCH_RELATIONS) {
    lines.push(
      `${p.padEnd(width)} ${MATCH_RELATIONS.map((s) => String(r.confusion[p][s]).padStart(4)).join('')}`,
    );
  }
  return lines.join('\n');
}
