import type { PriceAlertCase } from '../contract.ts';
import { cad, confirmedPair, FLAT_100, NOW, observed, SECOND_READ_AT, watch } from './fixtures.ts';

const T = 'pricewatch/tests/test_service.py';

export const targetCases: readonly PriceAlertCase[] = [
  {
    id: 'target-reached-below-fires',
    what: 'A price one minor unit under the target fires on a single read',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(5000) }),
      reads: [observed(301, SECOND_READ_AT, 4999)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 301,
      price: cad(4999),
      repeat: 'first',
    },
    from: [{ how: 'test-assertion', ref: `${T}:20 test_target_price_reason` }],
    notes:
      'Predecessor: target Decimal("50"), price Decimal("49.99") → 5000 and 4999 minor units. The test amounts carry no currency (formatting falls back to USD); CAD is used here. S§5.8 "A target price fires when it is reached" needs no confirming read.',
  },
  {
    id: 'target-not-reached-just-above-is-silent',
    what: 'A price one minor unit over the target does not fire',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(5000) }),
      reads: [observed(301, SECOND_READ_AT, 5001)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'below_threshold' },
    from: [{ how: 'test-assertion', ref: `${T}:20 test_target_price_reason` }],
    notes: 'Predecessor: price Decimal("50.01") → 5001.',
  },
  {
    id: 'target-reached-exactly-fires',
    what: 'A price equal to the target counts as reached',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(5000) }),
      reads: [observed(301, SECOND_READ_AT, 5000)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 301,
      price: cad(5000),
      repeat: 'first',
    },
    from: [
      {
        how: 'function-reading',
        ref: 'pricewatch/src/pricewatch/service.py:1175 _reasons (price <= target_price)',
      },
      {
        how: 'offline-run',
        ref: '_reasons(target 50, price 50.00) → ["at or below your target …"]',
      },
    ],
  },
  {
    id: 'target-and-drop-both-reported',
    what: 'A read that reaches the target and is a confirmed drop reports both rules, target first',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(9000), referencePrice: cad(10000), dropBasisPoints: 1000 }),
      reads: [...FLAT_100, ...confirmedPair(8500)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['target_reached', 'drop'],
      observationId: 202,
      price: cad(8500),
      repeat: 'first',
    },
    from: [
      { how: 'test-assertion', ref: `${T}:32 test_both_conditions_both_reported` },
      {
        how: 'spec',
        ref: 'S§5.8 Alert rules: drop "below the baseline by more than 3 MAD (floor 1%) and by the user\'s threshold, confirmed by a second read on the same read path"',
      },
    ],
    specDerived: true,
    notes:
      'Predecessor: target 90, drop_pct 10.0, baseline 100, price 85 → target 9000, 1000 bp, reference 10000, price 8500; it asserted len(reasons) == 2 from one read. Added for the spec: seven flat CA$100.00 reads (MAD 0) and a second read at 8500 on the same path. Target: 8500 ≤ 9000. Drop: B − P = 1500 ≥ 1000 × 10000 / 10000 = 1000; 1500 > max(3 × 0, 10000 / 100 = 100); the read before (8500, platform_json) meets both.',
  },
];
