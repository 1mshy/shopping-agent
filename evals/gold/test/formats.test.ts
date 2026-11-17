// SYNTHETIC test inputs only (see synthetic.ts).
import { describe, expect, it } from 'vitest';
import {
  GoldProduct,
  identityKeys,
  ListingSnapshot,
  normaliseGtin,
  RelationLabel,
} from '../lib/formats.ts';
import { syntheticLabel, syntheticProduct, syntheticSnapshot } from './synthetic.ts';

describe('formats', () => {
  const product = syntheticProduct(1, 'syn-cat-0', 'CA');

  it('accepts the synthetic product, snapshot and label', () => {
    expect(GoldProduct.parse(product)).toEqual(product);
    const snap = syntheticSnapshot(product, 0);
    expect(ListingSnapshot.parse(snap)).toEqual(snap);
    expect(RelationLabel.parse(syntheticLabel(snap.id, 'exact'))).toBeTruthy();
  });

  it('refuses unknown keys, so a typo in a hand-edited file is caught', () => {
    expect(GoldProduct.safeParse({ ...product, categroy: 'x' }).success).toBe(false);
  });

  it('takes the relation vocabulary from @agentic-dasher/shared', () => {
    expect(RelationLabel.safeParse(syntheticLabel('s', 'other_line')).success).toBe(true);
    const bad = { ...syntheticLabel('s', 'exact'), relation: 'match' };
    expect(RelationLabel.safeParse(bad).success).toBe(false);
  });

  it('wants an opaque labeller handle, not an email or a name with spaces', () => {
    for (const labellerId of ['someone@example.com', 'First Last', '']) {
      expect(RelationLabel.safeParse({ ...syntheticLabel('s', 'exact'), labellerId }).success).toBe(
        false,
      );
    }
  });

  it('keeps a price only as text plus a currency code, never a number', () => {
    const snap = syntheticSnapshot(product, 0);
    const numeric = { ...snap, context: { priceText: 1, currency: 'USD' } };
    const noCurrency = { ...snap, context: { priceText: '$1.00' } };
    const badCurrency = { ...snap, context: { priceText: '$1.00', currency: 'dollars' } };
    for (const s of [numeric, noCurrency, badCurrency]) {
      expect(ListingSnapshot.safeParse(s).success).toBe(false);
    }
    const unknown = { ...snap, context: { priceText: '1.00', currency: 'unknown' } };
    expect(ListingSnapshot.safeParse(unknown).success).toBe(true);
  });

  it('validates the product GTIN check digit and normalises to 14 digits (S§5.4)', () => {
    // Invented numbers with the restricted-circulation prefix 2, so no real trade item.
    // EAN-13 200123456789?: weights 1,3 from the left over the 12 digits give
    // 2+0+0+3+2+9+4+15+6+21+8+27 = 97, so the check digit is (10 - 97 % 10) % 10 = 3.
    expect(normaliseGtin('2001234567893')).toBe('02001234567893');
    // UPC-A 20000000000?: weights 3,1 from the left give 2*3 = 6, check digit (10 - 6) % 10 = 4.
    expect(normaliseGtin('200000000004')).toBe('00200000000004');
    expect(normaliseGtin('2001234567894')).toBeNull();
    expect(normaliseGtin('12345')).toBeNull();
    const withBadGtin = { ...product, identity: { ...product.identity, gtin: '2001234567894' } };
    expect(GoldProduct.safeParse(withBadGtin).success).toBe(false);
  });

  it('derives identity keys from GTIN and normalised brand + MPN', () => {
    const p = {
      ...product,
      identity: { ...product.identity, brand: ' Synthetic  Brand-1 ', mpn: 'syn 1/mpn' },
    };
    expect(identityKeys(p)).toEqual(['mpn:syntheticbrand1|syn1mpn']);
    const g = { ...product, identity: { ...product.identity, gtin: '2001234567893' } };
    expect(identityKeys(g)).toContain('gtin:02001234567893');
  });
});
