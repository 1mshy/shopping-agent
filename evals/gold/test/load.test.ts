// SYNTHETIC test inputs only (see synthetic.ts), written to a temporary directory.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSet, writeSet } from '../lib/load.ts';
import { syntheticLabel, syntheticSet } from './synthetic.ts';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadSet', () => {
  it('reads back what writeSet wrote, in the documented layout', () => {
    dir = mkdtempSync(join(tmpdir(), 'gold-syn-'));
    const set = syntheticSet({ products: 3, snapshotsPerProduct: 15 });
    writeSet(dir, set);
    const loaded = loadSet(dir);
    expect(loaded.violations).toEqual([]);
    expect(loaded.set.products).toEqual(set.products);
    expect(loaded.set.snapshots).toHaveLength(45);
    expect(loaded.set.labels).toHaveLength(45);
    expect(loaded.set.split).toBeUndefined();
  });

  it('turns schema errors and misfiled labels into violations naming the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'gold-syn-'));
    writeSet(dir, syntheticSet({ products: 1, snapshotsPerProduct: 15 }));
    writeFileSync(join(dir, 'snapshots', 'syn-p000.json'), '[{"id": 1}]');
    writeFileSync(
      join(dir, 'labels', 'syn-z.json'),
      JSON.stringify([syntheticLabel('syn-p000-s00', 'exact', 'syn-a')]),
    );
    const { violations } = loadSet(dir);
    expect(violations.join('\n')).toMatch(/snapshots\/syn-p000\.json/);
    expect(violations.join('\n')).toMatch(/labels\/syn-z\.json.*syn-a/);
  });

  it('drops only the bad entry of a file, not the whole file', () => {
    dir = mkdtempSync(join(tmpdir(), 'gold-syn-'));
    writeSet(dir, syntheticSet({ products: 1, snapshotsPerProduct: 15 }));
    const good = syntheticLabel('syn-p000-s00', 'exact', 'syn-a');
    const bad = { ...syntheticLabel('syn-p000-s01', 'exact', 'syn-a'), relation: 'match' };
    writeFileSync(join(dir, 'labels', 'syn-a.json'), JSON.stringify([good, bad]));
    const { set, violations } = loadSet(dir);
    expect(set.labels).toEqual([good]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^labels\/syn-a\.json \[1\]: relation:/);
  });

  it('reports a missing products file instead of throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'gold-syn-'));
    expect(loadSet(dir).violations.join('\n')).toMatch(/products\.json/);
  });
});
