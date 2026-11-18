// SYNTHETIC test inputs only (see build.ts). Every expected value is derived by hand in the
// comments, from the predecessor's definitions (scripts/web-discovery-eval.py, see README).
import { describe, expect, it } from 'vitest';
import { formatReport, medianOf, rescore } from '../lib/rescore.ts';
import { listing, product, reject, reviewFile } from './build.ts';

// P1 (category c1)
//   catalog: a CAD, a CAD (two rows, one store), b USD
//   web:     b CAD, c CAD
//   learned: d CAD, a CAD
//   verdicts: b rejected in `before` only; c rejected everywhere; zz rejected but has no listing
//   unreadable: blocked, no-price
// Raw stores (sets of store keys):
//   before = {a,b} (2); after = before ∪ web = {a,b,c} (3); with_learned = after ∪ {d,a} = {a,b,c,d} (4)
// In CAD: before = catalog rows in CAD = {a} (b's catalog row is USD) (1)
//   after = (catalog + web) in CAD = {a,b,c} (3); with_learned = after ∪ learned in CAD = {a,b,c,d} (4)
// Checked (rejections removed per setup):
//   before {a,b} − b = {a} (1); after {a,b,c} − c = {a,b} (2); with_learned {a,b,c,d} − c = {a,b,d} (3)
//   in CAD: before {a} (1); after {a,b} (2); with_learned {a,b,d} (3)
//   checked added by web = {a,b} − {a} = [b]; by learned = {a,b,d} − {a,b} = [d]
//   raw added by web = web stores − before = {b,c} − {a,b} = [c]; by learned = {d,a} − after = [d]
//   rejected (as the script's row["rejected"], stores of this run only) = [b, c]; zz has no effect
const p1 = product(
  'p1',
  'c1',
  [
    listing('catalog', 'a'),
    listing('catalog', 'a'),
    listing('catalog', 'b', 'USD'),
    listing('web', 'b'),
    listing('web', 'c'),
    listing('learned', 'd'),
    listing('learned', 'a'),
  ],
  [reject('b', ['before']), reject('c'), reject('zz')],
  ['blocked', 'no-price'],
);
// P2 (category c2): web e EUR only; e rejected everywhere.
//   raw 0 / 1 / 1; in CAD 0 / 0 / 0; checked 0 / 0 / 0; in CAD checked 0 / 0 / 0
const p2 = product('p2', 'c2', [listing('web', 'e', 'EUR')], [reject('e')]);
// P3 (category c1): catalog f CAD; learned g with currency unknown; no verdicts; unreadable: blocked
//   raw 1 / 1 / 2; in CAD 1 / 1 / 1; checked 1 / 1 / 2; in CAD checked 1 / 1 / 1
const p3 = product(
  'p3',
  'c1',
  [listing('catalog', 'f'), listing('learned', 'g', 'unknown')],
  [],
  ['blocked'],
);

