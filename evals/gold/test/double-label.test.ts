// SYNTHETIC test inputs only (see synthetic.ts). Every agreement figure below is computed on
// invented labels to check the arithmetic; none is a measurement of labeller agreement.
import type { MatchRelation } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  AgreementRefusal,
  agreementReport,
  cohenKappa,
  pickDoubleLabel,
} from '../lib/double-label.ts';
import type { RelationLabel } from '../lib/formats.ts';
import { syntheticLabel, syntheticSet, syntheticSnapshot } from './synthetic.ts';

type Pair = readonly [MatchRelation, MatchRelation];
const rep = (pair: Pair, times: number): Pair[] => Array.from({ length: times }, () => pair);

describe('cohenKappa (hand-derived examples)', () => {
  it('two relations, symmetric disagreement', () => {
    // n = 10: (exact, exact) x4, (exact, variant) x1, (variant, exact) x1, (variant, variant) x4.
    // p_o = 8/10 = 0.8. Marginals A: exact 5, variant 5; B: exact 5, variant 5.
    // p_e = 0.5*0.5 + 0.5*0.5 = 0.5. kappa = (0.8 - 0.5) / (1 - 0.5) = 0.6.
    const pairs = [
      ...rep(['exact', 'exact'], 4),
      ...rep(['exact', 'variant'], 1),
      ...rep(['variant', 'exact'], 1),
      ...rep(['variant', 'variant'], 4),
    ];
    const k = cohenKappa(pairs);
    expect(k.n).toBe(10);
    expect(k.observed).toBeCloseTo(0.8, 12);
    expect(k.expected).toBeCloseTo(0.5, 12);
    expect(k.kappa).toBeCloseTo(0.6, 12);
  });

  it('two relations, unequal marginals', () => {
    // n = 50: (exact, exact) 20, (exact, other_model) 5, (other_model, exact) 10,
    // (other_model, other_model) 15. p_o = 35/50 = 0.7.
    // A: exact 25, other_model 25 -> 0.5, 0.5. B: exact 30, other_model 20 -> 0.6, 0.4.
    // p_e = 0.5*0.6 + 0.5*0.4 = 0.5. kappa = (0.7 - 0.5) / 0.5 = 0.4.
    const pairs = [
      ...rep(['exact', 'exact'], 20),
      ...rep(['exact', 'other_model'], 5),
      ...rep(['other_model', 'exact'], 10),
      ...rep(['other_model', 'other_model'], 15),
    ];
    expect(cohenKappa(pairs).kappa).toBeCloseTo(0.4, 12);
  });

  it('three relations', () => {
    // n = 6: (exact, exact) x2, (variant, variant), (bundle, bundle), (variant, bundle),
    // (bundle, exact). p_o = 4/6. A: exact 2, variant 2, bundle 2. B: exact 3, variant 1, bundle 2.
    // p_e = (2*3 + 2*1 + 2*2) / 36 = 12/36 = 1/3. kappa = (2/3 - 1/3) / (1 - 1/3) = 0.5.
    const pairs: Pair[] = [
      ['exact', 'exact'],
      ['exact', 'exact'],
      ['variant', 'variant'],
      ['bundle', 'bundle'],
      ['variant', 'bundle'],
      ['bundle', 'exact'],
    ];
    expect(cohenKappa(pairs).kappa).toBeCloseTo(0.5, 12);
  });

  it('complete disagreement and chance-level agreement', () => {
    // (exact, variant), (variant, exact): p_o = 0, p_e = 0.5*0.5 + 0.5*0.5 = 0.5, kappa = -1.
    expect(
      cohenKappa([
        ['exact', 'variant'],
        ['variant', 'exact'],
      ]).kappa,
    ).toBeCloseTo(-1, 12);
    // A always exact; B exact twice, variant twice. p_o = 2/4 = 0.5.
    // p_e = 1.0*0.5 (exact) + 0*0.5 (variant) = 0.5. kappa = 0 / 0.5 = 0.
    const chance = cohenKappa([...rep(['exact', 'exact'], 2), ...rep(['exact', 'variant'], 2)]);
    expect(chance.kappa).toBeCloseTo(0, 12);
  });

  it('is undefined, not 1.0 or NaN, when both labellers used one relation only', () => {
    // p_o = 1 and p_e = 1*1 = 1: (1 - 1) / (1 - 1) is 0/0.
    const k = cohenKappa(rep(['exact', 'exact'], 5));
    expect(k.observed).toBe(1);
    expect(k.kappa).toBeNull();
    expect(k.undefinedReason).toMatch(/one relation/);
  });

  it('refuses n = 0', () => {
    expect(() => cohenKappa([])).toThrow(AgreementRefusal);
  });
});

