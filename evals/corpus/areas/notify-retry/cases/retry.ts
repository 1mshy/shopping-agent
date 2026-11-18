import type {
  AttemptResult,
  NotifyRetryCase,
  NotifyRetryDecision,
  NotifyRetryInput,
} from '../contract.ts';

const TN = 'pricewatch/tests/test_notify.py';
const N = 'pricewatch/src/pricewatch/notify/__init__.py';
const B = 'pricewatch/src/pricewatch/notify/base.py';
const RUN = 'offline run of notify/__init__.py:52 dispatch with fake channels, sleep recorded';
const SPEC_RETRY = {
  how: 'spec',
  ref: 'S§5.11 Retry policy: "transport errors and 408/425/429/5xx retry at 2/5/15 s and honour Retry-After; a delay over 30 s defers to the next outbox pass; auth and payload errors fail at once."',
} as const;

const NOW = '2026-11-17T09:30:00.000Z';
const plus = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

const after = (...attempts: AttemptResult[]): NotifyRetryInput => ({
  kind: 'after_attempt',
  now: NOW,
  attempts,
});
const dns: AttemptResult = { kind: 'transport_error', cause: 'dns' };
const connect: AttemptResult = { kind: 'transport_error', cause: 'connect' };
const status = (code: number, retryAfter: string | null = null): AttemptResult => ({
  kind: 'http_status',
  status: code,
  retryAfter,
});

const wait = (ms: number): NotifyRetryDecision => ({
  action: 'wait_and_retry',
  outcome: 'retry',
  waitMs: ms,
});
const ACCEPTED: NotifyRetryDecision = { action: 'accepted', outcome: 'accepted' };
const FAIL: NotifyRetryDecision = { action: 'fail', outcome: 'failed' };
const deferUntil = (notBefore: string | null): NotifyRetryDecision => ({
  action: 'defer',
  outcome: 'retry',
  notBefore,
});

const RETRYABLE = [408, 425, 429, 500, 502, 503, 504] as const;
const PERMANENT = [400, 401, 403, 404, 413] as const;

