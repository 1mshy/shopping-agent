import { describe, expect, it } from 'vitest';
import {
  basisPointsToPercent,
  exponentOf,
  formatMoney,
  minorToDecimal,
  parseAmount,
  percentToBasisPoints,
} from './money.ts';

describe('exponentOf', () => {
  it('reads the minor-unit exponent from Intl', () => {
    expect(exponentOf('EUR')).toBe(2);
    expect(exponentOf('JPY')).toBe(0);
    expect(exponentOf('KWD')).toBe(3);
  });
  it('answers null for what is not a currency code', () => {
    expect(exponentOf('unknown')).toBeNull();
  });
});

describe('minorToDecimal', () => {
  it('places the point by string handling', () => {
    expect(minorToDecimal(1999, 2)).toBe('19.99');
    expect(minorToDecimal(5, 2)).toBe('0.05');
    expect(minorToDecimal(1234, 0)).toBe('1234');
    expect(minorToDecimal(-150, 2)).toBe('-1.50');
    expect(minorToDecimal(1, 3)).toBe('0.001');
  });
});

describe('formatMoney', () => {
  it('always shows the currency', () => {
    expect(formatMoney(1999, 'USD', 'en-US')).toBe('$19.99');
    expect(formatMoney(1234, 'JPY', 'en-US')).toBe('¥1,234');
    expect(formatMoney(12, 'unknown')).toContain('unknown');
  });
  it('keeps every digit of a large amount', () => {
    expect(formatMoney(9007199254740991, 'EUR', 'en-US')).toBe('€90,071,992,547,409.91');
  });
});

describe('parseAmount', () => {
  it('turns text into minor units without floats', () => {
    expect(parseAmount('19.99', 2)).toBe(1999);
    expect(parseAmount('19,9', 2)).toBe(1990);
    expect(parseAmount('19', 2)).toBe(1900);
    expect(parseAmount(' 0.29 ', 2)).toBe(29);
    expect(parseAmount('1234', 0)).toBe(1234);
    expect(parseAmount('1.005', 3)).toBe(1005);
  });
  it('refuses what it cannot read exactly', () => {
    expect(parseAmount('19.999', 2)).toBeNull();
    expect(parseAmount('1.5', 0)).toBeNull();
    expect(parseAmount('1,000.00', 2)).toBeNull();
    expect(parseAmount('-1', 2)).toBeNull();
    expect(parseAmount('1e3', 2)).toBeNull();
    expect(parseAmount('', 2)).toBeNull();
    expect(parseAmount('abc', 2)).toBeNull();
    expect(parseAmount('99999999999999999', 2)).toBeNull();
  });
});

describe('percent and basis points', () => {
  it('converts both ways with integers only', () => {
    expect(basisPointsToPercent(500)).toBe('5');
    expect(basisPointsToPercent(525)).toBe('5.25');
    expect(basisPointsToPercent(550)).toBe('5.5');
    expect(basisPointsToPercent(5)).toBe('0.05');
    expect(percentToBasisPoints('5')).toBe(500);
    expect(percentToBasisPoints('5.25')).toBe(525);
    expect(percentToBasisPoints('5.255')).toBeNull();
  });
});
