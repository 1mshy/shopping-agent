// The matcher scorer on synthetic rows and records (never the real gold set).
import { describe, expect, it } from 'vitest';
import type { GoldProduct, ListingSnapshot, RelationLabel } from '../lib/formats.ts';
import {
  askedFor,
  formatScore,
  goldRelations,
  listingFor,
  type ScoredRow,
  scoreRows,
} from '../lib/score-matcher.ts';

const row = (gold: ScoredRow['gold'], predicted: ScoredRow['predicted'], i = 0): ScoredRow => ({
  snapshotId: `example-s${i}`,
  gold,
  predicted,
});

describe('scoreRows', () => {
  const rows = [
    row('exact', 'exact', 1),
    row('exact', 'exact', 2),
    row('variant', 'exact', 3),
    row('exact', 'unknown', 4),
    row('other_model', 'other_model', 5),
    row('accessory_or_part', 'unknown', 6),
  ];
  const s = scoreRows(rows);

  it('identity precision: of the listings called exact, the share gold-labelled exact', () => {
    expect(s).toMatchObject({ predictedExact: 3, truePositives: 2, precision: 2 / 3 });
  });

  it('recall: of the gold exact listings, the share called exact', () => {
    expect(s).toMatchObject({ goldExact: 3, recall: 2 / 3 });
  });

  it('counts the listings left unknown and fills the confusion table by relation', () => {
    expect(s.unknown).toBe(2);
    expect(s.n).toBe(6);
    expect(s.confusion.exact.exact).toBe(2);
    expect(s.confusion.variant.exact).toBe(1);
    expect(s.confusion.exact.unknown).toBe(1);
    expect(s.confusion.accessory_or_part.unknown).toBe(1);
    expect(s.confusion.bundle.bundle).toBe(0);
  });

  it('reports no ratio when its denominator is zero', () => {
    const none = scoreRows([row('variant', 'unknown')]);
    expect(none.precision).toBeNull();
    expect(none.recall).toBeNull();
  });

  it('prints every figure with the count it rests on', () => {
    const text = formatScore(s, 'example');
    expect(text).toContain('snapshots scored: n = 6');
    expect(text).toContain('66.7% = 2 / 3 called exact');
    expect(text).toContain('66.7% = 2 / 3 gold exact');
    expect(text).toContain('left unknown: 2 of 6');
  });
});

describe('gold relations', () => {
  const label = (
    snapshotId: string,
    relation: RelationLabel['relation'],
    pass: RelationLabel['pass'],
  ) =>
    ({ snapshotId, relation, pass, labellerId: 'l1', labelledAt: '2026-11-02T10:00:00Z' }) as const;

  it('an adjudicated label replaces the primary one; a second label never counts', () => {
    const gold = goldRelations([
      label('example-s1', 'exact', 'primary'),
      label('example-s1', 'unknown', 'adjudicated'),
      label('example-s2', 'variant', 'primary'),
      label('example-s2', 'bundle', 'second'),
    ]);
    expect(gold.get('example-s1')).toBe('unknown');
    expect(gold.get('example-s2')).toBe('variant');
  });
});

describe('the gold records in the matcher shape', () => {
  const product: GoldProduct = {
    id: 'example-p001',
    category: 'example-category',
    country: 'CA',
    identity: {
      brand: 'Example Brand',
      model: 'EX-100',
      mpn: 'EX100-BLK',
      gtin: '4006381333931',
      mustHave: { chargingCase: 'USB-C', colour: 'black' },
      condition: 'new',
      packQuantity: 1,
    },
  };

  it('asks for brand and model as the name, with the identifiers and must-haves', () => {
    expect(askedFor(product)).toEqual({
      name: 'Example Brand EX-100',
      brand: 'Example Brand',
      model: 'EX-100',
      mpn: 'EX100-BLK',
      gtin: '04006381333931',
      mustHave: [
        { attribute: 'charging_case', value: 'USB-C' },
        { attribute: 'colour', value: 'black' },
      ],
      packQuantity: 1,
    });
  });

  it('does not repeat a brand the model already starts with', () => {
    const p = { ...product, identity: { ...product.identity, model: 'Example Brand EX-100' } };
    expect(askedFor(p).name).toBe('Example Brand EX-100');
  });

  it('hands the matcher the listing fields and the capture URL, never the price context', () => {
    const snapshot: ListingSnapshot = {
      id: 'example-p001-s01',
      productId: 'example-p001',
      capture: {
        url: 'https://shop.example/p/ex-100',
        country: 'CA',
        capturedAt: '2026-11-01T15:04:05Z',
      },
      listing: {
        title: 'Example Brand EX-100, black',
        brand: 'Example Brand',
        gtin: '2001234567893',
        variantAttributes: { colour: 'black' },
        condition: 'new',
        sellerKind: 'first_party',
        storeHost: 'shop.example',
      },
      context: { priceText: '$199.99', currency: 'CAD' },
    };
    expect(listingFor(snapshot)).toEqual({
      title: 'Example Brand EX-100, black',
      brand: 'Example Brand',
      mpn: null,
      gtin: '2001234567893',
      variant: { colour: 'black' },
      url: 'https://shop.example/p/ex-100',
    });
  });
});
