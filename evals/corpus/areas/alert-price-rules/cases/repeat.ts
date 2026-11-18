import type { PriceAlertCase, PriceAlertInput } from '../contract.ts';
import { cad, observed, watch } from './fixtures.ts';

const T = 'pricewatch/tests/test_service.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_COOLDOWN = {
  how: 'spec',
  ref: 'S§5.8 Alert rules: "The 12 h cooldown is bypassed only by a further drop; after expiry a repeat needs a moved price."',
} as const;

const NOW = '2026-11-17T09:30:00.000Z';

/** A CA$50.00 target already met; the last accepted alert was at CA$45.00. */
function afterAlert(acceptedAt: string, price: number): PriceAlertInput {
  return {
    now: NOW,
    watch: watch({ targetPrice: cad(5000) }),
    reads: [observed(401, NOW, price)],
    lastAcceptedPriceAlert: { price: cad(4500), acceptedAt },
  };
}

const HALF_HOUR_AGO = '2026-11-17T09:00:00.000Z';
const THIRTEEN_HOURS_AGO = '2026-11-16T20:30:00.000Z';
const TWELVE_HOURS_AGO = '2026-11-16T21:30:00.000Z';
const TWELVE_HOURS_LESS_1MS_AGO = '2026-11-16T21:30:00.001Z';

const PRED =
  'Predecessor: target Decimal("50"), last_notified_price Decimal("45") → 5000 and 4500 (no currency in the test; CAD here); cooldown_hours 12 → 43200 s.';

export const repeatCases: readonly PriceAlertCase[] = [
  {
    id: 'cooldown-blocks-repeat-at-same-price',
    what: 'Within the cooldown the same price does not fire again',
    input: afterAlert(HALF_HOUR_AGO, 4500),
    expected: { fire: false, silence: 'cooldown' },
    from: [
      { how: 'test-assertion', ref: `${T}:38 test_cooldown_blocks_repeat_at_same_price` },
      SPEC_COOLDOWN,
    ],
    notes: `${PRED} The test stamps last_notified_at = utcnow(); here the accepted alert is 30 min old. Also the second of two serialised evaluations (${T}:598 test_concurrent_evaluations_deliver_a_matching_watch_only_once): it sees the first one's accepted stamp.`,
  },
  {
    id: 'cooldown-bypassed-by-further-drop',
    what: 'Within the cooldown a lower price than the last alert fires at once',
    input: afterAlert(HALF_HOUR_AGO, 4400),
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 401,
      price: cad(4400),
      repeat: 'further_drop',
    },
    from: [
      { how: 'test-assertion', ref: `${T}:45 test_cooldown_bypassed_when_price_falls_further` },
      SPEC_COOLDOWN,
    ],
    notes: `${PRED} Price Decimal("44") → 4400.`,
  },
  {
    id: 'cooldown-blocks-a-higher-price',
    what: 'Within the cooldown a price that moved up (still under target) does not fire',
    input: afterAlert(HALF_HOUR_AGO, 4600),
    expected: { fire: false, silence: 'cooldown' },
    from: [
      { how: 'offline-run', ref: `${S}:1191 _should_notify(last 45 at now, price 46) → False` },
      SPEC_COOLDOWN,
    ],
    notes: `${PRED} Only a further drop bypasses the cooldown.`,
  },
  {
    id: 'after-cooldown-same-price-stays-quiet',
    what: 'After the cooldown the same price is not news',
    input: afterAlert(THIRTEEN_HOURS_AGO, 4500),
    expected: { fire: false, silence: 'unchanged_price' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:52 test_cooldown_expiry_allows_a_repeat_only_once_the_price_has_moved (45 stays quiet)`,
      },
      SPEC_COOLDOWN,
    ],
    notes: `${PRED} last_notified_at = utcnow() − 13 h.`,
  },
  {
    id: 'after-cooldown-moved-up-price-fires',
    what: 'After the cooldown a price that moved up but still meets the target fires',
    input: afterAlert(THIRTEEN_HOURS_AGO, 4600),
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 401,
      price: cad(4600),
      repeat: 'moved_after_cooldown',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:52 test_cooldown_expiry_allows_a_repeat_only_once_the_price_has_moved (46 fires)`,
      },
      SPEC_COOLDOWN,
    ],
    notes: `${PRED} Price Decimal("46") → 4600.`,
  },
  {
    id: 'after-cooldown-lower-price-fires',
    what: 'After the cooldown a lower price fires (as a further drop)',
    input: afterAlert(THIRTEEN_HOURS_AGO, 4400),
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 401,
      price: cad(4400),
      repeat: 'further_drop',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:52 test_cooldown_expiry_allows_a_repeat_only_once_the_price_has_moved (44 fires)`,
      },
      {
        how: 'function-reading',
        ref: `${S}:1200 _should_notify (price < last_notified_price returns before the cooldown check)`,
      },
    ],
    notes: `${PRED} Price Decimal("44") → 4400.`,
  },
  {
    id: 'cooldown-expires-exactly-at-twelve-hours',
    what: 'At exactly 12 h the cooldown is over, so a moved price fires',
    input: afterAlert(TWELVE_HOURS_AGO, 4600),
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 401,
      price: cad(4600),
      repeat: 'moved_after_cooldown',
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1202 _should_notify (utcnow() − last_notified_at >= cooldown)`,
      },
      { how: 'offline-run', ref: '_should_notify(last 45 at now − 12 h, price 46) → True' },
    ],
    notes: `${PRED} now − acceptedAt = 43200 s = cooldownSeconds.`,
  },
  {
    id: 'cooldown-one-millisecond-before-expiry-blocks',
    what: 'One millisecond before 12 h the cooldown still holds',
    input: afterAlert(TWELVE_HOURS_LESS_1MS_AGO, 4600),
    expected: { fire: false, silence: 'cooldown' },
    from: [
      {
        how: 'offline-run',
        ref: `${S}:1191 _should_notify(last 45 at now − 12 h + 1 ms, price 46) → False`,
      },
    ],
    notes: `${PRED} now − acceptedAt = 43199.999 s.`,
  },
  {
    id: 'undelivered-alert-leaves-watch-armed',
    what: 'With no accepted alert (the last push failed) the met target fires again',
    input: {
      now: NOW,
      watch: watch({ targetPrice: cad(12000) }),
      reads: [observed(401, NOW, 9900)],
      lastAcceptedPriceAlert: null,
    },
    expected: {
      fire: true,
      rules: ['target_reached'],
      observationId: 401,
      price: cad(9900),
      repeat: 'first',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:498 test_an_undelivered_alert_keeps_the_watch_armed_for_the_next_sweep (second sweep fires again)`,
      },
      {
        how: 'spec',
        ref: 'S§2 invariant 11: "A cooldown or \'notified\' stamp is set only when a channel confirms acceptance."',
      },
    ],
    notes:
      'Predecessor: west3d CAD 99 against target 120 → 9900 and 12000 CAD; the first dispatch returned {"ntfy": "error: [Errno -5] No address associated"}, so last_notified_at stayed None and the next sweep fired again. Whether the second firing is a new event or the same event retried by the outbox is open (report).',
  },
];
