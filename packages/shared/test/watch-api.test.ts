// The watch API's request schemas and the stored rules_json.
import { describe, expect, it } from 'vitest';
import { CreateWatchBody, NotificationsQuery, UpdateWatchBody, WatchRules } from '../src/index.ts';

describe('WatchRules (watch.rules_json)', () => {
  it('keeps a target price as Money, its currency beside its amount', () => {
    const rules = {
      targetPrice: { amountMinor: 8000, currency: 'CAD' },
      dropBasisPoints: null,
      restock: true,
    };
    expect(WatchRules.parse(rules)).toEqual(rules);
  });

  it.each([
    ['a target with no currency', { targetPrice: { amountMinor: 8000 } }],
    ['a target in currency unknown', { targetPrice: { amountMinor: 8000, currency: 'unknown' } }],
    ['a fractional amount', { targetPrice: { amountMinor: 80.5, currency: 'CAD' } }],
    ['a drop of 0', { dropBasisPoints: 0 }],
    ['a drop of 100%', { dropBasisPoints: 10000 }],
    ['an unknown key', { cooldown: 3600 }],
  ])('refuses %s', (_, change) => {
    const base = { targetPrice: null, dropBasisPoints: 500, restock: false };
    expect(WatchRules.safeParse({ ...base, ...change }).success).toBe(false);
  });
});

describe('request bodies', () => {
  it('a create body needs only the input and refuses a profile id', () => {
    expect(CreateWatchBody.parse({ input: 'Bambu Lab P1S' })).toEqual({ input: 'Bambu Lab P1S' });
    expect(CreateWatchBody.safeParse({ input: 'x', profileId: 2 }).success).toBe(false);
    expect(CreateWatchBody.safeParse({}).success).toBe(false);
  });

  it('an update body takes pause, rules and a reference, each optional', () => {
    expect(UpdateWatchBody.parse({})).toEqual({});
    expect(UpdateWatchBody.parse({ paused: true, referencePrice: null, restock: false })).toEqual({
      paused: true,
      referencePrice: null,
      restock: false,
    });
    expect(UpdateWatchBody.safeParse({ archived: true }).success).toBe(false);
  });

  it('the feed query coerces its numbers and bounds the page', () => {
    expect(NotificationsQuery.parse({ before: '12', limit: '20' })).toEqual({
      before: 12,
      limit: 20,
    });
    expect(NotificationsQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(NotificationsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(NotificationsQuery.safeParse({ before: '-1' }).success).toBe(false);
  });
});