export const retryCases: readonly NotifyRetryCase[] = [
  {
    id: 'accepted-on-the-first-attempt',
    what: 'A channel that accepts at once is accepted, whatever another channel is doing',
    input: after({ kind: 'accepted' }),
    expected: ACCEPTED,
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:155 test_retry_after_is_respected_without_blocking_other_channels (good: "sent" after 1 call while the other waited 7 s)`,
      },
    ],
    notes: "The decision is per delivery: the slow channel's Retry-After is not an input here.",
  },
  {
    id: 'first-transport-error-retries-after-2-s',
    what: 'A DNS failure is retried after 2 s',
    input: after(dns),
    expected: wait(2000),
    from: [
      {
        how: 'offline-run',
        ref: `${RUN}: [ConnectError, OSError, ok] → sleeps [2, 5], "sent", 3 calls`,
      },
      SPEC_RETRY,
    ],
  },
  {
    id: 'second-transport-error-retries-after-5-s',
    what: 'A second transport failure is retried after 5 s',
    input: after(dns, connect),
    expected: wait(5000),
    from: [
      { how: 'offline-run', ref: `${RUN}: [ConnectError, OSError, ok] → sleeps [2, 5]` },
      SPEC_RETRY,
    ],
  },
  {
    id: 'accepted-after-two-transport-errors',
    what: 'DNS down, then connect refused, then accepted: the delivery is accepted on the third attempt',
    input: after(dns, connect, { kind: 'accepted' }),
    expected: ACCEPTED,
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:107 test_dispatch_retries_dns_and_connect_failures ({"flaky": "sent"}, calls == 3)`,
      },
      SPEC_RETRY,
    ],
    notes:
      'The test\'s first error is httpx.ConnectError("[Errno -5] No address associated with hostname"), the 2026-09-09 dark-wake failure.',
  },
  {
    id: 'third-transport-error-retries-after-15-s',
    what: 'A third transport failure is retried after 15 s',
    input: after(dns, dns, dns),
    expected: wait(15000),
    from: [
      { how: 'offline-run', ref: `${RUN}: [down × 3, ok] → sleeps [2, 5, 15], "sent", 4 calls` },
      SPEC_RETRY,
    ],
  },
  {
    id: 'fourth-transport-error-ends-the-pass-pending',
    what: 'After the third retry also fails, the pass gives up but the delivery stays pending',
    input: after(dns, dns, dns, dns),
    expected: deferUntil(null),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:121 test_dispatch_gives_up_after_the_retry_budget (calls == 4, "error: down")`,
      },
      { how: 'offline-run', ref: `${RUN}: [down × 4] → sleeps [2, 5, 15], "error: down"` },
      {
        how: 'function-reading',
        ref: 'pricewatch/src/pricewatch/service.py:1313-1319 (an undelivered alert leaves the watch armed; the next sweep sends again)',
      },
    ],
    specSilent: true,
    notes:
      'S§5.11 does not say what follows the 15 s retry. The predecessor returned an error for that dispatch and, because nothing was accepted, sent again on the next sweep; with an outbox that is the delivery staying pending for the next pass (no provider deadline).',
  },
  {
    id: 'timeout-is-retried-as-a-transport-error',
    what: 'A request timeout counts as a transport error',
    input: after({ kind: 'transport_error', cause: 'timeout' }),
    expected: wait(2000),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:128 test_transient_classifies_transport_errors_only (ReadTimeout, ConnectError, OSError transient)`,
      },
      { how: 'offline-run', ref: `${RUN}: [asyncio.TimeoutError, ok] → sleeps [2], "sent"` },
      SPEC_RETRY,
    ],
  },
  ...RETRYABLE.map(
    (code): NotifyRetryCase => ({
      id: `status-${code}-retries-after-2-s`,
      what: `A provider answering ${code} is retried after 2 s`,
      input: after(status(code)),
      expected: wait(2000),
      from: [
        {
          how: 'test-assertion',
          ref: `${TN}:142 test_dispatch_retries_temporary_provider_failures[${code}] ("sent" after 2 calls)`,
        },
        SPEC_RETRY,
      ],
    }),
  ),
  {
    id: 'status-501-retries-as-a-5xx',
    what: 'A 501 is a 5xx and is retried',
    input: after(status(501)),
    expected: wait(2000),
    from: [
      {
        how: 'function-reading',
        ref: `${N}:41 transient (status in (408, 425, 429, 500, 502, 503, 504))`,
      },
      { how: 'offline-run', ref: `${RUN}: [DeliveryError 501] → "error: ntfy 501: t", 1 call` },
      SPEC_RETRY,
    ],
    divergence:
      'The predecessor retried only 500, 502, 503 and 504 among 5xx, so a 501 failed at once. S§5.11 says 5xx retry.',
  },
  ...PERMANENT.map(
    (code): NotifyRetryCase => ({
      id: `status-${code}-fails-at-once`,
      what: `A provider answering ${code} fails without a retry`,
      input: after(status(code)),
      expected: FAIL,
      from: [
        {
          how: 'test-assertion',
          ref: `${TN}:149 test_dispatch_does_not_retry_permanent_provider_failures[${code}] (error, 1 call)`,
        },
        SPEC_RETRY,
      ],
    }),
  ),
  {
    id: 'unclassified-error-fails-at-once',
    what: 'An error with no status attached fails at once, even if its text mentions 429',
    input: after({ kind: 'unclassified_error' }),
    expected: FAIL,
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:114 test_dispatch_does_not_retry_an_http_status (RuntimeError("ntfy 429: too many requests") → error, 1 call)`,
      },
      {
        how: 'test-assertion',
        ref: `${TN}:128 test_transient_classifies_transport_errors_only (RuntimeError, ValueError not transient)`,
      },
    ],
    specSilent: true,
    notes:
      'S§5.11 names transport, status and auth/payload errors only. The predecessor never retried an error it could not classify.',
  },
  {
    id: 'retry-after-7-s-is-honoured',
    what: 'A 429 with Retry-After: 7 waits 7 s before the retry',
    input: after(status(429, '7')),
    expected: wait(7000),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:155 test_retry_after_is_respected_without_blocking_other_channels (waits == [7])`,
      },
      SPEC_RETRY,
    ],
  },
  {
    id: 'retry-after-of-exactly-30-s-still-waits',
    what: 'Retry-After: 30 is not over 30 s, so the pass waits',
    input: after(status(429, '30')),
    expected: wait(30000),
    from: [
      {
        how: 'function-reading',
        ref: `${N}:73 dispatch (defer only if delay > MAX_RETRY_DELAY = 30)`,
      },
      { how: 'offline-run', ref: `${RUN}: [429 Retry-After "30", ok] → sleeps [30.0], "sent"` },
      SPEC_RETRY,
    ],
  },
  {
    id: 'retry-after-of-31-s-defers',
    what: 'Retry-After: 31 is over 30 s, so the delivery is deferred to a later pass, not before the deadline',
    input: after(status(429, '31')),
    expected: deferUntil(plus(31)),
    from: [
      {
        how: 'offline-run',
        ref: `${RUN}: [429 Retry-After "31"] → "error: …; retry deferred", 1 call, no sleep`,
      },
      SPEC_RETRY,
    ],
  },
  {
    id: 'retry-after-of-an-hour-defers',
    what: 'Retry-After: 3600 defers the delivery for an hour',
    input: after(status(429, '3600')),
    expected: deferUntil(plus(3600)),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:169 test_long_retry_after_defers_until_a_later_sweep ("deferred", 1 call)`,
      },
      SPEC_RETRY,
    ],
  },
  {
    id: 'deferred-delivery-is-not-attempted-before-its-deadline',
    what: "One second before the provider's deadline the deferred delivery is not tried",
    input: { kind: 'due', now: plus(3599), nextAttemptAt: plus(3600) },
    expected: { action: 'not_due' },
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:169 test_long_retry_after_defers_until_a_later_sweep (a second sweep before the deadline: "deferred", calls still 1)`,
      },
      {
        how: 'offline-run',
        ref: `${RUN}: deferred at monotonic 100 until 3700; at 3699 → "provider retry deferred for 1s", no call`,
      },
    ],
  },
  {
    id: 'deferred-delivery-is-attempted-at-its-deadline',
    what: "At the provider's deadline the deferred delivery is tried again",
    input: { kind: 'due', now: plus(3600), nextAttemptAt: plus(3600) },
    expected: { action: 'attempt' },
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:169 test_long_retry_after_defers_until_a_later_sweep (at 3701: "sent", calls == 2)`,
      },
      {
        how: 'offline-run',
        ref: `${RUN}: at monotonic 3700 exactly → attempted, "sent" (remaining 0 is not > 0)`,
      },
    ],
  },
  {
    id: 'retry-after-below-the-base-delay-uses-the-base',
    what: 'Retry-After: 1 on the first retry still waits the 2 s base delay',
    input: after(status(503, '1')),
    expected: wait(2000),
    from: [
      {
        how: 'function-reading',
        ref: `${N}:68-70 dispatch (delay = max(RETRY_DELAYS[attempt − 1], retry_after))`,
      },
      { how: 'offline-run', ref: `${RUN}: [503 Retry-After "1", ok] → sleeps [2]` },
    ],
    notes:
      'Whether "honour Retry-After" means max(base, Retry-After) or Retry-After alone is open (report).',
  },
  {
    id: 'retry-after-above-the-base-on-the-second-retry',
    what: 'Retry-After: 20 on the second failure waits 20 s instead of 5 s',
    input: after(status(503), status(503, '20')),
    expected: wait(20000),
    from: [
      { how: 'offline-run', ref: `${RUN}: [503, 503 Retry-After "20", ok] → sleeps [2, 20.0]` },
      SPEC_RETRY,
    ],
  },
  {
    id: 'retry-after-as-an-http-date',
    what: 'Retry-After given as a date 20 s ahead waits 20 s',
    input: after(status(503, 'Tue, 17 Nov 2026 09:30:20 GMT')),
    expected: wait(20000),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:182 test_retry_after_http_date_and_invalid_value (a date 20 s ahead → 18 ≤ retry_after ≤ 20)`,
      },
      {
        how: 'function-reading',
        ref: `${B}:20-24 DeliveryError (parsedate_to_datetime, minus now)`,
      },
      SPEC_RETRY,
    ],
    notes:
      'The predecessor measured against the real clock, hence its 18-20 s tolerance; with now = 09:30:00 given, 09:30:20 − 09:30:00 = 20 s exactly. 2026-11-17 is a Tuesday.',
  },
  {
    id: 'invalid-retry-after-uses-the-base-delay',
    what: 'An unparsable Retry-After counts as none',
    input: after(status(503, 'invalid')),
    expected: wait(2000),
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:182 test_retry_after_http_date_and_invalid_value ("invalid" → retry_after 0)`,
      },
      { how: 'offline-run', ref: `${RUN}: [503 Retry-After "invalid", ok] → sleeps [2]` },
    ],
  },
  {
    id: 'retry-after-on-an-auth-error-is-ignored',
    what: 'A 401 fails at once even when it carries Retry-After',
    input: after(status(401, '5')),
    expected: FAIL,
    from: [
      { how: 'offline-run', ref: `${RUN}: [401 Retry-After "5"] → "error: ntfy 401: r", 1 call` },
      SPEC_RETRY,
    ],
  },
  {
    id: 'ntfy-503-then-200-is-accepted',
    what: 'A real ntfy answer of 503 then 200 ends accepted on the second attempt',
    input: after(status(503), { kind: 'accepted' }),
    expected: ACCEPTED,
    from: [
      {
        how: 'test-assertion',
        ref: `${TN}:190 test_real_ntfy_response_retries_then_succeeds ({"ntfy": "sent"}, 2 requests)`,
      },
      SPEC_RETRY,
    ],
    notes:
      'reports/2026-09-18-reliability.md: the actual notification transport received HTTP 503 then HTTP 200 in the freeze test.',
  },
];
