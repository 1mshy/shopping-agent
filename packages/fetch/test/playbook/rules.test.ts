// The playbook's rules (S§5.1 "Typed outcome", S§4.1 host_access): what may change it, what a 404
// never does, the 24 h success hint and the growing back-off.
import type { FetchOutcome } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  advise,
  backoffFor,
  closedUntil,
  NEGATIVE_BACKOFF_MS,
  type PlaybookEntry,
  recordOutcome,
  SUCCESS_HINT_TTL_MS,
} from '../../src/playbook/index.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const key = { host: 'shop.test', pageKind: 'product' } as const;

const ok: FetchOutcome = { kind: 'ok', rung: 'http' };
const wall: FetchOutcome = { kind: 'wall', rung: 'http', vendor: 'cloudflare', mode: 'challenge' };
const empty: FetchOutcome = { kind: 'empty', rung: 'http' };

/** Every outcome that must leave the playbook as it is. */
const NEUTRAL: FetchOutcome[] = [
  { kind: 'not_found', rung: 'http' },
  { kind: 'rate_limited', rung: 'http', retryAfterMs: 30_000 },
  { kind: 'rate_limited', rung: 'http', retryAfterMs: null },
  { kind: 'server_error', rung: 'http' },
  { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
  { kind: 'login_required', rung: 'http' },
  { kind: 'payment_required', rung: 'http' },
  ...(
    [
      'scheme',
      'url_form',
      'private_address',
      'body_size',
      'robots',
      'host_limit',
      'budget',
    ] as const
  ).map((reason): FetchOutcome => ({ kind: 'refused_by_policy', rung: 'http', reason })),
];

function apply(outcomes: FetchOutcome[], start: PlaybookEntry | null = null, step = 0) {
  let entry = start;
  let now = T0;
  for (const outcome of outcomes) {
    entry = recordOutcome(entry, key, outcome, now) ?? entry;
    now += step;
  }
  return entry;
}

describe('recordOutcome', () => {
  it('records a success as a hint on its rung that expires after 24 h', () => {
    expect(recordOutcome(null, key, ok, T0)).toEqual({
      host: 'shop.test',
      pageKind: 'product',
      rung: 'http',
      lastOutcome: 'ok',
      wallVendor: null,
      expiresAt: T0 + 24 * HOUR,
      backoffUntil: null,
      attempts: 0,
    });
    expect(SUCCESS_HINT_TTL_MS).toBe(24 * HOUR);
  });

  it('records a wall with its vendor and backs off', () => {
    expect(recordOutcome(null, key, wall, T0)).toEqual({
      host: 'shop.test',
      pageKind: 'product',
      rung: 'http',
      lastOutcome: 'wall',
      wallVendor: 'cloudflare',
      expiresAt: null,
      backoffUntil: T0 + 5 * MIN,
      attempts: 1,
    });
    const unnamed = recordOutcome(null, key, { ...wall, vendor: null }, T0);
    expect(unnamed?.wallVendor).toBeNull();
  });

  it('backs off on a growing schedule, capped, for consecutive negatives', () => {
    expect(NEGATIVE_BACKOFF_MS).toEqual([5 * MIN, 15 * MIN, HOUR, 3 * HOUR, 6 * HOUR]);
    let entry: PlaybookEntry | null = null;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const now = T0 + i * 7 * HOUR;
      entry = recordOutcome(entry, key, i % 2 === 0 ? wall : empty, now);
      seen.push((entry?.backoffUntil ?? 0) - now);
      expect(entry?.attempts).toBe(i + 1);
    }
    expect(seen).toEqual([
      5 * MIN,
      15 * MIN,
      HOUR,
      3 * HOUR,
      6 * HOUR,
      6 * HOUR,
      6 * HOUR,
      6 * HOUR,
    ]);
    expect(backoffFor(1)).toBe(5 * MIN);
    expect(backoffFor(1_000)).toBe(6 * HOUR);
    expect(() => backoffFor(0)).toThrow(RangeError);
  });

  it('treats empty as a negative verdict with no vendor', () => {
    const entry = recordOutcome(null, key, empty, T0);
    expect(entry).toMatchObject({ lastOutcome: 'empty', wallVendor: null, attempts: 1 });
    expect(entry?.backoffUntil).toBe(T0 + 5 * MIN);
  });

  it('resets the count on a success', () => {
    const walled = apply([wall, wall, wall], null, HOUR);
    expect(walled?.attempts).toBe(3);
    const after = recordOutcome(walled, key, ok, T0 + 10 * HOUR);
    expect(after).toMatchObject({ lastOutcome: 'ok', attempts: 0, backoffUntil: null });
    expect(recordOutcome(after, key, wall, T0 + 11 * HOUR)?.backoffUntil).toBe(
      T0 + 11 * HOUR + 5 * MIN,
    );
  });

  it('starts the count afresh when the negative is on another rung', () => {
    const apiEmpty = recordOutcome(null, key, { kind: 'empty', rung: 'api' }, T0);
    const twice = recordOutcome(apiEmpty, key, { kind: 'empty', rung: 'api' }, T0 + HOUR);
    expect(twice?.attempts).toBe(2);
    const httpWall = recordOutcome(twice, key, wall, T0 + 2 * HOUR);
    expect(httpWall).toMatchObject({ rung: 'http', lastOutcome: 'wall', attempts: 1 });
  });

  it('never changes on any outcome but ok, wall and empty', () => {
    const hint = recordOutcome(null, key, ok, T0);
    const walled = recordOutcome(null, key, wall, T0);
    for (const outcome of NEUTRAL) {
      expect(recordOutcome(null, key, outcome, T0 + HOUR)).toBeNull();
      expect(recordOutcome(hint, key, outcome, T0 + HOUR)).toBeNull();
      expect(recordOutcome(walled, key, outcome, T0 + HOUR)).toBeNull();
    }
  });

  it('never moves a rung on a 404, on any rung', () => {
    const hint = recordOutcome(null, key, ok, T0);
    expect(recordOutcome(hint, key, { kind: 'not_found', rung: 'api' }, T0 + 1)).toBeNull();
    const walled = recordOutcome(null, key, wall, T0);
    expect(recordOutcome(walled, key, { kind: 'not_found', rung: 'http' }, T0 + 1)).toBeNull();
  });

  it('never improves on a failed read: only ok clears a negative verdict', () => {
    const walled = recordOutcome(null, key, wall, T0);
    const thenEmpty = recordOutcome(walled, key, empty, T0 + HOUR);
    expect(thenEmpty).toMatchObject({ lastOutcome: 'empty', attempts: 2 });
    expect(thenEmpty?.backoffUntil).toBe(T0 + HOUR + 15 * MIN);
  });

  it('refuses an entry for another host or page kind', () => {
    const other = recordOutcome(null, { host: 'other.test', pageKind: 'product' }, ok, T0);
    expect(() => recordOutcome(other, key, ok, T0)).toThrow(RangeError);
  });
});

