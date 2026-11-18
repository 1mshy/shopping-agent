// SYNTHETIC predecessor-shaped inputs: invented products, stores and prices in the shape of the
// predecessor's run JSON (`--json`) and review file (`--review`).
import { describe, expect, it } from 'vitest';
import {
  ConversionRefused,
  convertPredecessor,
  exactDecimalText,
  parsePredecessorJson,
} from '../lib/convert.ts';
import { ReviewFile } from '../lib/format.ts';
import { rescore } from '../lib/rescore.ts';

const source = {
  repository: '~/predecessor',
  branch: 'b',
  commit: 'abc1234',
  reviewFile: 'scripts/eval/x-review.json',
  runFile: 'reports/x.json',
};

// Two products. Prices are written as the predecessor's Python wrote floats (repr), including
// forms a float parse would alter or that need care: 1299.0, 12.999, 5e-05.
const row = (store: string, price: string, currency: string | null, method?: string) =>
  `{"store": ${JSON.stringify(store)}, "url": "https://${store}.example/x", "price": ${price}, ` +
  `"currency": ${JSON.stringify(currency)}, "title": "T ${store}"` +
  (method ? `, "method": "${method}"}` : '}');

function runText(over: Partial<Record<string, string>> = {}): string {
  const p1 = {
    catalog_results: `[${row('a', '129.99', 'CAD')}, ${row('b', '1299.0', 'USD')}]`,
    web_results: `[${row('b', '12.999', 'CAD', 'http:json-ld')}]`,
    learned_results: `[${row('c', '5e-05', null, 'shopify-suggest')}]`,
    before_stores: '["a", "b"]',
    after_stores: '["a", "b"]',
    with_learned_stores: '["a", "b", "c"]',
    before_stores_in_preferred: '["a"]',
    after_stores_in_preferred: '["a", "b"]',
    with_learned_stores_in_preferred: '["a", "b"]',
    ...over,
  };
  const fields = Object.entries(p1)
    .map(([k, v]) => `"${k}": ${v}`)
    .join(', ');
  return `{
 "started_at": "2026-01-02T03:04:05.123456+00:00",
 "finished_at": "2026-01-02T03:30:00.999999+00:00",
 "base_url": "http://localhost:1", "product_list": "scripts/eval/list.json",
 "locale": {"preferred_currency": "CAD", "preferred_region": "CA"},
 "summary": {"products": 2, "median_discover_s": 16.52045879149955},
 "products": [
  {"id": "p1", "category": "c1", "query": "Query one", "compare_s": 39.5, "discover_s": 1.25,
   "compare_error": null, "discover_error": null,
   "web_unreadable": [{"host": "u.example", "url": "https://u.example/1", "reason": "blocked", "error": "403", "manufacturer": true}],
   ${fields}},
  {"id": "p2", "category": "c2", "query": "Query two", "compare_s": 1.0, "discover_s": 2.0,
   "compare_error": null, "discover_error": null, "web_unreadable": [],
   "catalog_results": [], "web_results": [], "learned_results": [],
   "before_stores": [], "after_stores": [], "with_learned_stores": [],
   "before_stores_in_preferred": [], "after_stores_in_preferred": [], "with_learned_stores_in_preferred": []}
 ]
}`;
}

const reviewText = JSON.stringify({
  about: 'Synthetic rule: a store counts when one row is the product.',
  p1: {
    a: 'an accessory',
    b: { reason: 'catalog: a part (the web read the product)', setups: ['before'] },
    zz: { reason: 'no setups given' },
  },
});

const convert = (run = runText(), review = reviewText) =>
  convertPredecessor({ reviewText: review, runText: run, source });

describe('reading the predecessor JSON', () => {
  it('keeps each number as the exact text the predecessor wrote', () => {
    const parsed = parsePredecessorJson('{"a": 129.990, "b": [1299.0, 5e-05]}') as Record<
      string,
      unknown
    >;
    expect(String(parsed.a)).toBe('129.990');
    expect((parsed.b as unknown[]).map(String)).toEqual(['1299.0', '5e-05']);
  });

  it('writes exponent notation out as exact decimal text, never through a float', () => {
    expect(exactDecimalText('5e-05')).toBe('0.00005');
    expect(exactDecimalText('1.25E+3')).toBe('1250');
    expect(exactDecimalText('1299.0')).toBe('1299.0');
    expect(exactDecimalText('-0.5e1')).toBe('-5');
    expect(exactDecimalText('0.1e-2')).toBe('0.001');
  });
});