describe('rescore: the predecessor figures, by hand', () => {
  const report = rescore(reviewFile([p1, p2, p3]));
  const f = report.predecessor;

  it('derives each product as the script did', () => {
    const r1 = report.products[0];
    expect(r1?.stores).toEqual({
      before: ['a', 'b'],
      after: ['a', 'b', 'c'],
      with_learned: ['a', 'b', 'c', 'd'],
    });
    expect(r1?.storesInPreferred).toEqual({
      before: ['a'],
      after: ['a', 'b', 'c'],
      with_learned: ['a', 'b', 'c', 'd'],
    });
    expect(r1?.checked).toEqual({
      before: ['a'],
      after: ['a', 'b'],
      with_learned: ['a', 'b', 'd'],
    });
    expect(r1?.checkedInPreferred).toEqual({
      before: ['a'],
      after: ['a', 'b'],
      with_learned: ['a', 'b', 'd'],
    });
    expect(r1?.addedByWeb).toEqual(['c']);
    expect(r1?.addedByLearned).toEqual(['d']);
    expect(r1?.checkedAddedByWeb).toEqual(['b']);
    expect(r1?.checkedAddedByLearned).toEqual(['d']);
    expect(r1?.rejectedInRun).toEqual(['b', 'c']);
    expect(report.n).toEqual({
      products: 3,
      listings: 10,
      verdicts: 4,
      rejectionsWithoutEffect: 1,
    });
  });

  it('sums store prices over products (counts with n)', () => {
    // raw: before 2+0+1 = 3, after 3+1+1 = 5, with_learned 4+1+2 = 7
    expect(f.store_prices_before).toEqual({ kind: 'count', value: 3, n: 3 });
    expect(f.store_prices_after).toEqual({ kind: 'count', value: 5, n: 3 });
    expect(f.store_prices_with_learned).toEqual({ kind: 'count', value: 7, n: 3 });
    // checked: before 1+0+1 = 2, after 2+0+1 = 3, with_learned 3+0+2 = 5
    expect(f.checked_store_prices_before).toEqual({ kind: 'count', value: 2, n: 3 });
    expect(f.checked_store_prices_after).toEqual({ kind: 'count', value: 3, n: 3 });
    expect(f.checked_store_prices_with_learned).toEqual({ kind: 'count', value: 5, n: 3 });
    // in CAD raw: before 1+0+1 = 2, after 3+0+1 = 4, with_learned 4+0+1 = 5
    expect(f.store_prices_in_preferred_before).toEqual({ kind: 'count', value: 2, n: 3 });
    expect(f.store_prices_in_preferred_after).toEqual({ kind: 'count', value: 4, n: 3 });
    expect(f.store_prices_in_preferred_with_learned).toEqual({ kind: 'count', value: 5, n: 3 });
    // in CAD checked: before 1+0+1 = 2, after 2+0+1 = 3, with_learned 3+0+1 = 4
    expect(f.checked_in_preferred_before).toEqual({ kind: 'count', value: 2, n: 3 });
    expect(f.checked_in_preferred_after).toEqual({ kind: 'count', value: 3, n: 3 });
    expect(f.checked_in_preferred_with_learned).toEqual({ kind: 'count', value: 4, n: 3 });
    expect(f.products).toEqual({ kind: 'count', value: 3, n: 3 });
    expect(f.hand_checked).toEqual({ kind: 'flag', value: true });
    expect(f.preferred_currency).toEqual({ kind: 'label', value: 'CAD' });
  });

  it('counts products as numerator over all products', () => {
    // products_improved (raw after > before): p1 3>2, p2 1>0, p3 1>1 no → 2 of 3
    expect(f.products_improved).toMatchObject({
      kind: 'share',
      numerator: 2,
      denominator: 3,
      n: 3,
    });
    // products_improved_by_learned (raw with_learned > after): p1 4>3, p2 no, p3 2>1 → 2 of 3
    expect(f.products_improved_by_learned).toMatchObject({ numerator: 2, denominator: 3 });
    // checked_products_improved_by_learned: p1 3>2, p2 0>0 no, p3 2>1 → 2 of 3
    expect(f.checked_products_improved_by_learned).toMatchObject({ numerator: 2, denominator: 3 });
    // products_with_none (raw == 0): before only p2 → 1; after 0; with_learned 0
    expect(f.products_with_none_before).toMatchObject({ numerator: 1, denominator: 3 });
    expect(f.products_with_none_after).toMatchObject({ numerator: 0, denominator: 3 });
    expect(f.products_with_none_with_learned).toMatchObject({ numerator: 0, denominator: 3 });
    expect(f.products_improved).toMatchObject({ value: { numerator: 2, denominator: 3 } });
  });

  it('takes medians of the raw per-product counts, as exact fractions', () => {
    // before [2,0,1] → 1; after [3,1,1] → 1; with_learned [4,1,2] → 2
    expect(f.median_stores_before).toEqual({
      kind: 'median',
      n: 3,
      value: { numerator: 1, denominator: 1 },
    });
    expect(f.median_stores_after).toMatchObject({ value: { numerator: 1, denominator: 1 } });
    expect(f.median_stores_with_learned).toMatchObject({ value: { numerator: 2, denominator: 1 } });
    // in CAD: before [1,0,1] → 1; after [3,0,1] → 1; with_learned [4,0,1] → 1
    expect(f.median_in_preferred_with_learned).toMatchObject({
      value: { numerator: 1, denominator: 1 },
    });
  });

  it('tallies unreadable pages by reason', () => {
    // p1: blocked, no-price; p3: blocked
    expect(f.unreadable_by_reason).toEqual({
      kind: 'tally',
      value: { blocked: 2, 'no-price': 1 },
      n: 3,
    });
  });

  it('says which script figures are not ported', () => {
    expect(Object.keys(report.notPorted).sort()).toEqual(['median_compare_s', 'median_discover_s']);
  });

  it('adds the reports’ derived figures under their own names', () => {
    const d = report.reportDerived;
    // checked / raw store prices: 2/3, 3/5, 5/7 (not reduced: these are counts)
    expect(d.checked_share_of_raw_before).toMatchObject({ numerator: 2, denominator: 3, n: 3 });
    expect(d.checked_share_of_raw_after).toMatchObject({ numerator: 3, denominator: 5 });
    expect(d.checked_share_of_raw_with_learned).toMatchObject({ numerator: 5, denominator: 7 });
    // checked after > checked before: p1 2>1 yes, p2 0>0 no, p3 1>1 no → 1 of 3
    expect(d.checked_products_improved_by_web).toMatchObject({ numerator: 1, denominator: 3 });
    // checked == 0: p2 in every setup → 1 of 3 each
    expect(d.products_with_none_checked_before).toMatchObject({ numerator: 1, denominator: 3 });
    expect(d.products_with_none_checked_with_learned).toMatchObject({ numerator: 1 });
    // by category: c1 = p1 + p3 = 1+1, 2+1, 3+2; c2 = p2 = 0, 0, 0
    expect(d.checked_store_prices_by_category).toEqual({
      kind: 'by_category',
      n: 3,
      value: {
        c1: { before: 2, after: 3, with_learned: 5 },
        c2: { before: 0, after: 0, with_learned: 0 },
      },
    });
  });

  it('adds the gate candidate under its own name, never as the S§6 gate', () => {
    const g = report.gateCandidates;
    // median of checked per product: before [1,0,1] → 1; after [2,0,1] → 1; with_learned [3,0,2] → 2
    expect(g.median_checked_stores_per_product_before).toMatchObject({
      n: 3,
      value: { numerator: 1, denominator: 1 },
    });
    expect(g.median_checked_stores_per_product_with_learned).toMatchObject({
      value: { numerator: 2, denominator: 1 },
    });
    expect(Object.keys(report.notComputable).sort()).toEqual([
      'best_offer_recall',
      'identity_precision',
      'price_correctness',
    ]);
  });

  it('prints every ratio with its numerator and denominator, and no percentage', () => {
    const text = formatReport(report);
    expect(text).toContain('2/3');
    expect(text).not.toMatch(/%/);
  });
});

