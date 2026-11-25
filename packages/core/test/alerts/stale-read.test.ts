// Stale and failed reads beyond the corpus: priceless reads, reads at the same instant or out of
// order, inconsistent state, and the ranking tiers of the watch's shown price.
import type { Availability } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  applyRead,
  type ListingReadResult,
  type ListingReadState,
  showWatchPrice,
} from '../../src/alerts/stale-read.ts';

const at = (hhmm: string) => `2026-11-17T${hhmm}:00.000Z`;
const cad = (amountMinor: number) => ({ amountMinor, currency: 'CAD' }) as const;

function state(
  price: number,
  observedAt: string,
  availability: Availability = 'in',
  failedSince: string | null = null,
  errors = 0,
): ListingReadState {
  return {
    lastPrice: { price: cad(price), observationId: 1, observedAt },
    lastKnownAvailability: availability,
    lastReadAt: failedSince ?? observedAt,
    lastReadFailed: errors > 0,
    consecutiveErrors: errors,
  };
}

const observed = (
  hhmm: string,
  price: number | null,
  availability: Availability = 'in',
): ListingReadResult => ({
  kind: 'observed',
  observationId: 2,
  at: at(hhmm),
  currency: 'CAD',
  price,
  availability,
  readPath: 'json_ld',
  rung: 'http',
});

describe('applyRead', () => {
  it('a sold-out read with no price writes an observation, resets errors and keeps the old price, shown stale', () => {
    const result = applyRead({
      state: state(9000, at('06:00'), 'in', at('09:00'), 3),
      read: observed('09:30', null, 'out'),
    });
    expect(result).toEqual({
      state: {
        lastPrice: { price: cad(9000), observationId: 1, observedAt: at('06:00') },
        lastKnownAvailability: 'out',
        lastReadAt: at('09:30'),
        lastReadFailed: false,
        consecutiveErrors: 0,
      },
      writesObservation: true,
      evaluatesAlerts: true,
      shown: { freshness: 'stale', price: cad(9000), asOf: at('06:00'), availability: 'out' },
    });
  });

  it('a first read with a price and unknown stock leaves the stock unknown', () => {
    const result = applyRead({ state: null, read: observed('09:00', 500, 'unknown') });
    expect(result.state.lastKnownAvailability).toBe('unknown');
    expect(result.shown).toEqual({
      freshness: 'current',
      price: cad(500),
      asOf: at('09:00'),
      availability: 'unknown',
    });
  });

  it('a read at the same instant as the last one is applied after it', () => {
    const result = applyRead({ state: state(9000, at('09:00')), read: observed('09:00', 8000) });
    expect(result.shown).toMatchObject({ freshness: 'current', price: cad(8000) });
  });

  it('failed reads keep counting and never touch the price or its time', () => {
    let s = state(9000, at('06:00'));
    for (const [i, hhmm] of ['07:00', '08:00', '09:00'].entries()) {
      const result = applyRead({
        state: s,
        read: { kind: 'failed', at: at(hhmm), cause: 'network_error', rung: 'http' },
      });
      s = result.state;
      expect(s.consecutiveErrors).toBe(i + 1);
      expect(result.shown).toEqual({
        freshness: 'stale',
        price: cad(9000),
        asOf: at('06:00'),
        availability: 'in',
      });
    }
  });

  it('refuses a read older than the last read, an inconsistent state and a negative price', () => {
    expect(() =>
      applyRead({ state: state(9000, at('09:00')), read: observed('08:59', 1) }),
    ).toThrow(RangeError);
    const inconsistent = { ...state(9000, at('09:00')), lastReadFailed: true };
    expect(() => applyRead({ state: inconsistent, read: observed('10:00', 1) })).toThrow(
      RangeError,
    );
    const priceAfterRead = { ...state(9000, at('09:00')), lastReadAt: at('08:00') };
    expect(() => applyRead({ state: priceAfterRead, read: observed('10:00', 1) })).toThrow(
      RangeError,
    );
    expect(() => applyRead({ state: null, read: observed('10:00', -1) })).toThrow(RangeError);
  });
});

describe('showWatchPrice', () => {
  const list = (...states: ListingReadState[]) => ({
    watchCurrency: 'CAD' as const,
    listings: states.map((s, i) => ({ listingId: i + 1, state: s })),
  });

  it('no listing, or none with a price, shows nothing', () => {
    expect(showWatchPrice(list())).toEqual({ best: null });
    const never: ListingReadState = {
      lastPrice: null,
      lastKnownAvailability: 'unknown',
      lastReadAt: at('09:00'),
      lastReadFailed: true,
      consecutiveErrors: 1,
    };
    expect(showWatchPrice(list(never))).toEqual({ best: null });
  });

  it('a current sold-out price gives way to a stale price not known to be out', () => {
    const decided = showWatchPrice(
      list(state(8000, at('09:00'), 'out'), state(9000, at('06:00'), 'in', at('09:00'), 2)),
    );
    expect(decided.best).toMatchObject({ listingId: 2, shown: { freshness: 'stale' } });
  });

  it('unknown stock is not known to be out', () => {
    const decided = showWatchPrice(
      list(state(9000, at('09:00'), 'unknown'), state(8000, at('09:00'), 'out')),
    );
    expect(decided.best).toMatchObject({ listingId: 1, shown: { freshness: 'current' } });
  });

  it('at an equal price current wins over stale, then input order', () => {
    const stale = state(9000, at('06:00'), 'out', at('09:00'), 1);
    const current = state(9000, at('09:00'), 'out');
    expect(showWatchPrice(list(stale, current)).best?.listingId).toBe(2);
    expect(showWatchPrice(list(current, current)).best?.listingId).toBe(1);
  });

  it('the cheapest current in-stock price wins', () => {
    const decided = showWatchPrice(list(state(9000, at('09:00')), state(8999, at('08:00'))));
    expect(decided.best?.listingId).toBe(2);
  });
});
