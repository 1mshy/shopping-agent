// The restock decision beyond the corpus: empty inputs, priceless reads, the watermark's edge,
// several cycles, ties and the refusals.
import type { Availability } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import type { AlertListingRead, AlertObservedRead } from '../../src/alerts/price-rules.ts';
import {
  evaluateRestock,
  type RestockInput,
  type RestockListing,
} from '../../src/alerts/restock.ts';

const at = (hhmm: string) => `2026-11-17T${hhmm}:00.000Z`;
const seen = (
  id: number,
  hhmm: string,
  availability: Availability,
  more: Partial<AlertObservedRead> = {},
): AlertObservedRead => ({
  kind: 'observation',
  observationId: id,
  observedAt: at(hhmm),
  currency: 'CAD',
  price: 11900,
  availability,
  readPath: 'platform_json',
  rung: 'api',
  ...more,
});

function input(
  listings: readonly RestockListing[],
  watch: Partial<RestockInput['watch']> = {},
): RestockInput {
  return {
    now: at('12:00'),
    watch: {
      currency: 'CAD',
      targetPrice: null,
      restockRuleOnSince: '2026-11-16T12:00:00.000Z',
      lastAcceptedRestockAt: null,
      ...watch,
    },
    listings,
  };
}
const one = (reads: readonly AlertListingRead[], watch: Partial<RestockInput['watch']> = {}) =>
  input([{ listingId: 11, reads }], watch);
const silence = (i: RestockInput) => {
  const d = evaluateRestock(i);
  return d.fire ? null : d.silence;
};

describe('evaluateRestock', () => {
  it('a watch with no listing, or a listing never read, has nothing in stock', () => {
    expect(silence(input([]))).toBe('not_in_stock');
    expect(silence(one([]))).toBe('not_in_stock');
  });

  it('the rule being off wins over everything', () => {
    expect(silence(input([], { restockRuleOnSince: null }))).toBe('rule_off');
  });

  it('a sold-out read with no price is not in stock; an in-stock one with no price is not comparable', () => {
    expect(silence(one([seen(1, '08:00', 'in'), seen(2, '09:00', 'out', { price: null })]))).toBe(
      'not_in_stock',
    );
    expect(silence(one([seen(1, '08:00', 'out'), seen(2, '09:00', 'in', { price: null })]))).toBe(
      'not_comparable',
    );
  });

  it('a watch with no currency yet compares nothing', () => {
    expect(
      silence(one([seen(1, '08:00', 'out'), seen(2, '09:00', 'in')], { currency: null })),
    ).toBe('not_comparable');
  });

  it('a transition at exactly the watermark is not later than it', () => {
    const reads = [seen(1, '08:00', 'out'), seen(2, '09:00', 'in')];
    expect(silence(one(reads, { lastAcceptedRestockAt: at('09:00') }))).toBe('already_told');
    expect(
      evaluateRestock(one(reads, { lastAcceptedRestockAt: '2026-11-17T08:59:59.999Z' })).fire,
    ).toBe(true);
  });

  it('names the latest read and the last transition when the listing stayed in stock', () => {
    const reads = [
      seen(1, '08:00', 'out'),
      seen(2, '09:00', 'in'),
      seen(3, '10:00', 'in', { price: 11500 }),
    ];
    expect(evaluateRestock(one(reads))).toEqual({
      fire: true,
      listingId: 11,
      observationId: 3,
      price: { amountMinor: 11500, currency: 'CAD' },
      transitionAt: at('09:00'),
      targetReached: false,
    });
  });

  it('a first sighting followed by sold out and back is a transition', () => {
    const reads = [seen(1, '08:00', 'in'), seen(2, '09:00', 'out'), seen(3, '10:00', 'in')];
    expect(evaluateRestock(one(reads))).toMatchObject({ fire: true, transitionAt: at('10:00') });
  });

  it('a listing first seen in stock after only unknown and failed reads is a first sighting', () => {
    const reads: AlertListingRead[] = [
      seen(1, '08:00', 'unknown'),
      { kind: 'failed', at: at('08:30'), rung: 'http' },
      seen(2, '09:00', 'in'),
    ];
    expect(silence(one(reads))).toBe('first_sighting');
  });

  it('at an equal price the first listing in input order is named', () => {
    const back = (id: number) => [seen(id * 10, '08:00', 'out'), seen(id * 10 + 1, '09:00', 'in')];
    const decided = evaluateRestock(
      input([
        { listingId: 1, reads: back(1) },
        { listingId: 2, reads: back(2) },
      ]),
    );
    expect(decided).toMatchObject({ fire: true, listingId: 1 });
  });

  it('a silent first listing does not stop a later one from firing', () => {
    const decided = evaluateRestock(
      input([
        { listingId: 1, reads: [seen(10, '08:00', 'in')] },
        { listingId: 2, reads: [seen(20, '08:00', 'out'), seen(21, '09:00', 'in')] },
      ]),
    );
    expect(decided).toMatchObject({ fire: true, listingId: 2 });
  });

  it('a target in another currency is not reached; the target is inclusive', () => {
    const reads = [seen(1, '08:00', 'out'), seen(2, '09:00', 'in')];
    const usd = { amountMinor: 99999, currency: 'USD' } as const;
    expect(evaluateRestock(one(reads, { targetPrice: usd }))).toMatchObject({
      targetReached: false,
    });
    const cad = { amountMinor: 11900, currency: 'CAD' } as const;
    expect(evaluateRestock(one(reads, { targetPrice: cad }))).toMatchObject({
      targetReached: true,
    });
  });

  it('refuses reads out of order, a read after now and a negative price', () => {
    expect(() => evaluateRestock(one([seen(2, '09:00', 'in'), seen(1, '08:00', 'out')]))).toThrow(
      RangeError,
    );
    expect(() => evaluateRestock(one([seen(1, '13:00', 'in')]))).toThrow(RangeError);
    expect(() => evaluateRestock(one([seen(1, '08:00', 'in', { price: -1 })]))).toThrow(RangeError);
  });
});
