import type { Money } from '@agentic-dasher/shared';
import type { ListingReadState, StaleReadCase } from '../contract.ts';

const T = 'pricewatch/tests/test_service.py';
const R = 'pricewatch/tests/test_restock.py';
const I = 'pricewatch/tests/test_watch_intake.py';
const S = 'pricewatch/src/pricewatch/service.py';
const INV10 = {
  how: 'spec',
  ref: 'S§2 invariant 10: "A failed read never refreshes a price, never alerts, and never overwrites the last known state."',
} as const;
const GATE = {
  how: 'spec',
  ref: 'S§6 Acceptance gates: critical regressions include "stale shown as current" (zero on the frozen corpus); plan P0 workstream 3: "reproduce the known failures: … stale-as-current".',
} as const;

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });
const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });
const at = (hhmm: string) => `2026-11-17T${hhmm}:00.000Z`;

const freshUsd100: ListingReadState = {
  lastPrice: { price: usd(10000), observationId: 701, observedAt: at('09:00') },
  lastKnownAvailability: 'in',
  lastReadAt: at('09:00'),
  lastReadFailed: false,
  consecutiveErrors: 0,
};

const soldOutCad119: ListingReadState = {
  lastPrice: { price: cad(11900), observationId: 711, observedAt: at('08:00') },
  lastKnownAvailability: 'out',
  lastReadAt: at('08:00'),
  lastReadFailed: false,
  consecutiveErrors: 0,
};

/** CAD listing whose reads have failed since its last price at 06:00. */
const staleCad90: ListingReadState = {
  lastPrice: { price: cad(9000), observationId: 721, observedAt: at('06:00') },
  lastKnownAvailability: 'in',
  lastReadAt: at('09:00'),
  lastReadFailed: true,
  consecutiveErrors: 3,
};

const freshCad120: ListingReadState = {
  lastPrice: { price: cad(12000), observationId: 731, observedAt: at('09:00') },
  lastKnownAvailability: 'in',
  lastReadAt: at('09:00'),
  lastReadFailed: false,
  consecutiveErrors: 0,
};

