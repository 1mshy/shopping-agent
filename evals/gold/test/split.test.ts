// SYNTHETIC test inputs only (see synthetic.ts).
import { describe, expect, it } from 'vitest';
import type { GoldProduct, SplitManifest } from '../lib/formats.ts';
import { hashString, seededRandom } from '../lib/seeded.ts';
import { assignSplit, pickRotation, retire, SplitRefusal } from '../lib/split.ts';
import { syntheticProduct, syntheticSet } from './synthetic.ts';

const sideOf = (m: SplitManifest) => new Map(m.assignments.map((a) => [a.productId, a.side]));
const heldBy = (m: SplitManifest, products: GoldProduct[], key: 'category' | 'country') => {
  const counts = new Map<string, number>();
  const side = sideOf(m);
  for (const p of products) {
    if (side.get(p.id) === 'held_out') counts.set(p[key], (counts.get(p[key]) ?? 0) + 1);
  }
  return counts;
};

describe('seeded generator', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = seededRandom('syn');
    const b = seededRandom('syn');
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRandom('other')()).not.toBe(xs[0]);
    expect(hashString('syn')).toBe(hashString('syn'));
  });
});

describe('assignSplit', () => {
  const { products } = syntheticSet();

  it('makes 40 dev and 20 held-out, stratified by category and country', () => {
    const { manifest } = assignSplit(products, undefined, 'syn-seed');
    const sides = [...sideOf(manifest).values()];
    expect(sides.filter((s) => s === 'dev')).toHaveLength(40);
    expect(sides.filter((s) => s === 'held_out')).toHaveLength(20);
    // CA has 24 synthetic products, US and DE 18 each: a third of each is held out.
    expect(Object.fromEntries(heldBy(manifest, products, 'country'))).toEqual({
      CA: 8,
      US: 6,
      DE: 6,
    });
    // Each of six categories has 10 products: 10/3 rounds to 3 or 4 held out.
    for (const n of heldBy(manifest, products, 'category').values()) expect([3, 4]).toContain(n);
    expect(manifest.seed).toBe('syn-seed');
    expect(manifest.toolVersion).toMatch(/^gold-tools\//);
  });

  it('is deterministic from the seed', () => {
    const a = assignSplit(products, undefined, 'syn-seed').manifest;
    expect(assignSplit(products, undefined, 'syn-seed').manifest).toEqual(a);
    expect(assignSplit(products, undefined, 'syn-other').manifest).not.toEqual(a);
  });

  it('never moves an assigned product when products are added', () => {
    const first = assignSplit(products.slice(0, 30), undefined, 'syn-seed').manifest;
    const second = assignSplit(products, first, 'syn-seed').manifest;
    const before = sideOf(first);
    const after = sideOf(second);
    for (const [id, side] of before) expect(after.get(id)).toBe(side);
    expect([...after.values()].filter((s) => s === 'held_out')).toHaveLength(20);
    // Running again with nothing new changes nothing.
    expect(assignSplit(products, second, 'syn-seed').manifest).toEqual(second);
  });

  it('rotates held-out products without reshuffling the rest', () => {
    const base = assignSplit(products, undefined, 'syn-seed').manifest;
    const out = pickRotation(base, 10);
    expect(out).toHaveLength(10);
    expect(pickRotation(base, 10)).toEqual(out);
    const rotated = retire(base, out, 'syn rotation');
    const fresh = Array.from({ length: 10 }, (_, i) =>
      syntheticProduct(100 + i, `syn-cat-${i % 6}`, 'US'),
    );
    const next = assignSplit([...products, ...fresh], rotated, 'syn-seed').manifest;
    const side = sideOf(next);
    for (const p of fresh) expect(side.get(p.id)).toBe('held_out');
    for (const [id, s] of sideOf(base)) expect(side.get(id)).toBe(s);
    const retired = next.assignments.filter((a) => a.retired);
    expect(retired.map((a) => a.productId).sort()).toEqual([...out].sort());
  });

  it('keeps the same real-world product on one side (GTIN or brand + MPN)', () => {
    const base = assignSplit(products, undefined, 'syn-seed').manifest;
    const dev = base.assignments.find((a) => a.side === 'dev');
    const original = products.find((p) => p.id === dev?.productId);
    if (!original) throw new Error('no dev product');
    // The same product in another market, with its MPN written differently.
    const twin: GoldProduct = {
      ...syntheticProduct(200, original.category, 'DE'),
      identity: { ...original.identity, mpn: original.identity.mpn?.toLowerCase() },
    };
    const res = assignSplit([...products, twin], base, 'syn-seed');
    expect(sideOf(res.manifest).get(twin.id)).toBe('dev');
    expect(res.forced).toEqual([{ productId: twin.id, side: 'dev', sameAs: [original.id] }]);
  });

  it('refuses an existing split that already leaks, and a different seed', () => {
    const base = assignSplit(products, undefined, 'syn-seed').manifest;
    expect(() => assignSplit(products, base, 'syn-other')).toThrow(SplitRefusal);
    const held = base.assignments.find((a) => a.side === 'held_out');
    const dev = products.find((p) => sideOf(base).get(p.id) === 'dev');
    if (!held || !dev) throw new Error('split incomplete');
    const leaky = products.map((p) =>
      p.id === held.productId ? { ...p, identity: { ...dev.identity } } : p,
    );
    expect(() => assignSplit(leaky, base, 'syn-seed')).toThrow(/both sides/);
  });
});
