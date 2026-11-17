import { describe, expect, it } from 'vitest';
import {
  changesPlaybook,
  countsAgainstHealth,
  FETCH_OUTCOME_KINDS,
  FetchOutcome,
  MarketplaceOutcome,
} from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const outcomes = [
  { kind: 'ok', rung: 'http' },
  { kind: 'not_found', rung: 'api' },
  { kind: 'wall', rung: 'browser', vendor: 'cloudflare', mode: 'captcha' },
  { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' },
  { kind: 'rate_limited', rung: 'http', retryAfterMs: 30000 },
  { kind: 'rate_limited', rung: 'api', retryAfterMs: null },
  { kind: 'payment_required', rung: 'http' },
  { kind: 'login_required', rung: 'browser' },
  { kind: 'empty', rung: 'http' },
  { kind: 'server_error', rung: 'http' },
  { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
  { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
];

describe('FetchOutcome (S§5.1)', () => {
  it('accepts every kind with its payload', () => {
    for (const outcome of outcomes) expectValid(FetchOutcome, outcome);
    expect(new Set(outcomes.map((o) => o.kind))).toEqual(new Set(FETCH_OUTCOME_KINDS));
  });

  it('refuses unknown kinds, missing or extra payload and a missing rung', () => {
    expectRefused(FetchOutcome, { kind: 'timeout', rung: 'http' }, 'kind');
    expectRefused(FetchOutcome, { kind: 'wall', rung: 'http', vendor: 'akamai' }, 'mode');
    expectRefused(FetchOutcome, { kind: 'ok', rung: 'http', price: 199.99 }, '');
    expectRefused(FetchOutcome, { kind: 'not_found', rung: 'http', vendor: 'akamai' }, '');
    expectRefused(FetchOutcome, { kind: 'ok' }, 'rung');
    expectRefused(FetchOutcome, { kind: 'network_error', rung: 'http', code: '' }, 'code');
  });

  it('takes the wall mode from the browser rung sentence and the reason from the guard', () => {
    for (const mode of ['challenge', 'captcha', 'access_denied']) {
      expectValid(FetchOutcome, { kind: 'wall', rung: 'browser', vendor: null, mode });
    }
    expectRefused(
      FetchOutcome,
      { kind: 'wall', rung: 'http', vendor: null, mode: 'login' },
      'mode',
    );
    for (const reason of [
      'scheme',
      'private_address',
      'body_size',
      'robots',
      'host_limit',
      'budget',
    ]) {
      expectValid(FetchOutcome, { kind: 'refused_by_policy', rung: 'http', reason });
    }
    expectRefused(
      FetchOutcome,
      { kind: 'refused_by_policy', rung: 'http', reason: 'other' },
      'reason',
    );
    expectRefused(
      FetchOutcome,
      { kind: 'rate_limited', rung: 'http', retryAfterMs: -1 },
      'retryAfterMs',
    );
    expectRefused(
      FetchOutcome,
      { kind: 'rate_limited', rung: 'http', retryAfterMs: 1.5 },
      'retryAfterMs',
    );
  });

  it('lets only ok, wall and empty change the playbook', () => {
    const changing = outcomes.filter((o) => changesPlaybook(FetchOutcome.parse(o)));
    expect(new Set(changing.map((o) => o.kind))).toEqual(new Set(['ok', 'wall', 'empty']));
  });
});

describe('MarketplaceOutcome (S§5.9)', () => {
  const all = [
    { kind: 'ok' },
    { kind: 'blocked' },
    { kind: 'rate_limited', retryAfterMs: 600000 },
    { kind: 'needs_person' },
    { kind: 'not_configured', missing: ['user_key'] },
    { kind: 'parse_error' },
  ];

  it('accepts every kind', () => {
    for (const outcome of all) expectValid(MarketplaceOutcome, outcome);
  });

  it('names what a not-configured adapter is missing, and nothing else', () => {
    expectRefused(MarketplaceOutcome, { kind: 'not_configured', missing: [] }, 'missing');
    expectRefused(
      MarketplaceOutcome,
      { kind: 'not_configured', missing: ['api_key'] },
      'missing.0',
    );
    expectRefused(
      MarketplaceOutcome,
      { kind: 'not_configured', missing: ['session', 'session'] },
      'missing',
    );
    expectRefused(MarketplaceOutcome, { kind: 'broken' }, 'kind');
    expectRefused(MarketplaceOutcome, { kind: 'ok', listings: 3 }, '');
  });

  it('counts only parse_error against adapter health', () => {
    const counted = all.filter((o) => countsAgainstHealth(MarketplaceOutcome.parse(o)));
    expect(counted.map((o) => o.kind)).toEqual(['parse_error']);
  });
});