describe('rescore: edges', () => {
  it('takes the mean of the two middle values for an even count', () => {
    // [1, 2] → (1 + 2) / 2 = 3/2; [0, 2] → 1; [] → undefined
    expect(medianOf([2, 1])).toEqual({
      kind: 'median',
      n: 2,
      value: { numerator: 3, denominator: 2 },
    });
    expect(medianOf([0, 2])).toEqual({
      kind: 'median',
      n: 2,
      value: { numerator: 1, denominator: 1 },
    });
    expect(medianOf([])).toEqual({ kind: 'median', n: 0, value: 'undefined' });
  });

  it('reports a zero denominator as undefined, not as 0 or 1', () => {
    // No products: every share is 0/0 and every median has n = 0.
    const empty = rescore(reviewFile([]));
    expect(empty.predecessor.products_improved).toEqual({
      kind: 'share',
      numerator: 0,
      denominator: 0,
      n: 0,
      value: 'undefined',
    });
    expect(empty.predecessor.median_stores_after).toEqual({
      kind: 'median',
      n: 0,
      value: 'undefined',
    });
    expect(empty.reportDerived.checked_share_of_raw_after).toMatchObject({ value: 'undefined' });
    expect(empty.predecessor.checked_store_prices_after).toEqual({ kind: 'count', value: 0, n: 0 });
    // Two products with no listing: shares over products are defined (0/2), checked/raw is 0/0.
    const bare = rescore(reviewFile([product('p1', 'c1', []), product('p2', 'c1', [])]));
    expect(bare.predecessor.products_with_none_before).toMatchObject({
      numerator: 2,
      denominator: 2,
      value: { numerator: 1, denominator: 1 },
    });
    expect(bare.reportDerived.checked_share_of_raw_before).toMatchObject({
      numerator: 0,
      denominator: 0,
      value: 'undefined',
    });
    expect(formatReport(bare)).toContain('undefined');
  });

  it('leaves out the preferred-currency figures when the run had no preferred currency', () => {
    // The script adds them only `if preferred:`.
    const r = rescore(reviewFile([p3], null));
    expect(r.predecessor.store_prices_in_preferred_before).toBeUndefined();
    expect(r.predecessor.preferred_currency).toBeUndefined();
    expect(r.products[0]?.storesInPreferred).toBeNull();
  });

  it('counts an accepted verdict like an unlisted store, and a store once however many rows', () => {
    const r = rescore(
      reviewFile([
        product(
          'p1',
          'c1',
          [listing('catalog', 'a'), listing('catalog', 'a'), listing('web', 'a')],
          [{ store: 'a', verdict: 'accepted', setups: 'all', reason: '' }],
        ),
      ]),
    );
    expect(r.predecessor.store_prices_after).toEqual({ kind: 'count', value: 1, n: 1 });
    expect(r.predecessor.checked_store_prices_after).toEqual({ kind: 'count', value: 1, n: 1 });
    expect(r.n.rejectionsWithoutEffect).toBe(0);
  });

  it('counts a per-setup rejection that names no setup the store is in as without effect', () => {
    // a is only in the web rows, so a rejection limited to `before` changes nothing.
    const r = rescore(
      reviewFile([product('p1', 'c1', [listing('web', 'a')], [reject('a', ['before'])])]),
    );
    expect(r.predecessor.checked_store_prices_after).toEqual({ kind: 'count', value: 1, n: 1 });
    expect(r.n.rejectionsWithoutEffect).toBe(1);
    // ... though the script still lists it in row["rejected"] (the store is in the run).
    expect(r.products[0]?.rejectedInRun).toEqual(['a']);
  });
});
