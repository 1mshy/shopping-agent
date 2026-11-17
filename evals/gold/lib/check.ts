// Validation of a gold set: integrity violations (always fatal) and the set-level requirements of
// S§5.16, each reported with its count and n. In `progress` mode a requirement that is only short
// ("not enough yet") does not fail; in `strict` mode every requirement must be met.
import type { MatchRelation } from '@agentic-dasher/shared';
import { type GoldSet, type RelationLabel, SPLIT_SIDES } from './formats.ts';
import {
  CATEGORY_COUNT,
  COUNTRY_COUNT,
  DOUBLE_LABEL_MIN_SHARE,
  HARD_NEGATIVE_MIN_SHARE,
  isHardNegative,
  LABELLED_SNAPSHOTS,
  PRODUCTS_MIN,
  REQUIRED_COUNTRIES,
  SNAPSHOTS_PER_PRODUCT,
  SPLIT_TARGETS,
} from './requirements.ts';
import { findLeakage } from './split.ts';

export type CheckMode = 'strict' | 'progress';
/** `short`: adding products, snapshots or labels can still meet it. `violated`: it cannot. */
export type RequirementStatus = 'met' | 'short' | 'violated';

export interface RequirementResult {
  id: string;
  target: string;
  cite: string;
  count: number;
  n?: number;
  detail?: string;
  status: RequirementStatus;
}

export interface CheckReport {
  ok: boolean;
  mode: CheckMode;
  violations: string[];
  requirements: RequirementResult[];
}

/** The relation of record: an adjudicated label if there is one, else the primary label. */
export function goldRelation(labels: readonly RelationLabel[]): MatchRelation | undefined {
  return (labels.find((l) => l.pass === 'adjudicated') ?? labels.find((l) => l.pass === 'primary'))
    ?.relation;
}

