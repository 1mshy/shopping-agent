// From the alert review's finding 10: a Retry-After of about 10^14 seconds made the retry
// decision throw (the deadline was not a date), and a provider could park a delivery for years.
import { describe, expect, it } from 'vitest';
import { decideDeliveryRetry, MAX_RETRY_AFTER_MS, retryAfterMs } from '../../src/notify/retry.ts';

const NOW = '2026-11-25T09:00:00.000Z';

describe('Retry-After is honoured up to a day', () => {
  it('caps delay seconds, however long the number', () => {
    expect(retryAfterMs('100000000000000', NOW)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs('9'.repeat(400), NOW)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs('172800', NOW)).toBe(MAX_RETRY_AFTER_MS);
  });

  it('caps an HTTP date far in the future', () => {
    expect(retryAfterMs('Fri, 31 Dec 9999 23:59:59 GMT', NOW)).toBe(MAX_RETRY_AFTER_MS);
  });

  it('leaves a wait under the cap as it is', () => {
    expect(retryAfterMs('3600', NOW)).toBe(3_600_000);
    expect(retryAfterMs('86400', NOW)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs('Wed, 25 Nov 2026 09:10:00 GMT', NOW)).toBe(600_000);
  });

  it('defers with a real deadline instead of throwing', () => {
    const decision = decideDeliveryRetry({
      kind: 'after_attempt',
      now: NOW,
      attempts: [{ kind: 'http_status', status: 429, retryAfter: '100000000000000' }],
    });
    expect(decision).toEqual({
      action: 'defer',
      outcome: 'retry',
      notBefore: '2026-11-26T09:00:00.000Z',
    });
  });
});
