import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATASET } from '../dataset.ts';
import {
  composeBatches,
  DEFAULT_PLAN,
  groupKeyOf,
  listingId,
  planEstimate,
  planMarkdown,
} from '../lib/batches.ts';
import { loadPrompt } from '../prompt/load.ts';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const byKey = new Map(DATASET.map((i) => [i.key, i]));

describe('batch composition', () => {
  const opts = { batchSizes: [1, 5, 10, 15], trials: 3, seed: 42 };

  it('is deterministic from the seed', () => {
    expect(composeBatches(DATASET, opts)).toEqual(composeBatches(DATASET, opts));
    const other = composeBatches(DATASET, { ...opts, seed: 43 });
    expect(other.map((b) => b.itemKeys)).not.toEqual(
      composeBatches(DATASET, opts).map((b) => b.itemKeys),
    );
  });

  it('puts each item exactly once per batch size per trial', () => {
    const batches = composeBatches(DATASET, opts);
    for (const size of opts.batchSizes) {
      for (const trial of [1, 2, 3]) {
        const keys = batches
          .filter((b) => b.nominalSize === size && b.trial === trial)
          .flatMap((b) => b.itemKeys);
        expect(keys).toHaveLength(DATASET.length);
        expect(new Set(keys).size).toBe(DATASET.length);
      }
    }
  });

  it('keeps one asked product per batch and never exceeds the nominal size', () => {
    for (const b of composeBatches(DATASET, opts)) {
      expect(b.itemKeys.length).toBeGreaterThan(0);
      expect(b.itemKeys.length).toBeLessThanOrEqual(b.nominalSize);
      const groups = new Set(
        b.itemKeys.map((k) => {
          const item = byKey.get(k);
          if (!item) throw new Error(`no item ${k}`);
          return groupKeyOf(item.asked);
        }),
      );
      expect(groups.size).toBe(1);
      expect([...groups][0]).toBe(b.groupKey);
    }
  });

  it('orders trials first, so a run stopped by a budget has covered every size of trial 1', () => {
    const trials = composeBatches(DATASET, opts).map((b) => b.trial);
    expect(trials).toEqual([...trials].sort((a, b) => a - b));
  });

  it('labels listings by 1-based position', () => {
    expect(listingId(1)).toBe('L1');
    expect(listingId(15)).toBe('L15');
  });

  it('has unique batch ids', () => {
    const ids = composeBatches(DATASET, opts).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the default plan estimate', () => {
  it('counts calls from items, batch sizes and trials, and is what the README states', () => {
    const est = planEstimate(DATASET, DEFAULT_PLAN, loadPrompt());
    // Batch size 1: one call per item, 158 per trial.
    expect(est.bySize.find((s) => s.size === 1)?.batchesPerTrial).toBe(158);
    expect(est.calls).toBe(est.bySize.reduce((n, s) => n + s.batchesPerTrial, 0) * 3);
    expect(est.callsWithRepairs).toBe(est.calls * 2);
    expect(README).toContain(planMarkdown(est));
  });
});
