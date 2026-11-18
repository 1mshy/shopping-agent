// SYNTHETIC test inputs: invented products, stores and prices for the tests. None of it is review
// data, and no figure computed from it measures anything.
import { moneyFromDecimal } from '@agentic-dasher/core';
import type { ListingCurrency } from '@agentic-dasher/shared';
import type {
  ListingSource,
  ReviewFile,
  ReviewListing,
  ReviewProduct,
  StoreVerdict,
} from '../lib/format.ts';

export function price(decimal: string, currency: ListingCurrency): ReviewListing['price'] {
  const m = moneyFromDecimal(decimal, currency);
  return m.ok
    ? { decimal, currency, amountMinor: m.value.amountMinor, refusal: null }
    : { decimal, currency, amountMinor: null, refusal: m.refusal.code };
}

let urls = 0;
export function listing(
  source: ListingSource,
  store: string,
  currency: ListingCurrency = 'CAD',
  decimal = '10.00',
): ReviewListing {
  urls += 1;
  return {
    source,
    store,
    url: `https://${store}.example/p/${urls}`,
    title: `Synthetic item ${urls}`,
    price: price(decimal, currency),
    readMethod: source === 'catalog' ? null : 'synthetic',
  };
}

export const reject = (store: string, setups: StoreVerdict['setups'] = 'all'): StoreVerdict => ({
  store,
  verdict: 'rejected',
  setups,
  reason: 'synthetic: not the product',
});

export function product(
  id: string,
  category: string,
  listings: ReviewListing[],
  verdicts: StoreVerdict[] = [],
  unreadableReasons: string[] = [],
): ReviewProduct {
  return {
    id,
    category,
    query: `Synthetic query ${id}`,
    listings,
    unreadable: unreadableReasons.map((reason, i) => ({
      host: `u${i}.example`,
      url: `https://u${i}.example/`,
      reason,
    })),
    verdicts,
  };
}

export function reviewFile(
  products: ReviewProduct[],
  preferredCurrency: ReviewFile['run']['preferredCurrency'] = 'CAD',
): ReviewFile {
  return {
    formatVersion: 1,
    id: 'synthetic-review',
    run: {
      startedAt: '2026-01-02T03:04:05.006Z',
      finishedAt: '2026-01-02T03:14:05.006Z',
      preferredCurrency,
      preferredRegion: 'CA',
      productList: null,
    },
    review: {
      reviewerId: 'r1',
      reviewedAt: '2026-01-03T00:00:00.000Z',
      rule: 'synthetic rule',
      unlistedStores: 'accepted',
    },
    products,
  };
}