export const staleCases: readonly StaleReadCase[] = [
  {
    id: 'failed-read-keeps-last-price-and-counts-the-error',
    what: 'A walled read keeps the last price, counts the error, writes nothing, alerts nothing, and shows the price as stale',
    subject: 'applyRead',
    input: {
      state: freshUsd100,
      read: { kind: 'failed', at: at('09:30'), cause: 'wall', rung: 'http' },
    },
    expected: {
      state: {
        ...freshUsd100,
        lastReadAt: at('09:30'),
        lastReadFailed: true,
        consecutiveErrors: 1,
      },
      writesObservation: false,
      evaluatesAlerts: false,
      shown: { freshness: 'stale', price: usd(10000), asOf: at('09:00'), availability: 'in' },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:104 test_upsert_failure_keeps_last_price_and_counts_errors (last_price 100, consecutive_errors 1)`,
      },
      {
        how: 'test-assertion',
        ref: `${I}:191 test_failed_sweep_preserves_history_but_never_alerts_on_stale_price (alerts == [], current_best price 100 with stale True)`,
      },
      {
        how: 'function-reading',
        ref: `${S}:1398-1401 list_tracked ("stale": bool(best.last_error))`,
      },
      INV10,
    ],
    notes:
      'Predecessor: StoreResult USD Decimal(100), then StoreResult(error="bot challenge") → 10000 USD and a `wall` failure.',
  },
  {
    id: 'failed-read-keeps-the-sold-out-state',
    what: 'A failed read between sold out and back leaves the listing sold out',
    subject: 'applyRead',
    input: {
      state: soldOutCad119,
      read: { kind: 'failed', at: at('08:30'), cause: 'wall', rung: 'http' },
    },
    expected: {
      state: {
        ...soldOutCad119,
        lastReadAt: at('08:30'),
        lastReadFailed: true,
        consecutiveErrors: 1,
      },
      writesObservation: false,
      evaluatesAlerts: false,
      shown: { freshness: 'stale', price: cad(11900), asOf: at('08:00'), availability: 'out' },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${R}:79 test_a_read_that_says_nothing_about_stock_keeps_the_last_known_state (in_stock stays False, consecutive_errors 1)`,
      },
      INV10,
    ],
    notes: 'Predecessor listing: west3d CAD Decimal("119") out of stock → 11900 CAD.',
  },
  {
    id: 'unknown-stock-read-keeps-the-last-known-stock',
    what: 'A priced read that says nothing about stock updates the price but keeps the stock state',
    subject: 'applyRead',
    input: {
      state: soldOutCad119,
      read: {
        kind: 'observed',
        observationId: 712,
        at: at('08:30'),
        currency: 'CAD',
        price: 11900,
        availability: 'unknown',
        readPath: 'json_ld',
        rung: 'http',
      },
    },
    expected: {
      state: {
        lastPrice: { price: cad(11900), observationId: 712, observedAt: at('08:30') },
        lastKnownAvailability: 'out',
        lastReadAt: at('08:30'),
        lastReadFailed: false,
        consecutiveErrors: 0,
      },
      writesObservation: true,
      evaluatesAlerts: true,
      shown: { freshness: 'current', price: cad(11900), asOf: at('08:30'), availability: 'out' },
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:729-748 _upsert_offer (stock changes only when result.in_stock is not None; a price updates last_price and clears the error)`,
      },
    ],
    notes:
      "The observation itself records availability `unknown` (S§2.10, tri-state); only the listing's last known stock stays `out`. Alert rules run, and alert-price-rules does not compare an unknown-stock read.",
  },
  {
    id: 'successful-read-after-failures-resets-the-streak',
    what: 'A good read after failures replaces the price, clears the error streak and is current again',
    subject: 'applyRead',
    input: {
      state: staleCad90,
      read: {
        kind: 'observed',
        observationId: 722,
        at: at('09:30'),
        currency: 'CAD',
        price: 9500,
        availability: 'in',
        readPath: 'json_ld',
        rung: 'http',
      },
    },
    expected: {
      state: {
        lastPrice: { price: cad(9500), observationId: 722, observedAt: at('09:30') },
        lastKnownAvailability: 'in',
        lastReadAt: at('09:30'),
        lastReadFailed: false,
        consecutiveErrors: 0,
      },
      writesObservation: true,
      evaluatesAlerts: true,
      shown: { freshness: 'current', price: cad(9500), asOf: at('09:30'), availability: 'in' },
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:740-745 _upsert_offer (a price sets last_price, last_error None, consecutive_errors 0)`,
      },
    ],
  },
  {
    id: 'unchanged-price-read-still-writes-an-observation',
    what: "A good read at the same price is still an observation, so its time is the price's age",
    subject: 'applyRead',
    input: {
      state: freshUsd100,
      read: {
        kind: 'observed',
        observationId: 702,
        at: at('09:30'),
        currency: 'USD',
        price: 10000,
        availability: 'in',
        readPath: 'platform_json',
        rung: 'api',
      },
    },
    expected: {
      state: {
        lastPrice: { price: usd(10000), observationId: 702, observedAt: at('09:30') },
        lastKnownAvailability: 'in',
        lastReadAt: at('09:30'),
        lastReadFailed: false,
        consecutiveErrors: 0,
      },
      writesObservation: true,
      evaluatesAlerts: true,
      shown: { freshness: 'current', price: usd(10000), asOf: at('09:30'), availability: 'in' },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:77 test_upsert_records_price_points_only_on_change (an unchanged price adds no point)`,
      },
      {
        how: 'spec',
        ref: 'S§8 Glossary: "Observation: one read of a listing\'s price and availability." S§4.1: a read with no sticker, no out-of-stock signal and no unknown-currency candidates "is a failed read and writes no row" (so a good read writes one).',
      },
    ],
    divergence:
      'The predecessor appended a PricePoint only when the price or the stock state changed (service.py:749), so the stored history could not tell how fresh an unchanged price was. In the spec an observation is one read and only a failed read writes no row.',
    notes: 'Predecessor: two reads of USD Decimal(100) → 10000 USD.',
  },
  {
    id: 'first-read-fails-nothing-to-show',
    what: 'A watch whose very first read failed has no price to show, stale or current',
    subject: 'applyRead',
    input: { state: null, read: { kind: 'failed', at: at('09:00'), cause: 'wall', rung: 'http' } },
    expected: {
      state: {
        lastPrice: null,
        lastKnownAvailability: 'unknown',
        lastReadAt: at('09:00'),
        lastReadFailed: true,
        consecutiveErrors: 1,
      },
      writesObservation: false,
      evaluatesAlerts: false,
      shown: { freshness: 'none' },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:41 test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying (status retrying, current_best None, offer error "Retailer blocked request")`,
      },
      INV10,
    ],
  },
  {
    id: 'stale-price-is-never-the-current-best',
    what: "A cheaper price kept from failed reads is not shown as the watch's current best over a fresh one",
    subject: 'showWatchPrice',
    input: {
      watchCurrency: 'CAD',
      listings: [
        { listingId: 21, state: staleCad90 },
        { listingId: 22, state: freshCad120 },
      ],
    },
    expected: {
      best: {
        listingId: 22,
        shown: { freshness: 'current', price: cad(12000), asOf: at('09:00'), availability: 'in' },
      },
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1375-1376 list_tracked (best = _best_offer(fresh_only=True) or _best_offer(...))`,
      },
      {
        how: 'function-reading',
        ref: `${S}:1436 and 1455-1457 price_history (summary current_best = _best_offer(session, product_id).last_price, no fresh_only, no stale label, and a verdict computed on it)`,
      },
      GATE,
      INV10,
    ],
    notes:
      'The known failure, reproduced: the predecessor\'s price_history summary took the cheapest active offer whatever its last read, so listing 21 (last price CA$90.00, three failed reads since) would be reported as "current_best" 90.0 with a deal verdict and no stale mark, while list_tracked (fresh first) showed 120. The expected value is list_tracked\'s rule, which S§2.10 and the S§6 gate require everywhere.',
  },
  {
    id: 'only-a-stale-price-is-shown-labelled-stale',
    what: "When every listing's reads are failing, the remembered price is shown, labelled stale",
    subject: 'showWatchPrice',
    input: { watchCurrency: 'CAD', listings: [{ listingId: 21, state: staleCad90 }] },
    expected: {
      best: {
        listingId: 21,
        shown: { freshness: 'stale', price: cad(9000), asOf: at('06:00'), availability: 'in' },
      },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:191 test_failed_sweep_preserves_history_but_never_alerts_on_stale_price (current_best price 100, stale True)`,
      },
      GATE,
    ],
    notes:
      'The test\'s listing is CAD Decimal("100"); this case reuses the 90.00 stale listing of the case above (9000 CAD).',
  },
  {
    id: 'foreign-listing-is-not-the-watch-best',
    what: "A cheaper listing in another currency is not shown as the watch's best price",
    subject: 'showWatchPrice',
    input: {
      watchCurrency: 'CAD',
      listings: [
        {
          listingId: 31,
          state: {
            ...freshCad120,
            lastPrice: { price: cad(11900), observationId: 741, observedAt: at('09:00') },
          },
        },
        {
          listingId: 32,
          state: {
            ...freshCad120,
            lastPrice: { price: usd(9999), observationId: 742, observedAt: at('09:00') },
          },
        },
      ],
    },
    expected: {
      best: {
        listingId: 31,
        shown: { freshness: 'current', price: cad(11900), asOf: at('09:00'), availability: 'in' },
      },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:271 test_list_trackers_reports_the_currency_and_counts_foreign_listings (current_best west3d CAD)`,
      },
    ],
    notes:
      'Predecessor: west3d CAD Decimal("119") and amazon USD Decimal("99.99") → 11900 CAD and 9999 USD.',
  },
  {
    id: 'sold-out-only-listing-is-still-shown',
    what: "A watch whose only listing is sold out still shows that listing's current price",
    subject: 'showWatchPrice',
    input: {
      watchCurrency: 'CAD',
      listings: [
        {
          listingId: 41,
          state: {
            lastPrice: { price: cad(10000), observationId: 751, observedAt: at('09:00') },
            lastKnownAvailability: 'out',
            lastReadAt: at('09:00'),
            lastReadFailed: false,
            consecutiveErrors: 0,
          },
        },
      ],
    },
    expected: {
      best: {
        listingId: 41,
        shown: { freshness: 'current', price: cad(10000), asOf: at('09:00'), availability: 'out' },
      },
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:237 test_sold_out_discount_does_not_trigger_price_alert (offers[0].in_stock False, current_best price 100)`,
      },
    ],
    notes: 'Predecessor listing CAD Decimal("100") out of stock → 10000 CAD.',
  },
];
