// What the corpus area notify-retry leaves open: Retry-After parsing details and a provider
// deadline on the last attempt of a pass.
import { describe, expect, it } from 'vitest';
import { decideDeliveryRetry, isRetryable, retryAfterMs } from '../../src/notify/retry.ts';

const NOW = '2026-11-17T09:30:00.000Z';

describe('retryAfterMs', () => {
  it('reads delay seconds, fractions rounded up to the millisecond', () => {
    expect(retryAfterMs('7', NOW)).toBe(7000);
    expect(retryAfterMs(' 1.5 ', NOW)).toBe(1500);
    expect(retryAfterMs('0.0004', NOW)).toBe(1);
  });

  it('reads an HTTP date against now; a past date is 0', () => {
    expect(retryAfterMs('Tue, 17 Nov 2026 09:31:00 GMT', NOW)).toBe(60_000);
    expect(retryAfterMs('Tue, 17 Nov 2026 09:00:00 GMT', NOW)).toBe(0);
  });

  it('counts absent, empty, negative and unparsable values as 0', () => {
    expect(retryAfterMs(null, NOW)).toBe(0);
    expect(retryAfterMs('', NOW)).toBe(0);
    expect(retryAfterMs('-5', NOW)).toBe(0);
    expect(retryAfterMs('soon', NOW)).toBe(0);
    expect(retryAfterMs('2026', NOW)).toBe(2_026_000);
  });
});

describe('decideDeliveryRetry', () => {
  const s503 = { kind: 'http_status', status: 503, retryAfter: null } as const;

  it('defers after the fourth attempt not before a deadline the provider gave', () => {
    expect(
      decideDeliveryRetry({
        kind: 'after_attempt',
        now: NOW,
        attempts: [s503, s503, s503, { kind: 'http_status', status: 429, retryAfter: '10' }],
      }),
    ).toEqual({ action: 'defer', outcome: 'retry', notBefore: '2026-11-17T09:30:10.000Z' });
  });

  it('refuses an empty attempt list', () => {
    expect(() => decideDeliveryRetry({ kind: 'after_attempt', now: NOW, attempts: [] })).toThrow(
      RangeError,
    );
  });

  it('classifies 3xx and 4xx other than 408, 425, 429 as permanent', () => {
    for (const status of [301, 400, 401, 403, 404, 410, 413, 422]) {
      expect(isRetryable({ kind: 'http_status', status, retryAfter: null })).toBe(false);
    }
    for (const status of [408, 425, 429, 500, 501, 599]) {
      expect(isRetryable({ kind: 'http_status', status, retryAfter: null })).toBe(true);
    }
  });
});
