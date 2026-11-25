import { Gtin14 } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { gtinCheckDigitHolds, normaliseGtin } from '../../src/matching/gtin.ts';

describe('GTIN check digit (GS1 mod 10)', () => {
  it('holds for valid 14-digit forms and fails when one digit changes', () => {
    expect(gtinCheckDigitHolds('00012345678905')).toBe(true);
    expect(gtinCheckDigitHolds('00012345678904')).toBe(false);
    expect(gtinCheckDigitHolds('04006381333931')).toBe(true);
    expect(gtinCheckDigitHolds('04006381333932')).toBe(false);
  });

  it('refuses anything that is not 14 digits', () => {
    expect(gtinCheckDigitHolds('4006381333931')).toBe(false);
    expect(gtinCheckDigitHolds('0400638133393a')).toBe(false);
  });
});

describe('normaliseGtin: 8, 12, 13 and 14 digits to 14', () => {
  it.each([
    ['GTIN-8', '96385074', '00000096385074'],
    ['GTIN-12 (UPC-A)', '012345678905', '00012345678905'],
    ['GTIN-13 (EAN)', '4006381333931', '04006381333931'],
    ['GTIN-14', '10012345678902', '10012345678902'],
    ['spaces and dashes as read', '4 006381 33393-1', '04006381333931'],
  ])('%s', (_, raw, expected) => {
    const g = normaliseGtin(raw);
    expect(g).toBe(expected);
    expect(Gtin14.safeParse(g).success).toBe(true);
  });

  it('a UPC-A and the EAN-13 with a leading zero are one GTIN', () => {
    expect(normaliseGtin('012345678905')).toBe(normaliseGtin('0012345678905'));
  });

  it.each([
    ['a failing check digit', '4006381333932'],
    ['a length that is no GTIN (11 digits)', '01234567890'],
    ['a length that is no GTIN (15 digits)', '400638133393100'],
    ['letters', '40063813339A1'],
    ['all zeros', '00000000000000'],
    ['empty', ''],
    ['null', null],
  ])('refuses %s', (_, raw) => {
    expect(normaliseGtin(raw)).toBeNull();
  });
});
