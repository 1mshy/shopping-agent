import type { Money } from '@agentic-dasher/shared';
import type { DeliveryGatingCase, GatingDelivery } from '../contract.ts';

const T = 'pricewatch/tests/test_service.py';
const R = 'pricewatch/tests/test_restock.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_GATE = {
  how: 'spec',
  ref: 'S§2 invariant 11: "A cooldown or \'notified\' stamp is set only when a channel confirms acceptance." S§4.4: "Only accepted (the channel confirmed acceptance) may stamp a cooldown or \'notified\'."',
} as const;
const PRED =
  'Predecessor scenario: a CAD watch whose target (120) the west3d listing at 99 meets → alert price 9900 CAD.';

const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });
const price = { kind: 'price_drop', observationId: 601, price: cad(9900) } as const;
const restock = { kind: 'restock', observationId: 602, price: cad(11900) } as const;

const ACCEPTED_AT = '2026-11-17T09:31:12.000Z';

const ntfy = (state: GatingDelivery['state']): GatingDelivery => ({
  channelId: 1,
  channelType: 'ntfy',
  state,
  acceptedAt: state === 'accepted' ? ACCEPTED_AT : null,
});

export const gatingCases: readonly DeliveryGatingCase[] = [
  {
    id: 'accepted-delivery-stamps-the-cooldown',
    what: 'A channel accepting the price alert stamps the cooldown at acceptance, with the price',
    input: { alert: price, deliveries: [ntfy('accepted')] },
    expected: {
      stamp: { kind: 'price_cooldown', at: ACCEPTED_AT, price: cad(9900) },
      status: 'accepted',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:498 test_an_undelivered_alert_keeps_the_watch_armed_for_the_next_sweep (third sweep: "sent" → last_notified_at set, last_notified_price 99)`,
      },
      SPEC_GATE,
    ],
    notes: `${PRED} The predecessor stamped utcnow() when it wrote the outcome right after dispatch returned "sent"; with an outbox that instant is the delivery's accepted_at.`,
  },
  {
    id: 'pending-retry-does-not-stamp',
    what: 'A delivery still retrying (DNS not back) leaves the watch armed',
    input: { alert: price, deliveries: [ntfy('pending')] },
    expected: { stamp: null, status: 'awaiting_delivery' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:498 test_an_undelivered_alert_keeps_the_watch_armed_for_the_next_sweep (first sweep: last_notified_at and last_notified_price stay None; the attempt is recorded with delivered False)`,
      },
      SPEC_GATE,
    ],
    notes: `${PRED} Dispatch returned {"ntfy": "error: [Errno -5] No address associated"}: a transport error, which the outbox keeps pending (notify-retry).`,
  },
  {
    id: 'failed-delivery-does-not-stamp',
    what: 'A delivery that failed for good (auth error) does not stamp either',
    input: { alert: price, deliveries: [ntfy('failed')] },
    expected: { stamp: null, status: 'undelivered' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1312-1319 _evaluate_trackers (delivered = any channel "sent"; stamp = delivered or not outcome)`,
      },
      SPEC_GATE,
    ],
    notes: PRED,
  },
  {
    id: 'one-accepted-channel-is-enough-to-stamp',
    what: 'One channel failing and another accepting stamps the cooldown',
    input: {
      alert: price,
      deliveries: [
        ntfy('failed'),
        { channelId: 2, channelType: 'webhook', state: 'accepted', acceptedAt: ACCEPTED_AT },
      ],
    },
    expected: {
      stamp: { kind: 'price_cooldown', at: ACCEPTED_AT, price: cad(9900) },
      status: 'accepted',
    },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1312 _evaluate_trackers (delivered = any(v == "sent" for v in outcome.values()))`,
      },
      SPEC_GATE,
    ],
    notes: `${PRED} Whether the cooldown is per watch (any channel) or per channel is listed as open in the report; this case follows the predecessor and invariant 11's "a channel".`,
  },
  {
    id: 'no-delivery-does-not-stamp',
    what: 'An alert no channel accepted is not stamped, even when there was no channel to try',
    input: { alert: price, deliveries: [] },
    expected: { stamp: null, status: 'undelivered' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:528 test_with_no_channel_configured_the_hit_is_recorded_once`,
      },
      SPEC_GATE,
    ],
    divergence:
      'With no channel configured the predecessor stamped the cooldown anyway ("stamp = delivered or not outcome"), so the hit was recorded once instead of on every sweep. The spec stamps only on acceptance, has an always-on in-app channel, and dedupes events by their stable key (S§4.4), so an alert with no accepted delivery is never stamped.',
    notes: PRED,
  },
  {
    id: 'accepted-restock-moves-the-watermark',
    what: 'An accepted restock alert moves the restock watermark and leaves the price cooldown alone',
    input: { alert: restock, deliveries: [ntfy('accepted')] },
    expected: { stamp: { kind: 'restock_watermark', at: ACCEPTED_AT }, status: 'accepted' },
    from: [
      {
        how: 'test-assertion',
        ref: `${R}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (last_restock_notified_at set, last_notified_at None)`,
      },
      {
        how: 'function-reading',
        ref: `${S}:1326-1330 _evaluate_trackers (restock stamps last_restock_notified_at only)`,
      },
    ],
    notes: 'Predecessor listing west3d CAD 119 → 11900 CAD.',
  },
  {
    id: 'undelivered-restock-sets-no-watermark',
    what: 'A restock alert not yet accepted does not move the watermark',
    input: { alert: restock, deliveries: [ntfy('pending')] },
    expected: { stamp: null, status: 'awaiting_delivery' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1319-1327 _evaluate_trackers (if stamp and kind == "restock")`,
      },
      SPEC_GATE,
    ],
    notes: 'Predecessor listing west3d CAD 119 → 11900 CAD.',
  },
];
