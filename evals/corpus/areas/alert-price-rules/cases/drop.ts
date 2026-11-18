import type { PriceAlertCase } from '../contract.ts';
import {
  cad,
  chronological,
  confirmedPair,
  daily,
  FIRST_READ_AT,
  FLAT_100,
  NOISY_100,
  NOW,
  observed,
  SECOND_READ_AT,
  watch,
} from './fixtures.ts';

const T = 'pricewatch/tests/test_service.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_DROP = {
  how: 'spec',
  ref: 'S§5.8 Alert rules: "A drop fires when the price is below the baseline by more than 3 MAD (floor 1%) and by the user\'s threshold, confirmed by a second read on the same read path."',
} as const;
const ADDED =
  'Added for the spec: seven daily CA$100.00 reads on platform_json before the evaluated reads (MAD 0, so the floor is 10000 / 100 = 100) and, where it fires, a confirming read at the same price on the same path.';
const NOISE_NOTE =
  'MAD of the seven noisy reads: median 10000, deviations sorted 0, 0, 0, 600, 600, 700, 700 → 600. With the two evaluated reads included as well the median is still 10000 and the MAD still 600 (checked for each case), so both readings agree. A scaled MAD (× 1.4826 = 889.56, 3 × = 2668.68) gives the same verdict.';

const reference = { referencePrice: cad(10000) };

