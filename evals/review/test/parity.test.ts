// Parity with the predecessor (S§5.16, plan P0 workstream 4): rescoring each converted review
// file must give exactly the figures the predecessor's own offline rescoring gave on the original
// files. The expected values are the script's output, committed verbatim in
// predecessor/golden/*.figures.json (see `obtainedBy` there and the README for the command).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReviewFile } from '../lib/format.ts';
import { exactFractionOfDouble, type Figure, rescore } from '../lib/rescore.ts';

const DIR = join(import.meta.dirname, '..', 'predecessor');
const FILES = ['2026-10-23-phase5-review', '2026-10-23-matching-review'] as const;
/** Script figures this port does not compute: run timings, not review results (see README). */
const NOT_PORTED = ['median_compare_s', 'median_discover_s'];

type Golden = {
  obtainedBy: { runFileSha256: string; reviewFileSha256: string; publishedSummaryEqual: boolean };
  summary: Record<string, unknown>;
  products: Array<Record<string, unknown> & { id: string }>;
};

const readJson = (rel: string) => JSON.parse(readFileSync(join(DIR, rel), 'utf8'));

/** The predecessor's value as an exact fraction [numerator, denominator] (null stays null). */
function expectedFraction(v: unknown): [number, number] | null {
  if (v === null) return null;
  if (typeof v !== 'number') throw new Error(`not a number: ${String(v)}`);
  const f = exactFractionOfDouble(v);
  return [f.numerator, f.denominator];
}

/** Our figure in the predecessor's terms, as an exact fraction, a flag, a label or a tally. */
function ours(f: Figure): unknown {
  switch (f.kind) {
    case 'count':
      return [f.value, 1];
    case 'share':
      // The script reports the numerator (a count of products); the denominator is checked apart.
      return [f.numerator, 1];
    case 'median':
      return f.value === 'undefined' ? null : [f.value.numerator, f.value.denominator];
    case 'tally':
    case 'flag':
    case 'label':
      return f.value;
    default:
      throw new Error(`unexpected figure ${f.kind}`);
  }
}

describe.each(FILES)('parity with the predecessor: %s', (name) => {
  const file = ReviewFile.parse(readJson(`${name}.json`));
  const golden: Golden = readJson(`golden/${name}.figures.json`);
  const report = rescore(file);

  it('is the same input the golden figures were computed from', () => {
    expect(file.conversion?.runFileSha256).toBe(golden.obtainedBy.runFileSha256);
    expect(file.conversion?.reviewFileSha256).toBe(golden.obtainedBy.reviewFileSha256);
  });

  it('gives every summary figure of the script, as exact fractions', () => {
    const scriptKeys = Object.keys(golden.summary).sort();
    const ported = scriptKeys.filter((k) => !NOT_PORTED.includes(k));
    expect(Object.keys(report.predecessor).sort()).toEqual(ported);
    expect(Object.keys(report.notPorted).sort()).toEqual(NOT_PORTED);
    for (const key of ported) {
      const figure = report.predecessor[key];
      if (!figure) throw new Error(`missing ${key}`);
      const want = golden.summary[key];
      const got = ours(figure);
      if (typeof want === 'number' || want === null) {
        expect([key, got]).toEqual([key, expectedFraction(want)]);
      } else {
        expect([key, got]).toEqual([key, want]);
      }
      if (figure.kind === 'share') {
        // Every share the script counts is over all products.
        expect([key, figure.denominator]).toEqual([key, golden.summary.products]);
      }
    }
  });

  it('gives every product row the script wrote, store by store', () => {
    expect(report.products.map((p) => p.id)).toEqual(golden.products.map((p) => p.id));
    golden.products.forEach((g, i) => {
      const p = report.products[i];
      if (!p) throw new Error(`missing product ${g.id}`);
      const got = {
        id: p.id,
        before_stores: p.stores.before,
        after_stores: p.stores.after,
        with_learned_stores: p.stores.with_learned,
        before_stores_in_preferred: p.storesInPreferred?.before,
        after_stores_in_preferred: p.storesInPreferred?.after,
        with_learned_stores_in_preferred: p.storesInPreferred?.with_learned,
        added_by_web: p.addedByWeb,
        added_by_learned: p.addedByLearned,
        checked_before: p.checked.before.length,
        checked_after: p.checked.after.length,
        checked_with_learned: p.checked.with_learned.length,
        checked_before_in_preferred: p.checkedInPreferred?.before.length,
        checked_after_in_preferred: p.checkedInPreferred?.after.length,
        checked_with_learned_in_preferred: p.checkedInPreferred?.with_learned.length,
        checked_added_by_web: p.checkedAddedByWeb,
        checked_added_by_learned: p.checkedAddedByLearned,
        rejected: p.rejectedInRun,
      };
      expect(got).toEqual({ ...g, rejected: Object.keys(g.rejected as object).sort() });
    });
  });

  it('matches the JSON the predecessor published (the script reproduces it today)', () => {
    expect(golden.obtainedBy.publishedSummaryEqual).toBe(true);
  });
});

describe('the reports’ own derived figures', () => {
  // Numbers published in the predecessor's write-ups (reports/*.md), transcribed with their line
  // numbers in predecessor/golden/published.json. A percentage there is checked as the rounding of
  // our exact fraction, never the other way round.
  const published = readJson('golden/published.json') as {
    files: Record<
      string,
      {
        checkedShareOfRawPercent?: Record<string, number>;
        checkedProductsImprovedByWeb?: number;
        productsWithNoneChecked?: Record<string, number>;
        checkedByCategory?: Record<string, Record<string, number>>;
      }
    >;
  };

  for (const [name, want] of Object.entries(published.files)) {
    it(`agree with ${name}`, () => {
      const report = rescore(ReviewFile.parse(readJson(`${name}.json`)));
      const d = report.reportDerived;
      for (const [setup, percent] of Object.entries(want.checkedShareOfRawPercent ?? {})) {
        const f = d[`checked_share_of_raw_${setup}`];
        if (f?.kind !== 'share' || f.value === 'undefined') throw new Error(setup);
        // round half up on exact integers: floor((200 n + d) / (2 d))
        const rounded = Math.floor((200 * f.numerator + f.denominator) / (2 * f.denominator));
        expect([setup, rounded]).toEqual([setup, percent]);
      }
      if (want.checkedProductsImprovedByWeb !== undefined) {
        expect(d.checked_products_improved_by_web).toMatchObject({
          numerator: want.checkedProductsImprovedByWeb,
        });
      }
      for (const [setup, count] of Object.entries(want.productsWithNoneChecked ?? {})) {
        expect([setup, d[`products_with_none_checked_${setup}`]]).toMatchObject([
          setup,
          { numerator: count },
        ]);
      }
      if (want.checkedByCategory) {
        expect(d.checked_store_prices_by_category).toMatchObject({ value: want.checkedByCategory });
      }
    });
  }
});
