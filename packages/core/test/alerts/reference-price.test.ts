// The reference price beyond the corpus: currency adoption with a user price, several foreign
// currencies, the preference within a currency, unusable reads, exactness and the refusals.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  chooseReferencePrice,
  type ReferenceInput,
  type ReferenceListing,
} from '../../src/alerts/reference-price.ts';

const money = (amountMinor: number, currency: MinorUnitCurrency = 'CAD'): Money => ({
  amountMinor,
  currency,
});

function listing(
  listingId: number,
  price: number | null,
  currency: MinorUnitCurrency | 'unknown' = 'CAD',
  more: Partial<ReferenceListing> = {},
): ReferenceListing {
  return {
    listingId,
    productId: 1,
    channel: 'retail',
    sellerKind: 'first_party',
    condition: 'new',
    relation: 'exact',
    identityVerified: true,
    latest: {
      kind: 'observation',
      observationId: 800 + listingId,
      observedAt: '2026-11-17T09:00:00.000Z',
      currency,
      price,
      availability: 'in',
    },
    ...more,
  };
}

function forWatch(
  listings: readonly ReferenceListing[],
  watch: Partial<ReferenceInput['watch']> = {},
): ReferenceInput {
  return {
    watch: {
      productId: 1,
      marketCurrency: 'CAD',
      currency: null,
      reference: null,
      userConfirmedPrice: null,
      ...watch,
    },
    listings,
  };
}

describe('chooseReferencePrice', () => {
  it('a watch with no listing has no real read', () => {
    expect(chooseReferencePrice(forWatch([]))).toEqual({ action: 'none', why: 'no_real_read' });
  });

  it('reads with no price or an unknown currency are not real reads', () => {
    expect(chooseReferencePrice(forWatch([listing(1, null), listing(2, 100, 'unknown')]))).toEqual({
      action: 'none',
      why: 'no_real_read',
    });
  });

  it('a user price before a currency is adopted waits for an eligible real read', () => {
    const user = money(12000);
    expect(chooseReferencePrice(forWatch([], { userConfirmedPrice: user }))).toEqual({
      action: 'none',
      why: 'no_real_read',
    });
    expect(
      chooseReferencePrice(forWatch([listing(1, 9000)], { userConfirmedPrice: user })),
    ).toEqual({
      action: 'set',
      currency: 'CAD',
      price: user,
      kind: 'user_confirmed',
      fromListings: [],
    });
  });

  it('a user price in another currency than the watch is not the reference', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 9000)], { currency: 'CAD', userConfirmedPrice: money(12000, 'USD') }),
    );
    expect(decided).toMatchObject({ action: 'set', kind: 'median_verified', price: money(9000) });
  });

  it('with no listing in the market currency, the currency most listings bill in is adopted', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 100, 'EUR'), listing(2, 200, 'USD'), listing(3, 300, 'USD')]),
    );
    expect(decided).toEqual({
      action: 'set',
      currency: 'USD',
      price: money(250, 'USD'),
      kind: 'median_verified',
      fromListings: [2, 3],
    });
  });

  it('a tie between foreign currencies goes to the first in input order', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 100, 'EUR'), listing(2, 200, 'USD')]),
    );
    expect(decided).toMatchObject({ currency: 'EUR', fromListings: [1] });
  });

  it('a new first-party listing in another currency does not push out a same-currency refurb', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 9000, 'CAD', { condition: 'refurbished' }), listing(2, 7000, 'USD')]),
    );
    expect(decided).toMatchObject({ currency: 'CAD', price: money(9000), fromListings: [1] });
  });

  it('open-box and marketplace listings make way for a new first-party one; used ones count without one', () => {
    const others = [
      listing(1, 5000, 'CAD', { condition: 'open_box' }),
      listing(2, 6000, 'CAD', { channel: 'marketplace', sellerKind: 'marketplace_seller' }),
      listing(3, 7000, 'CAD', { condition: 'used_good', sellerKind: 'private' }),
    ];
    expect(chooseReferencePrice(forWatch([...others, listing(4, 9000)]))).toMatchObject({
      price: money(9000),
      fromListings: [4],
    });
    expect(chooseReferencePrice(forWatch(others))).toMatchObject({
      price: money(6000),
      fromListings: [1, 2, 3],
    });
  });

  it('a listing with no product, an unverified one and a failed one are left out', () => {
    const decided = chooseReferencePrice(
      forWatch([
        listing(1, 1000, 'CAD', { productId: null }),
        listing(2, 2000, 'CAD', { identityVerified: false }),
        listing(3, 3000, 'CAD', { latest: { kind: 'failed', at: '2026-11-17T09:00:00.000Z' } }),
        listing(4, 3000, 'CAD', { latest: null }),
      ]),
    );
    expect(decided).toEqual({ action: 'none', why: 'no_eligible_listing' });
  });

  it('a sold-out listing still counts with its latest price', () => {
    const soldOut: ReferenceListing = {
      ...listing(1, 8000),
      latest: {
        kind: 'observation',
        observationId: 801,
        observedAt: '2026-11-17T09:00:00.000Z',
        currency: 'CAD',
        price: 8000,
        availability: 'out',
      },
    };
    expect(chooseReferencePrice(forWatch([soldOut]))).toMatchObject({ price: money(8000) });
  });

  it('is exact for prices near 2^53 and in zero- and three-decimal currencies', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(chooseReferencePrice(forWatch([listing(1, max), listing(2, max - 1)]))).toMatchObject({
      price: money(max),
    });
    expect(
      chooseReferencePrice(
        forWatch([listing(1, 1001, 'JPY'), listing(2, 1002, 'JPY')], { marketCurrency: 'JPY' }),
      ),
    ).toMatchObject({ price: money(1002, 'JPY') });
    expect(
      chooseReferencePrice(
        forWatch([listing(1, 1, 'KWD'), listing(2, 2, 'KWD')], { marketCurrency: 'KWD' }),
      ),
    ).toMatchObject({ price: money(2, 'KWD') });
  });

  it('a held reference with no currency adopted is set, not kept, so the currency is written', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 9000)], { reference: { price: money(9000), kind: 'median_verified' } }),
    );
    expect(decided).toMatchObject({ action: 'set', currency: 'CAD' });
  });

  it('a change of kind at the same price is set, not kept', () => {
    const decided = chooseReferencePrice(
      forWatch([listing(1, 9000)], {
        currency: 'CAD',
        reference: { price: money(9000), kind: 'user_confirmed' },
      }),
    );
    expect(decided).toMatchObject({ action: 'set', kind: 'median_verified' });
  });

  it('refuses a negative or unsafe price', () => {
    expect(() => chooseReferencePrice(forWatch([listing(1, -1)]))).toThrow(RangeError);
    expect(() => chooseReferencePrice(forWatch([], { userConfirmedPrice: money(0.5) }))).toThrow(
      RangeError,
    );
  });
});
