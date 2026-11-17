// SYNTHETIC test inputs only (see synthetic.ts). The counts asserted here describe invented sets.
import { describe, expect, it } from 'vitest';
import { type CheckReport, checkSet, formatReport } from '../lib/check.ts';
import { pickDoubleLabel } from '../lib/double-label.ts';
import type { GoldSet } from '../lib/formats.ts';
import { HARD_NEGATIVE_RELATIONS, isHardNegative } from '../lib/requirements.ts';
import { assignSplit } from '../lib/split.ts';
import { syntheticLabel, syntheticSet, syntheticSnapshot } from './synthetic.ts';

/** A synthetic set with every requirement met: split, worklist and second labels in place. */
function completeSet(opts: Parameters<typeof syntheticSet>[0] = {}): GoldSet {
  const set = syntheticSet({ snapshotsPerProduct: 17, ...opts });
  const split = assignSplit(set.products, undefined, 'syn-seed').manifest;
  const worklist = pickDoubleLabel(set, undefined, 'syn-seed');
  const second = worklist.items.map((it) =>
    syntheticLabel(it.snapshotId, 'exact', 'syn-b', 'second'),
  );
  return { ...set, split, worklist, labels: [...set.labels, ...second] };
}

const req = (r: CheckReport, id: string) => {
  const found = r.requirements.find((x) => x.id === id);
  if (!found) throw new Error(`no requirement ${id}`);
  return found;
};

describe('hard negative', () => {
  it('is a non-exact listing of the same brand and line (proposed definition)', () => {
    expect([...HARD_NEGATIVE_RELATIONS]).toEqual([
      'variant',
      'bundle',
      'accessory_or_part',
      'other_model',
    ]);
    for (const r of ['exact', 'other_line', 'unknown'] as const)
      expect(isHardNegative(r)).toBe(false);
  });
});

describe('checkSet', () => {
  it('passes a complete synthetic set in strict mode and reports counts with n', () => {
    const r = checkSet(completeSet(), 'strict');
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(req(r, 'products')).toMatchObject({ status: 'met', count: 60 });
    expect(req(r, 'labels')).toMatchObject({ status: 'met', count: 1020 });
    expect(req(r, 'categories')).toMatchObject({ status: 'met', count: 6 });
    expect(req(r, 'countries')).toMatchObject({ status: 'met', count: 3 });
    // 10 of 17 per product: 6 in the first cycle of 10, then 4 of the next 7.
    expect(req(r, 'hard_negatives')).toMatchObject({ status: 'met', count: 600, n: 1020 });
    expect(req(r, 'hard_negatives').detail).toBe('58.8%; dev 400 of 680; held_out 200 of 340');
    expect(req(r, 'split_dev')).toMatchObject({ status: 'met', count: 40 });
    expect(req(r, 'split_held_out')).toMatchObject({ status: 'met', count: 20 });
    // ceil(10% of 17) = 2 per product, 120 of 1020.
    expect(req(r, 'double_labelled')).toMatchObject({ status: 'met', count: 120, n: 1020 });
    expect(formatReport(r)).toContain('hard_negatives');
  });

  it('reports a set still being built as progress, and fails it in strict mode', () => {
    const partial = syntheticSet({ products: 10, snapshotsPerProduct: 15 });
    partial.labels = partial.labels.slice(0, 40);
    const progress = checkSet(partial, 'progress');
    expect(progress.ok).toBe(true);
    expect(req(progress, 'products')).toMatchObject({ status: 'short', count: 10 });
    expect(req(progress, 'all_labelled')).toMatchObject({ status: 'short', count: 40, n: 150 });
    expect(checkSet(partial, 'strict').ok).toBe(false);
  });

  it('fails too few hard negatives in strict mode, with the count and n', () => {
    const r = checkSet(completeSet({ relationCycle: ['exact', 'exact', 'variant'] }), 'strict');
    expect(r.ok).toBe(false);
    // Positions 2, 5, 8, 11, 14 of 17 are variant: 5 per product.
    expect(req(r, 'hard_negatives')).toMatchObject({ status: 'short', count: 300, n: 1020 });
  });

  it('fails what adding cannot fix even in progress mode', () => {
    const tooMany = syntheticSet({ products: 2, snapshotsPerProduct: 26 });
    const r = checkSet(tooMany, 'progress');
    expect(r.ok).toBe(false);
    expect(req(r, 'snapshots_per_product').status).toBe('violated');
    const seven = checkSet(syntheticSet({ products: 7, categories: 7 }), 'progress');
    expect(req(seven, 'categories').status).toBe('violated');
    expect(seven.ok).toBe(false);
  });

  it('reports referential and uniqueness violations', () => {
    const set = completeSet();
    const [p0] = set.products;
    if (!p0) throw new Error('empty');
    const orphan = { ...syntheticSnapshot(p0, 99), productId: 'syn-missing' };
    set.products.push(p0);
    set.snapshots.push(orphan, syntheticSnapshot(p0, 0));
    set.labels.push(syntheticLabel('syn-nowhere', 'exact'));
    const v = checkSet(set, 'progress').violations.join('\n');
    expect(v).toContain('duplicate product id syn-p000');
    expect(v).toContain('duplicate snapshot id syn-p000-s00');
    expect(v).toContain('unknown product syn-missing');
    expect(v).toContain('unknown snapshot syn-nowhere');
  });

  it('keeps the second pass independent and on the worklist', () => {
    const set = completeSet();
    const item = set.worklist?.items[0];
    if (!item) throw new Error('no worklist');
    set.labels = set.labels.filter(
      (l) => !(l.pass === 'second' && l.snapshotId === item.snapshotId),
    );
    set.labels.push(syntheticLabel(item.snapshotId, 'exact', 'syn-a', 'second'));
    const offList = set.snapshots.find(
      (s) => !set.worklist?.items.some((i) => i.snapshotId === s.id),
    );
    if (!offList) throw new Error('all on worklist');
    set.labels.push(syntheticLabel(offList.id, 'exact', 'syn-b', 'second'));
    const v = checkSet(set, 'progress').violations.join('\n');
    expect(v).toContain(`second label of ${item.snapshotId} is by its primary labeller`);
    expect(v).toContain(`second label of ${offList.id} is not on the worklist`);
  });

  it('reports a product whose identity sits on both sides of the split', () => {
    const set = completeSet();
    const split = set.split;
    if (!split) throw new Error('no split');
    const dev = split.assignments.find((a) => a.side === 'dev');
    const held = split.assignments.find((a) => a.side === 'held_out');
    const twin = set.products.find((p) => p.id === held?.productId);
    const original = set.products.find((p) => p.id === dev?.productId);
    if (!twin || !original) throw new Error('split incomplete');
    twin.identity = {
      ...twin.identity,
      brand: original.identity.brand,
      mpn: original.identity.mpn,
    };
    const v = checkSet(set, 'progress').violations.join('\n');
    expect(v).toMatch(/leak/);
  });

  it('needs CA and US among exactly three countries', () => {
    const two = checkSet(completeSet({ countries: ['US', 'DE'] }), 'progress');
    expect(req(two, 'countries')).toMatchObject({ status: 'short', count: 2 });
    // Three countries without CA: adding CA would make four, so this cannot be fixed by adding.
    const noCa = checkSet(completeSet({ countries: ['US', 'DE', 'FR'] }), 'progress');
    expect(req(noCa, 'countries').status).toBe('violated');
  });
});