const tally = (xs: readonly string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
const dupes = (xs: readonly string[]) => [...tally(xs)].filter(([, c]) => c > 1).map(([x]) => x);
const share = (count: number, n: number) => (n === 0 ? 0 : count / n);
const atLeast = (count: number, min: number): RequirementStatus => (count >= min ? 'met' : 'short');

export function checkSet(set: GoldSet, mode: CheckMode): CheckReport {
  const v: string[] = [];
  const products = new Map(set.products.map((p) => [p.id, p]));
  const snapshots = new Map(set.snapshots.map((s) => [s.id, s]));
  for (const id of dupes(set.products.map((p) => p.id))) v.push(`duplicate product id ${id}`);
  for (const id of dupes(set.snapshots.map((s) => s.id))) v.push(`duplicate snapshot id ${id}`);
  for (const s of set.snapshots) {
    const p = products.get(s.productId);
    if (!p) v.push(`snapshot ${s.id} names unknown product ${s.productId}`);
    else if (p.country !== s.capture.country) {
      v.push(`snapshot ${s.id} was captured in ${s.capture.country}, its product is ${p.country}`);
    }
  }

  const labelsOf = new Map<string, RelationLabel[]>();
  for (const l of set.labels) {
    if (!snapshots.has(l.snapshotId))
      v.push(`label by ${l.labellerId} names unknown snapshot ${l.snapshotId}`);
    labelsOf.set(l.snapshotId, [...(labelsOf.get(l.snapshotId) ?? []), l]);
  }
  const onWorklist = new Set(set.worklist?.items.map((i) => i.snapshotId));
  for (const [id, ls] of labelsOf) {
    for (const pass of dupes(ls.map((l) => l.pass)))
      v.push(`snapshot ${id} has more than one ${pass} label`);
    const primary = ls.find((l) => l.pass === 'primary');
    const second = ls.find((l) => l.pass === 'second');
    if (second && primary?.labellerId === second.labellerId) {
      v.push(`second label of ${id} is by its primary labeller ${second.labellerId}`);
    }
    if (second && !onWorklist.has(id)) v.push(`second label of ${id} is not on the worklist`);
    if (!primary && ls.some((l) => l.pass !== 'primary'))
      v.push(`snapshot ${id} has no primary label`);
  }

  if (set.split) {
    for (const id of dupes(set.split.assignments.map((a) => a.productId)))
      v.push(`split lists ${id} twice`);
    for (const a of set.split.assignments) {
      if (!products.has(a.productId)) v.push(`split names unknown product ${a.productId}`);
    }
    v.push(...findLeakage(set.products, set.split));
  }
  for (const item of set.worklist?.items ?? []) {
    const s = snapshots.get(item.snapshotId);
    if (!s) v.push(`worklist names unknown snapshot ${item.snapshotId}`);
    else if (
      s.productId !== item.productId ||
      JSON.stringify(s.listing) !== JSON.stringify(item.listing)
    ) {
      v.push(`worklist copy of ${item.snapshotId} is stale: re-run the pick`);
    }
  }

  // Set-level requirements, over active products (retired ones are no longer measured).
  const retired = new Set(set.split?.assignments.filter((a) => a.retired).map((a) => a.productId));
  const active = set.products.filter((p) => !retired.has(p.id));
  const activeIds = new Set(active.map((p) => p.id));
  const activeSnaps = set.snapshots.filter((s) => activeIds.has(s.productId));
  const gold = activeSnaps.flatMap((s) => {
    const r = goldRelation(labelsOf.get(s.id) ?? []);
    return r ? [{ s, r }] : [];
  });
  const perProduct = tally(activeSnaps.map((s) => s.productId));
  const sizes = active.map((p) => perProduct.get(p.id) ?? 0);
  const categories = tally(active.map((p) => p.category));
  const countries = new Set(active.map((p) => p.country));
  const missingCountries = REQUIRED_COUNTRIES.filter((c) => !countries.has(c));
  const side = new Map(set.split?.assignments.map((a) => [a.productId, a.side]));
  const onSide = (s: string) => active.filter((p) => side.get(p.id) === s).length;
  const hard = gold.filter((g) => isHardNegative(g.r)).length;
  const hardBySide = set.split
    ? SPLIT_SIDES.map((s) => {
        const g = gold.filter((x) => side.get(x.s.productId) === s);
        return `${s} ${g.filter((x) => isHardNegative(x.r)).length} of ${g.length}`;
      })
    : [];
  const doubled = activeSnaps.filter((s) =>
    labelsOf.get(s.id)?.some((l) => l.pass === 'second'),
  ).length;
  const { min, max } = SNAPSHOTS_PER_PRODUCT;
  const req: RequirementResult[] = [
    {
      id: 'products',
      target: `>= ${PRODUCTS_MIN}`,
      cite: 'S§5.16',
      count: active.length,
      status: atLeast(active.length, PRODUCTS_MIN),
    },
    {
      id: 'snapshots_per_product',
      target: `${min}-${max} each`,
      cite: 'S§5.16',
      count: sizes.filter((k) => k >= min && k <= max).length,
      n: active.length,
      detail: active.length ? `min ${Math.min(...sizes)}, max ${Math.max(...sizes)}` : undefined,
      status: sizes.some((k) => k > max)
        ? 'violated'
        : sizes.some((k) => k < min)
          ? 'short'
          : 'met',
    },
    {
      id: 'labels',
      target: `${LABELLED_SNAPSHOTS.min}-${LABELLED_SNAPSHOTS.max} labelled snapshots`,
      cite: 'S§5.16',
      count: gold.length,
      status:
        gold.length > LABELLED_SNAPSHOTS.max
          ? 'violated'
          : atLeast(gold.length, LABELLED_SNAPSHOTS.min),
    },
    {
      id: 'all_labelled',
      target: 'every snapshot',
      cite: 'S§5.16',
      count: gold.length,
      n: activeSnaps.length,
      status: atLeast(gold.length, activeSnaps.length),
    },
    {
      id: 'categories',
      target: `${CATEGORY_COUNT}`,
      cite: 'S§5.16',
      count: categories.size,
      detail: [...categories]
        .sort()
        .map(([c, k]) => `${c} ${k}`)
        .join(', '),
      status:
        categories.size > CATEGORY_COUNT ? 'violated' : atLeast(categories.size, CATEGORY_COUNT),
    },
    {
      id: 'countries',
      target: `${COUNTRY_COUNT} incl. ${REQUIRED_COUNTRIES.join(', ')}`,
      cite: 'plan P0 workstream 4',
      count: countries.size,
      detail: [...countries].sort().join(', '),
      status:
        countries.size + missingCountries.length > COUNTRY_COUNT
          ? 'violated'
          : atLeast(countries.size, COUNTRY_COUNT),
    },
    {
      id: 'hard_negatives',
      target: `>= ${HARD_NEGATIVE_MIN_SHARE * 100}% of labelled snapshots`,
      cite: 'S§5.16',
      count: hard,
      n: gold.length,
      // Per side too: held-out numbers are what count (plan, "Gates are measured").
      detail: [`${(share(hard, gold.length) * 100).toFixed(1)}%`, ...hardBySide].join('; '),
      status:
        gold.length > 0 && share(hard, gold.length) >= HARD_NEGATIVE_MIN_SHARE ? 'met' : 'short',
    },
    {
      id: 'split_assigned',
      target: 'every product',
      cite: 'S§5.16',
      count: active.filter((p) => side.has(p.id)).length,
      n: active.length,
      status: atLeast(active.filter((p) => side.has(p.id)).length, active.length),
    },
    {
      id: 'split_dev',
      target: `>= ${SPLIT_TARGETS.dev}`,
      cite: 'S§5.16',
      count: onSide('dev'),
      status: atLeast(onSide('dev'), SPLIT_TARGETS.dev),
    },
    {
      id: 'split_held_out',
      target: `>= ${SPLIT_TARGETS.held_out}`,
      cite: 'S§5.16',
      count: onSide('held_out'),
      status: atLeast(onSide('held_out'), SPLIT_TARGETS.held_out),
    },
    {
      id: 'double_labelled',
      target: `>= ${DOUBLE_LABEL_MIN_SHARE * 100}% of labelled snapshots`,
      cite: 'S§5.16, plan P0 exit criteria',
      count: doubled,
      n: gold.length,
      detail: `${(share(doubled, gold.length) * 100).toFixed(1)}%`,
      status:
        gold.length > 0 && share(doubled, gold.length) >= DOUBLE_LABEL_MIN_SHARE ? 'met' : 'short',
    },
  ];
  const fails = (r: RequirementResult) =>
    r.status === 'violated' || (r.status === 'short' && mode === 'strict');
  return { ok: v.length === 0 && !req.some(fails), mode, violations: v, requirements: req };
}

export function formatReport(r: CheckReport): string {
  const lines = [`gold set check (${r.mode}): ${r.ok ? 'OK' : 'FAILED'}`, '', 'requirements:'];
  for (const q of r.requirements) {
    const n = q.n === undefined ? '' : ` of ${q.n}`;
    const detail = q.detail ? ` (${q.detail})` : '';
    lines.push(`  [${q.status}] ${q.id}: ${q.count}${n}${detail}; target ${q.target} [${q.cite}]`);
  }
  lines.push('', `violations: ${r.violations.length}`, ...r.violations.map((x) => `  - ${x}`));
  return lines.join('\n');
}