describe('advise and closedUntil', () => {
  const ladder = ['http'] as const;

  it('starts on the first rung with no entry, and on the hint while it holds', () => {
    expect(advise(null, ['api', 'http'], T0)).toEqual({ kind: 'start', rung: 'api' });
    const hint = recordOutcome(null, key, ok, T0);
    expect(advise(hint, ['api', 'http'], T0 + HOUR)).toEqual({ kind: 'start', rung: 'http' });
  });

  it('forgets a success hint after 24 h', () => {
    const hint = recordOutcome(null, key, ok, T0);
    expect(advise(hint, ['api', 'http'], T0 + 24 * HOUR - 1)).toEqual({
      kind: 'start',
      rung: 'http',
    });
    expect(advise(hint, ['api', 'http'], T0 + 24 * HOUR)).toEqual({ kind: 'start', rung: 'api' });
  });

  it('says "do not try until T" for a walled top rung that is backing off', () => {
    const walled = recordOutcome(null, key, wall, T0);
    expect(advise(walled, ladder, T0 + MIN)).toEqual({ kind: 'wait', until: T0 + 5 * MIN });
    expect(advise(walled, ladder, T0 + 5 * MIN)).toEqual({ kind: 'start', rung: 'http' });
    expect(closedUntil(walled, 'http', T0 + MIN)).toBe(T0 + 5 * MIN);
    expect(closedUntil(walled, 'http', T0 + 5 * MIN)).toBeNull();
  });

  it('leaves the ladder open: a rung above the walled one is tried while it backs off', () => {
    const walled = recordOutcome(null, key, wall, T0);
    expect(advise(walled, ['http', 'browser'], T0 + MIN)).toEqual({
      kind: 'start',
      rung: 'browser',
    });
    expect(closedUntil(walled, 'browser', T0 + MIN)).toBeNull();
    expect(closedUntil(walled, 'api', T0 + MIN)).toBeNull();
  });

  it('closes no rung on a success hint', () => {
    expect(closedUntil(recordOutcome(null, key, ok, T0), 'http', T0)).toBeNull();
    expect(closedUntil(null, 'http', T0)).toBeNull();
  });

  it('refuses an empty ladder', () => {
    expect(() => advise(null, [], T0)).toThrow(RangeError);
  });
});