describe('converting a predecessor review and its run', () => {
  const file = convert();

  it('produces a valid review file', () => {
    expect(ReviewFile.safeParse(file).success).toBe(true);
    expect(file.id).toBe('x-review');
    expect(file.review).toEqual({
      reviewerId: 'pred-unattributed',
      reviewedAt: null,
      rule: 'Synthetic rule: a store counts when one row is the product.',
      unlistedStores: 'accepted',
    });
    expect(file.run).toEqual({
      startedAt: '2026-01-02T03:04:05.123Z',
      finishedAt: '2026-01-02T03:30:00.999Z',
      preferredCurrency: 'CAD',
      preferredRegion: 'CA',
      productList: 'scripts/eval/list.json',
    });
  });

  it('turns a reason into an all-setup rejection and keeps a per-setup one per setup', () => {
    expect(file.products[0]?.verdicts).toEqual([
      { store: 'a', verdict: 'rejected', setups: 'all', reason: 'an accessory' },
      {
        store: 'b',
        verdict: 'rejected',
        setups: ['before'],
        reason: 'catalog: a part (the web read the product)',
      },
      // The script reads a missing `setups` as every setup (`value.get("setups") or _SETUPS`).
      // zz has no listing in this run: kept, as the predecessor file kept it, with no effect.
      { store: 'zz', verdict: 'rejected', setups: 'all', reason: 'no setups given' },
    ]);
    expect(file.products[1]?.verdicts).toEqual([]);
  });

  it('keeps prices as exact decimal text and converts only through moneyFromDecimal', () => {
    const prices = file.products[0]?.listings.map((l) => [l.source, l.store, l.price]);
    expect(prices).toEqual([
      ['catalog', 'a', { decimal: '129.99', currency: 'CAD', amountMinor: 12999, refusal: null }],
      ['catalog', 'b', { decimal: '1299.0', currency: 'USD', amountMinor: 129900, refusal: null }],
      // 12.999 CAD has a third non-zero decimal: refused, not rounded.
      [
        'web',
        'b',
        { decimal: '12.999', currency: 'CAD', amountMinor: null, refusal: 'excess_precision' },
      ],
      // A null currency is `unknown`, which has no minor units.
      [
        'learned',
        'c',
        { decimal: '0.00005', currency: 'unknown', amountMinor: null, refusal: 'unknown_currency' },
      ],
    ]);
    expect(file.products[0]?.listings.map((l) => l.readMethod)).toEqual([
      null,
      null,
      'http:json-ld',
      'shopify-suggest',
    ]);
  });

  it('keeps the unreadable pages and lists every lossy step with the original values', () => {
    expect(file.products[0]?.unreadable).toEqual([
      { host: 'u.example', url: 'https://u.example/1', reason: 'blocked' },
    ]);
    const lossy = file.conversion?.lossy.join('\n') ?? '';
    expect(lossy).toContain('2026-01-02T03:04:05.123456+00:00');
    expect(lossy).toContain('5e-05');
    expect(lossy).toMatch(/compare_s/);
    expect(lossy).toMatch(/manufacturer/);
    expect(file.conversion?.commit).toBe('abc1234');
    expect(file.conversion?.reviewFileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rescoring the converted file reproduces the script on the same rows', () => {
    // before {a,b} − b(before) = {a}; after {a,b} − a = {b}; with_learned {a,b,c} − a = {b,c}
    const r = rescore(file);
    expect(r.products[0]?.checked).toEqual({ before: [], after: ['b'], with_learned: ['b', 'c'] });
    expect(r.products[0]?.rejectedInRun).toEqual(['a', 'b']);
    expect(r.n.rejectionsWithoutEffect).toBe(1);
  });
});

describe('the converter refuses what it cannot carry faithfully', () => {
  const refuses = (run: string, review = reviewText) =>
    expect(() => convert(run, review)).toThrow(ConversionRefused);

  it('a setup name the script does not know (it would silently ignore it)', () => {
    refuses(
      runText(),
      JSON.stringify({ about: 'x', p1: { a: { reason: 'r', setups: ['catalog'] } } }),
    );
  });

  it('a review entry for a product the run does not have', () => {
    refuses(runText(), JSON.stringify({ about: 'x', p9: { a: 'r' } }));
  });

  it('extra keys on a rejection, and an empty reason', () => {
    refuses(runText(), JSON.stringify({ about: 'x', p1: { a: { reason: 'r', by: 'someone' } } }));
    refuses(runText(), JSON.stringify({ about: 'x', p1: { a: '' } }));
  });

  it('store lists that do not follow from the rows (rescoring derives them from the rows)', () => {
    refuses(runText({ after_stores: '["a"]' }));
    refuses(runText({ with_learned_stores_in_preferred: '["a"]' }));
  });

  it('a currency that is not an upper-case ISO code with minor units', () => {
    refuses(runText({ catalog_results: `[${row('a', '1.00', 'cad')}]`, before_stores: '["a"]' }));
  });

  it('a run without learned results (the script cannot rescore it either)', () => {
    refuses(runText({ learned_results: 'null' }));
  });

  it('a run time that is not UTC', () => {
    refuses(runText().replace('03:04:05.123456+00:00', '03:04:05.123456-04:00'));
  });
});