export const dropCases: readonly PriceAlertCase[] = [
  {
    id: 'drop-confirmed-by-second-read-fires',
    what: 'A drop past the user threshold and the noise floor, confirmed on the same read path, fires',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 1500 }),
      reads: [...FLAT_100, ...confirmedPair(8400)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(8400),
      repeat: 'first',
    },
    from: [{ how: 'test-assertion', ref: `${T}:26 test_drop_pct_reason (84.00 fires)` }, SPEC_DROP],
    specDerived: true,
    notes: `Predecessor: drop_pct 15.0, baseline Decimal("100"), price Decimal("84.00") → 1500 bp, 10000, 8400 (no currency in the test; CAD here). ${ADDED} B − P = 1600 ≥ 1500 × 10000 / 10000 = 1500; 1600 > 100.`,
  },
  {
    id: 'drop-short-of-user-threshold-is-silent',
    what: 'A 10% drop on a 15% rule does not fire',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 1500 }),
      reads: [observed(301, SECOND_READ_AT, 9000)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'below_threshold' },
    from: [{ how: 'test-assertion', ref: `${T}:26 test_drop_pct_reason (90.00 does not fire)` }],
    notes:
      'Predecessor: price Decimal("90.00") → 9000. B − P = 1000 < 1500. No history is needed: the threshold fails first.',
  },
  {
    id: 'drop-exactly-at-user-threshold-fires',
    what: 'A drop of exactly the user threshold counts (inclusive), once confirmed',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 1500 }),
      reads: [...FLAT_100, ...confirmedPair(8500)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(8500),
      repeat: 'first',
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1178-1179 _reasons (price <= baseline × (1 − drop_pct / 100))`,
      },
      { how: 'offline-run', ref: '_reasons(drop 15.0, baseline 100, price 85) → ["down 15.0% …"]' },
      SPEC_DROP,
    ],
    specDerived: true,
    notes: `${ADDED} B − P = 1500 = 1500 × 10000 / 10000: met, inclusive as in the predecessor; 1500 > 100. Whether "by the user's threshold" is inclusive is listed as open in the report.`,
  },
  {
    id: 'drop-one-minor-unit-short-of-threshold-is-silent',
    what: 'One minor unit short of the user threshold does not fire',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 1500 }),
      reads: [observed(301, SECOND_READ_AT, 8501)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'below_threshold' },
    from: [
      { how: 'offline-run', ref: `${S}:1172 _reasons(drop 15.0, baseline 100, price 85.01) → []` },
    ],
    notes: 'B − P = 1499 < 1500.',
  },
  {
    id: 'drop-without-second-read-awaits-confirmation',
    what: 'A first qualifying read alone does not fire: it waits for a second read',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: [...FLAT_100, observed(202, SECOND_READ_AT, 9000)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'awaiting_confirmation' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1271-1275 _evaluate_trackers (one read, _reasons, _should_notify)`,
      },
      SPEC_DROP,
    ],
    specDerived: true,
    divergence:
      'The predecessor fired on the first read that met drop_pct (no confirmation existed). S§5.8 requires a second read on the same read path.',
    notes:
      'Added: the flat history. The read before the evaluated one is the CA$100.00 read of 2026-11-16, which is no drop. B − P = 1000 ≥ 500 and > 100, so only confirmation is missing.',
  },
  {
    id: 'drop-confirmed-on-another-read-path-awaits-confirmation',
    what: 'A second read at the same price but on a different read path does not confirm the drop',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: [
        ...FLAT_100,
        observed(201, FIRST_READ_AT, 9000, { readPath: 'json_ld', rung: 'http' }),
        observed(202, SECOND_READ_AT, 9000),
      ],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'awaiting_confirmation' },
    from: [SPEC_DROP],
    specDerived: true,
    notes:
      'Added: the flat platform_json history and a json_ld read before the evaluated platform_json read. Both at 9000 meet the threshold and the floor; the paths differ, so the second read is not on the same read path. The rungs differ too (http, api), so this case does not decide whether "same read path" also means the same rung.',
  },
  {
    id: 'drop-within-noise-of-volatile-listing-is-silent',
    what: 'A 10% drop on a listing whose price swings by 3 MAD = 18% does not fire',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: [...NOISY_100, ...confirmedPair(9000)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'within_noise' },
    from: [SPEC_DROP],
    specDerived: true,
    notes: `Added: the noisy history and a confirming read. ${NOISE_NOTE} B − P = 1000 ≥ 500 (user threshold met) but 1000 ≤ max(1800, 100). With 9000 × 2 included: sorted 9000, 9000, 9300, 9400, 10000 × 3, 10600, 10700 → median 10000, deviations 0, 0, 0, 600, 600, 700, 700, 1000, 1000 → MAD 600.`,
  },
  {
    id: 'drop-of-exactly-three-mad-is-silent',
    what: 'A drop of exactly 3 MAD is not "more than 3 MAD"',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: [...NOISY_100, ...confirmedPair(8200)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'within_noise' },
    from: [SPEC_DROP],
    specDerived: true,
    notes: `Added: the noisy history and a confirming read. ${NOISE_NOTE} B − P = 1800 = 3 × 600: not more. With 8200 × 2 included the deviations add 1800, 1800 → sorted 0, 0, 0, 600, 600, 700, 700, 1800, 1800 → MAD 600.`,
  },
  {
    id: 'drop-beyond-three-mad-fires',
    what: 'A 30% drop on the same volatile listing is past 3 MAD and fires once confirmed',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: [...NOISY_100, ...confirmedPair(7000)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(7000),
      repeat: 'first',
    },
    from: [SPEC_DROP],
    specDerived: true,
    notes: `Added: the noisy history and a confirming read. ${NOISE_NOTE} B − P = 3000 > 1800 (and > 2668.68 scaled); 3000 ≥ 500. With 7000 × 2 included: median 10000, MAD 600.`,
  },
  {
    id: 'drop-of-exactly-one-percent-is-silent',
    what: 'On a flat listing a drop of exactly 1% is not more than the floor',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 50 }),
      reads: [...FLAT_100, ...confirmedPair(9900)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'within_noise' },
    from: [SPEC_DROP],
    specDerived: true,
    notes:
      'Added: the flat history, a confirming read and a 0.5% (50 bp) user threshold, so the 1% floor is what decides (0 < 50 < 10000 is a valid drop rule, see watch-intake). MAD 0 (with 9900 × 2 included: deviations 0 × 7, 100, 100 → MAD 0). B − P = 100 ≥ 50 but not > max(0, 10000 / 100 = 100).',
  },
  {
    id: 'drop-just-over-one-percent-fires',
    what: 'One minor unit past the 1% floor fires on a flat listing',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 50 }),
      reads: [...FLAT_100, ...confirmedPair(9899)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(9899),
      repeat: 'first',
    },
    from: [SPEC_DROP],
    specDerived: true,
    notes: 'Added as in drop-of-exactly-one-percent-is-silent. B − P = 101 > 100 and ≥ 50.',
  },
  {
    id: 'drop-noise-measured-on-same-read-path-only',
    what: 'A noisy history read on another path does not widen the noise band of this path',
    input: {
      now: NOW,
      watch: watch({ ...reference, dropBasisPoints: 500 }),
      reads: chronological([
        ...daily([10600, 9400, 10700, 9300, 10800, 9200, 10600], 111, 'json_ld', 'http', '30'),
        ...daily([10000, 10000, 10000], 101),
        ...confirmedPair(9000),
      ]),
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['drop'],
      observationId: 202,
      price: cad(9000),
      repeat: 'first',
    },
    from: [
      SPEC_DROP,
      {
        how: 'spec',
        ref: 'S§5.8 Alert rules: "Only fresh, in-stock, same-currency, same-read-path observations are compared."',
      },
    ],
    specDerived: true,
    notes:
      'Added: seven noisy json_ld reads (09:30, 2026-11-10 to 16), three flat platform_json reads (09:00, 2026-11-10 to 12) and a confirming pair at 9000 on platform_json. Same path only: [10000 × 3] (or with 9000 × 2: deviations 0, 0, 0, 1000, 1000) → MAD 0, so 1000 > 100 and ≥ 500: fires. If the json_ld reads were wrongly included: 10 values without the pair → median 10000, deviations sorted 0, 0, 0, 600, 600, 600, 700, 700, 800, 800 → MAD 600 → 1800; with the pair, 12 values → MAD 650 → 1950; either way 1000 would not fire.',
  },
  {
    id: 'drop-rule-without-reference-is-silent',
    what: 'A drop rule cannot fire before the watch has a reference price',
    input: {
      now: NOW,
      watch: watch({ dropBasisPoints: 500 }),
      reads: [observed(301, SECOND_READ_AT, 100)],
      lastAcceptedPriceAlert: null,
    },
    expected: { fire: false, silence: 'no_reference' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1177 _reasons (if tracker.drop_pct and tracker.baseline_price)`,
      },
      { how: 'offline-run', ref: '_reasons(drop 5.0, baseline None, price 1) → []' },
    ],
    notes:
      'Predecessor price Decimal("1") → 100. The watch has adopted CAD but has no reference price yet.',
  },
];
