import { describe, expect, it } from 'vitest';
import { parseHttpDate, parseRetryAfter } from '../../src/page/index.ts';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120_000);
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0);
  });

  it('reads an IMF-fixdate against the clock', () => {
    expect(parseRetryAfter('Tue, 24 Nov 2026 12:00:30 GMT', NOW)).toBe(30_000);
  });

  it('reads the obsolete RFC 850 and asctime forms', () => {
    expect(parseRetryAfter('Tuesday, 24-Nov-26 12:01:00 GMT', NOW)).toBe(60_000);
    expect(parseRetryAfter('Tue Nov 24 12:00:05 2026', NOW)).toBe(5_000);
    expect(parseRetryAfter('Sun Nov  6 08:49:37 1994', NOW)).toBe(0);
  });

  it('gives 0 for a date already past', () => {
    expect(parseRetryAfter('Sun, 06 Nov 1994 08:49:37 GMT', NOW)).toBe(0);
  });

  it('rounds a fractional clock up, never shortening the wait', () => {
    expect(parseRetryAfter('Tue, 24 Nov 2026 12:00:01 GMT', NOW + 0.5)).toBe(1_000);
  });

  it('is null when absent or unparseable', () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter(undefined, NOW)).toBeNull();
    expect(parseRetryAfter('', NOW)).toBeNull();
    expect(parseRetryAfter('soon', NOW)).toBeNull();
    expect(parseRetryAfter('-5', NOW)).toBeNull();
    expect(parseRetryAfter('1.5', NOW)).toBeNull();
    expect(parseRetryAfter('9'.repeat(30), NOW)).toBeNull();
    expect(parseRetryAfter('Tue, 31 Feb 2026 12:00:00 GMT', NOW)).toBeNull();
    expect(parseRetryAfter('Tue, 24 Nov 2026 12:00:00 PST', NOW)).toBeNull();
  });
});

describe('parseHttpDate', () => {
  it('maps a two-digit RFC 850 year to the most recent matching year', () => {
    expect(parseHttpDate('Sunday, 06-Nov-94 08:49:37 GMT', NOW)).toBe(
      Date.UTC(1994, 10, 6, 8, 49, 37),
    );
    expect(parseHttpDate('Monday, 06-Nov-30 08:49:37 GMT', NOW)).toBe(
      Date.UTC(2030, 10, 6, 8, 49, 37),
    );
  });
});
