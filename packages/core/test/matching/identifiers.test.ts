import { describe, expect, it } from 'vitest';
import { compareCodes, mpnForms, sameMpn } from '../../src/matching/codes.ts';
import {
  brandFieldMatches,
  mpnConflict,
  normaliseBrand,
  tier1,
} from '../../src/matching/identifiers.ts';

describe('brand normalisation', () => {
  it('folds case, accents of width, spaces and punctuation', () => {
    expect(normaliseBrand('Zentro Labs')).toBe('zentrolabs');
    expect(normaliseBrand('ZENTRO-LABS®')).toBe('zentrolabs');
    expect(normaliseBrand(null)).toBe('');
  });

  it('a store field with a decoration still names the brand', () => {
    expect(brandFieldMatches('Zentro', 'Zentro - US')).toBe(true);
    expect(brandFieldMatches('Zentro', 'beta-zentro-de')).toBe(true);
    expect(brandFieldMatches('Zentro', 'Acme')).toBe(false);
    expect(brandFieldMatches('Zentro', null)).toBe(false);
  });

  it.each([
    ['Anker', 'beta-anker-de'],
    ['Dreame', 'Dreame Germany'],
    ['Keurig', 'KEURIG K'],
    ['Bambu Lab', 'BambuLabs'],
    ['Zentro Labs', 'Zentro-Labs™'],
    ['Zentro Labs', 'Zentro-Labs™ - US'],
  ])('recognises %s in the store field %s', (brand, field) => {
    expect(brandFieldMatches(brand, field)).toBe(true);
  });

  it('retains other words that distinguish two brands', () => {
    expect(brandFieldMatches('Ace', 'Golden Ace')).toBe(false);
    expect(brandFieldMatches('Golden Ace', 'Ace')).toBe(false);
  });
});

describe('MPN normalisation', () => {
  it('compares compact forms and the base before a slash suffix', () => {
    expect(mpnForms('ZX-4400/B')).toEqual(expect.arrayContaining(['zx4400b', 'zx4400']));
    expect(sameMpn('ZX-4400/B', 'zx4400')).toBe(true);
    expect(sameMpn('ZX 4400', 'zx-4400')).toBe(true);
  });

  it('a short market or condition suffix after a dash is the same item', () => {
    expect(sameMpn('QR7710K2-F0', 'QR7710K2')).toBe(true);
    expect(sameMpn('QR7710K2-XJ', 'QR7710K2')).toBe(true);
  });

  it('two different suffixes are two items', () => {
    expect(sameMpn('ZX4400/23', 'ZX4400/60')).toBe(false);
    expect(sameMpn('ZX4400', 'ZX4410')).toBe(false);
  });
});

describe('model codes', () => {
  it.each([
    ['zx4400', 'zx4400', 'same'],
    ['zx440', 'zx440lt', 'narrower'],
    ['zx440lt', 'zx440', 'broader'],
    ['zx440d1', 'zx440b', 'sibling'],
    ['zx440d1', 'zx448d1', 'different'],
    ['qm2000xr5', 'qm2000xr4', 'different'],
    ['r1s', 'r1p', 'different'],
    ['k2c', 'k2', 'different'],
  ] as const)('%s against %s is %s', (asked, listing, relation) => {
    expect(compareCodes(asked, listing)).toBe(relation);
  });
});

describe('tier 1: GTIN equality and brand + MPN equality', () => {
  const base = {
    askedGtin: null,
    askedMpns: [] as string[],
    brandConfirmed: false,
    listingGtin: null,
    listingMpn: null,
  };

  it('equal GTINs in any length are identity', () => {
    expect(tier1({ ...base, askedGtin: '04006381333931', listingGtin: '4006381333931' })).toEqual({
      kind: 'gtin',
    });
  });

  it('a GTIN that fails its check digit identifies nothing', () => {
    expect(tier1({ ...base, askedGtin: '04006381333931', listingGtin: '4006381333932' })).toEqual({
      kind: 'none',
    });
  });

  it('a barcode written in the MPN field still counts', () => {
    expect(tier1({ ...base, askedGtin: '04006381333931', listingMpn: '4006381333931' })).toEqual({
      kind: 'gtin',
    });
  });

  it('two valid GTINs that differ are two barcodes', () => {
    expect(tier1({ ...base, askedGtin: '04006381333931', listingGtin: '012345678905' })).toEqual({
      kind: 'gtin_differs',
    });
  });

  it('brand + MPN equality needs the brand confirmed', () => {
    const mpn = { ...base, askedMpns: ['ZX-4400'], listingMpn: 'zx4400' };
    expect(tier1(mpn)).toEqual({ kind: 'none' });
    expect(tier1({ ...mpn, brandConfirmed: true })).toEqual({ kind: 'mpn' });
  });

  it('an equal MPN outweighs a store number in the GTIN field', () => {
    expect(
      tier1({
        ...base,
        askedGtin: '04006381333931',
        listingGtin: '012345678905',
        askedMpns: ['ZX-4400'],
        listingMpn: 'ZX4400/B',
        brandConfirmed: true,
      }),
    ).toEqual({ kind: 'mpn' });
  });

  it('a word that is no part number is never MPN identity', () => {
    expect(
      tier1({ ...base, askedMpns: ['Q-MAX'], listingMpn: 'QMAX', brandConfirmed: true }),
    ).toEqual({ kind: 'none' });
  });
});

describe('another part number on the page', () => {
  it('two lettered part numbers that differ conflict', () => {
    expect(mpnConflict('ZX4400LL/A', [], 'ZY7701LL/A')).toBe(true);
  });

  it('digits-only part numbers conflict only in the same dashed form', () => {
    expect(mpnConflict('910-004411', [], '910-004499')).toBe(true);
    expect(mpnConflict('910-004411', [], '5000356477')).toBe(false);
  });

  it('no conflict when one contains the other, or the listing names the asked model code', () => {
    expect(mpnConflict('QR7710K2', [], 'QR7710K2-F0')).toBe(false);
    expect(mpnConflict('ZX440BSS1', ['zx440'], 'RM-ZX440LT')).toBe(false);
  });

  it('an MPN field with spaces is a name, not a part number', () => {
    expect(mpnConflict('ZX4400', [], 'Zentro Mini')).toBe(false);
  });
});