describe('pickDoubleLabel', () => {
  const set = syntheticSet({ products: 12, snapshotsPerProduct: 17 });

  it('picks at least 10% of every product, deterministically', () => {
    const w = pickDoubleLabel(set, undefined, 'syn-seed');
    // ceil(0.1 * 17) = 2 per product, 24 of 204.
    expect(w.items).toHaveLength(24);
    const perProduct = new Map<string, number>();
    for (const it of w.items) perProduct.set(it.productId, (perProduct.get(it.productId) ?? 0) + 1);
    expect([...perProduct.values()]).toEqual(Array(12).fill(2));
    expect(pickDoubleLabel(set, undefined, 'syn-seed')).toEqual(w);
    expect(pickDoubleLabel(set, undefined, 'syn-other')).not.toEqual(w);
  });

  it('keeps earlier picks when snapshots are added', () => {
    const first = pickDoubleLabel(set, undefined, 'syn-seed');
    const p0 = set.products[0];
    if (!p0) throw new Error('empty');
    const more = {
      ...set,
      snapshots: [...set.snapshots, ...[20, 21, 22, 23].map((j) => syntheticSnapshot(p0, j))],
    };
    const second = pickDoubleLabel(more, first, 'syn-seed');
    const ids = new Set(second.items.map((i) => i.snapshotId));
    for (const it of first.items) expect(ids.has(it.snapshotId)).toBe(true);
    // p0 now has 21 snapshots: ceil(2.1) = 3.
    expect(second.items.filter((i) => i.productId === p0.id)).toHaveLength(3);
  });

  it('does not reveal the first label', () => {
    const w = JSON.stringify(pickDoubleLabel(set, undefined, 'syn-seed'));
    expect(w).not.toMatch(/relation|labeller|"pass"/);
  });
});

describe('agreementReport', () => {
  const set = syntheticSet({ products: 4, snapshotsPerProduct: 15 });
  const worklist = pickDoubleLabel(set, undefined, 'syn-seed');
  const primary = new Map(set.labels.map((l) => [l.snapshotId, l.relation]));

  it('reports n, raw agreement, kappa, the confusion matrix and the exact/not-exact question', () => {
    // Second labeller agrees everywhere except one item, where it says exact for a non-exact one.
    const items = worklist.items;
    const [firstItem] = items;
    if (!firstItem) throw new Error('empty worklist');
    const second: RelationLabel[] = items.map((it, i) =>
      syntheticLabel(
        it.snapshotId,
        i === 0
          ? primary.get(it.snapshotId) === 'exact'
            ? 'variant'
            : 'exact'
          : (primary.get(it.snapshotId) ?? 'unknown'),
        'syn-b',
        'second',
      ),
    );
    const r = agreementReport([...set.labels, ...second], worklist);
    expect(r.n).toBe(items.length);
    expect(r.relations.observed).toBeCloseTo((items.length - 1) / items.length, 12);
    const firstPrimary = primary.get(firstItem.snapshotId) ?? 'unknown';
    const firstSecond = firstPrimary === 'exact' ? 'variant' : 'exact';
    expect(r.confusion[firstPrimary][firstSecond]).toBe(1);
    const diagonal = Object.entries(r.confusion).reduce(
      (s, [k, row]) => s + row[k as MatchRelation],
      0,
    );
    expect(diagonal).toBe(items.length - 1);
    expect(r.exactVsNot.observed).toBeCloseTo((items.length - 1) / items.length, 12);
    expect(r.missingSecond).toBe(0);
  });

  it('refuses when no worklist item has both labels', () => {
    expect(() => agreementReport(set.labels, worklist)).toThrow(AgreementRefusal);
  });
});
