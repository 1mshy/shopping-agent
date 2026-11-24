import type { PriceAlertCase } from '../contract.ts';
import {
  cad,
  confirmedPair,
  daily,
  FIRST_READ_AT,
  NOW,
  observed,
  RULING_EFFECTIVE,
  SECOND_READ_AT,
  watch,
} from './fixtures.ts';

const T = 'pricewatch/tests/test_service.py';
const I = 'pricewatch/tests/test_watch_intake.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_COMPARED = {
  how: 'spec',
  ref: 'S§5.8 Alert rules: "Only fresh, in-stock, same-currency, same-read-path observations are compared."',
} as const;

export const comparableCases: readonly PriceAlertCase[] = [
  {
    id: 'foreign-currency-read-is-never-compared',
    what: 'A cheaper read in USD never fires a CAD watch',
    input: {
      now: NOW,
      watch: watch({ referencePrice: cad(11900), dropBasisPoints: 1500 }),
      reads: [observed(301, SECOND_READ_AT, 9999, { currency: 'USD' })],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'currency_mismatch' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:234 test_a_cheaper_foreign_listing_does_not_fire_a_cad_watch`,
      },
      SPEC_COMPARED,
    ],
    notes:
      'Predecessor: CAD watch, baseline Decimal("119"), drop_pct 15.0; amazon USD 99.99 → reference 11900 CAD, read 9999 USD. USD 99.99 would be 16% "below" CA$119 if digits were compared. The test also seeds a CAD listing at 119; that listing is no drop and is its own evaluation.',
  },
  {
    id: 'drop-in-watch-currency-fires-with-its-currency',
    what: 'A confirmed drop on the CAD listing fires and carries CAD',
    input: {
      now: NOW,
      watch: watch({ referencePrice: cad(11900), dropBasisPoints: 1500 }),
      reads: [
        ...daily([11900, 11900, 11900, 11900, 11900, 11900, 11900], 101),
        ...confirmedPair(9900),
      ],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(9900),
      repeat: 'first',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:249 test_a_drop_in_the_watch_currency_fires_and_names_the_currency`,
      },
      {
        how: 'spec',
        ref: 'S§5.8 Alert rules: drop "by more than 3 MAD (floor 1%) and by the user\'s threshold, confirmed by a second read on the same read path"',
      },
    ],
    specDerived: true,
    notes:
      'Predecessor: west3d CAD 99 against baseline 119 at 15% → 9900 and 11900 CAD; it fired from one read and the alert currency was CAD. Added for the spec: seven flat CA$119.00 reads and a confirming read at 9900. B − P = 2000 ≥ 1500 × 11900 / 10000 = 1785; 2000 > max(0, 11900 / 100 = 119). The predecessor\'s message text ("CA$99.00", "CA$119.00") is formatting, not part of this decision.',
  },
  {
    id: 'sold-out-read-never-fires-a-price-alert',
    what: 'A price under the target on a sold-out read does not fire',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(12000) }),
      reads: [observed(301, SECOND_READ_AT, 10000, { availability: 'out' })],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'not_in_stock' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:237 test_sold_out_discount_does_not_trigger_price_alert`,
      },
      SPEC_COMPARED,
    ],
    notes:
      'Predecessor: target_price 120, listing CAD 100 in_stock False → 12000 and 10000 CAD; evaluate_trackers() == [].',
  },
  {
    id: 'failed-read-never-fires-on-remembered-price',
    what: 'A failed read does not alert on the last price it remembers',
    input: {
      now: '2026-11-17T09:30:00.000Z',
      watch: watch({ targetPrice: cad(12000) }),
      reads: [
        observed(301, '2026-11-17T09:00:00.000Z', 10000),
        { kind: 'failed', at: '2026-11-17T09:30:00.000Z', rung: 'api' },
      ],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'failed_read' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:191 test_failed_sweep_preserves_history_but_never_alerts_on_stale_price`,
      },
      {
        how: 'spec',
        ref: 'S§2 invariant 10: "A failed read never refreshes a price, never alerts, and never overwrites the last known state."',
      },
    ],
    notes:
      'Predecessor: watch target 120, intake read CAD 100, then a sweep whose fetch raised "network unavailable" → result["alerts"] == []. The intake read itself was never evaluated in the test; only the failed sweep is.',
  },
  {
    id: 'unknown-stock-read-is-not-compared',
    what: 'A read that says nothing about stock is not an in-stock observation and does not fire',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(12000) }),
      reads: [observed(301, SECOND_READ_AT, 10000, { availability: 'unknown' })],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'not_in_stock' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1153-1154 _best_offer(fresh_only=True) keeps in_stock None ("is not False")`,
      },
      SPEC_COMPARED,
    ],
    divergence:
      'The predecessor compared a listing whose stock was unknown (in_stock None passes `in_stock is not False`), so this read would have fired the target. S§5.8 compares only in-stock observations and S§2.10 makes unknown a value of its own.',
  },
  {
    id: 'automatic-discount-price-is-the-alert-price',
    what: 'A CA$55.00 sticker with an automatic CA$7.00 discount reaches a CA$50.00 target at CA$48.00',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(5000) }),
      reads: [observed(301, SECOND_READ_AT, 4800, { sticker: 5500 })],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 301,
      price: cad(4800),
      repeat: 'first',
    },
    from: [RULING_EFFECTIVE],
    specDerived: true,
    notes:
      "Added for the owner's ruling of 2026-11-23. Effective price = sticker − automatic discount = 5500 − 700 = 4800 ≤ 5000: the target is reached on the effective price, which is the alert price; the sticker (5500) alone would not reach it.",
  },
  {
    id: 'clip-coupon-alone-does-not-fire',
    what: 'A CA$55.00 sticker with a CA$10.00 clip coupon does not reach a CA$50.00 target',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(5000) }),
      reads: [observed(301, SECOND_READ_AT, 5500, { actionCouponOff: 1000 })],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'below_threshold' },
    from: [RULING_EFFECTIVE],
    specDerived: true,
    notes:
      "Added for the owner's ruling of 2026-11-23. The coupon needs a clip, so it is not taken off: the alert price is 5500 > 5000. Taking it off (5500 − 1000 = 4500) would have fired; that is what the ruling rules out. The predecessor took a clip coupon off the tracked price (known-failure-coupon-missed).",
    divergence:
      'After its 2026-09-06 fix (commit 9678053) the predecessor replaced the tracked price with the price after a clip coupon (AmazonAdapter._parse, lines 406-411, as known-failure-coupon-missed records), so this read would have fired its target. The owner ruled on 2026-11-23 that a coupon needing a clip or a code does not trigger an alert on its own.',
  },
  {
    id: 'automatic-discount-drop-fires-on-the-effective-price',
    what: 'A confirmed drop measured on the effective price fires though the sticker has not moved',
    input: {
      now: NOW,
      watch: watch({ referencePrice: cad(10000), dropBasisPoints: 1000 }),
      reads: [
        ...daily([10000, 10000, 10000, 10000, 10000, 10000, 10000], 101),
        observed(201, FIRST_READ_AT, 8800, { sticker: 10000 }),
        observed(202, SECOND_READ_AT, 8800, { sticker: 10000 }),
      ],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(8800),
      repeat: 'first',
    },
    from: [
      RULING_EFFECTIVE,
      {
        how: 'spec',
        ref: 'S§5.8 Alert rules: drop "by more than 3 MAD (floor 1%) and by the user\'s threshold, confirmed by a second read on the same read path"',
      },
    ],
    specDerived: true,
    notes:
      "Added for the owner's ruling of 2026-11-23. Sticker CA$100.00 with an automatic CA$12.00 discount on both reads: effective 10000 − 1200 = 8800. B − P = 10000 − 8800 = 1200 ≥ 1000 × 10000 / 10000 = 1000; MAD 0 (flat history; with 8800 × 2: deviations 0 × 7, 1200, 1200 → MAD 0), so 1200 > 100. Both reads on platform_json and the api rung.",
  },
];
