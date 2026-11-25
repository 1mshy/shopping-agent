import { describe, expect, it } from 'vitest';
import {
  type Admission,
  createLoginThrottle,
  LOGIN_THROTTLE_GLOBAL,
  LOGIN_THROTTLE_PER_CLIENT,
} from '../../src/auth/index.ts';
import { Clock } from './harness.ts';

function admitted(a: Admission) {
  if (!a.admitted) throw new Error(`refused for ${a.retryAfterMs} ms`);
  return a.ticket;
}

function failOnce(throttle: ReturnType<typeof createLoginThrottle>, client: string): void {
  admitted(throttle.admit(client)).fail();
}

describe('the login throttle, per client', () => {
  it('lets 5 failures through, then locks for 1 s, 2 s, 4 s … up to 15 min', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < 5; i++) failOnce(throttle, 'a');
    // The 6th attempt is admitted; its failure starts the first lockout.
    failOnce(throttle, 'a');
    expect(throttle.admit('a')).toEqual({ admitted: false, retryAfterMs: 1_000 });
    clock.advance(1_000);
    failOnce(throttle, 'a');
    expect(throttle.admit('a')).toEqual({ admitted: false, retryAfterMs: 2_000 });
    clock.advance(2_000);
    failOnce(throttle, 'a');
    expect(throttle.admit('a')).toEqual({ admitted: false, retryAfterMs: 4_000 });
    for (let i = 0; i < 20; i++) {
      const a = throttle.admit('a');
      if (!a.admitted) clock.advance(a.retryAfterMs);
      else a.ticket.fail();
    }
    const last = throttle.admit('a');
    expect(last).toEqual({ admitted: false, retryAfterMs: 15 * 60_000 });
  });

  it('refuses during a lockout without counting the refused attempt', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < 6; i++) failOnce(throttle, 'a');
    for (let i = 0; i < 50; i++) expect(throttle.admit('a').admitted).toBe(false);
    clock.advance(1_000);
    // Still the 7th failure, so 2 s, not more.
    failOnce(throttle, 'a');
    expect(throttle.admit('a')).toEqual({ admitted: false, retryAfterMs: 2_000 });
  });

  it('keeps clients apart, and a success clears the client', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < 6; i++) failOnce(throttle, 'a');
    expect(throttle.admit('a').admitted).toBe(false);
    admitted(throttle.admit('b')).succeed();
    clock.advance(1_000);
    admitted(throttle.admit('a')).succeed();
    for (let i = 0; i < 5; i++) failOnce(throttle, 'a');
    expect(throttle.admit('a').admitted).toBe(true);
  });

  it('forgets a client after 24 h without a failure', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < 8; i++) {
      const a = throttle.admit('a');
      if (!a.admitted) clock.advance(a.retryAfterMs);
      else a.ticket.fail();
    }
    clock.advance(LOGIN_THROTTLE_PER_CLIENT.forgetMs);
    for (let i = 0; i < 5; i++) failOnce(throttle, 'a');
    expect(throttle.admit('a').admitted).toBe(true);
  });
});

describe('the login throttle, globally', () => {
  it('locks every client after 20 failures across addresses', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < LOGIN_THROTTLE_GLOBAL.free + 1; i++) failOnce(throttle, `client-${i}`);
    expect(throttle.admit('a-fresh-address')).toEqual({ admitted: false, retryAfterMs: 1_000 });
  });

  it('refunds a successful attempt, so the owner signing in does not feed the lockout', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    for (let i = 0; i < LOGIN_THROTTLE_GLOBAL.free; i++)
      admitted(throttle.admit(`c${i}`)).succeed();
    for (let i = 0; i < LOGIN_THROTTLE_GLOBAL.free; i++) failOnce(throttle, `d${i}`);
    // 20 failures: still free. The 21st attempt succeeds: no lockout from it.
    admitted(throttle.admit('owner')).succeed();
    expect(throttle.admit('owner').admitted).toBe(true);
  });
});

describe('concurrency', () => {
  it('counts an attempt from its start, so a burst cannot all slip in before the first failure', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now, maxInFlight: 100 });
    const burst = Array.from({ length: 50 }, () => throttle.admit('a'));
    expect(burst.filter((a) => a.admitted)).toHaveLength(6);
  });

  it('runs at most two verifications at once', () => {
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    const one = admitted(throttle.admit('a'));
    admitted(throttle.admit('b'));
    expect(throttle.admit('c')).toEqual({ admitted: false, retryAfterMs: 1_000 });
    one.fail();
    expect(throttle.admit('c').admitted).toBe(true);
  });
});
