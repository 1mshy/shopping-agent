// Delivery-gated watch state (S§2 invariant 11 "A cooldown or 'notified' stamp is set only when a
// channel confirms acceptance"; S§5.11 retry policy: in-app acceptance alone does not stamp the
// cooldown, push is retried until a push channel accepts, and where no push channel is configured
// the in-app acceptance is the delivery). Pure: an alert and the state of each of its deliveries
// come in; what to stamp on the watch, and the alert's delivery status, come out. The corpus area
// `alert-delivery-gating` is its definition of done.
//
// The caller passes the deliveries the outbox can still move: a pending delivery on a removed or
// disabled push channel can never become `failed` (progress log, migration 0002), so leaving it in
// would hold the status at `awaiting_delivery` for ever.
import type {
  ChannelType,
  DeliveryState,
  Id,
  Money,
  NotificationKind,
  Timestamp,
} from '@agentic-dasher/shared';
import { assertPriceMoney, timestampMs } from './exact.ts';

/** The listing alerts that stamp watch state: a price alert or a restock alert. */
export type GatedAlertKind = Extract<NotificationKind, 'price_drop' | 'restock'>;

/** One delivery of the alert's event through one channel (S§4.4 delivery, trimmed). */
export interface GatingDelivery {
  readonly channelId: Id;
  readonly channelType: ChannelType;
  readonly state: DeliveryState;
  /** Set exactly when `state` is `accepted` (S§4.4). */
  readonly acceptedAt: Timestamp | null;
}

export interface DeliveryGatingInput {
  readonly alert: {
    readonly kind: GatedAlertKind;
    readonly observationId: Id;
    /** The price the alert announced. */
    readonly price: Money;
  };
  /** Every delivery of the alert's event, one per channel. */
  readonly deliveries: readonly GatingDelivery[];
}

/**
 * What to write on the watch: a price alert stamps the cooldown (when, and at what price); a
 * restock alert moves the restock watermark. `null`: nothing is stamped, the watch stays armed.
 */
export type WatchStamp =
  | { readonly kind: 'price_cooldown'; readonly at: Timestamp; readonly price: Money }
  | { readonly kind: 'restock_watermark'; readonly at: Timestamp };

/**
 * The alert's delivery status as a whole, judged on its push deliveries (every channel but
 * `in_app`) when it has any, else on its in-app delivery: `accepted`, `awaiting_delivery` (none
 * accepted, one still pending), `undelivered` (none accepted, none pending).
 */
export const ALERT_DELIVERY_STATUSES = ['accepted', 'awaiting_delivery', 'undelivered'] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

export interface DeliveryGatingDecision {
  readonly stamp: WatchStamp | null;
  readonly status: AlertDeliveryStatus;
}

/**
 * The deliveries that count are the push ones when there is at least one, otherwise the in-app
 * ones. The stamp is set only when one of those is `accepted`, at the earliest such `acceptedAt`;
 * one accepted channel stamps the per-watch cooldown for every channel. Refuses with a RangeError a
 * delivery whose `acceptedAt` is not set exactly when it is accepted, or a malformed timestamp.
 */
export function gateOnDelivery(input: DeliveryGatingInput): DeliveryGatingDecision {
  const { alert, deliveries } = input;
  assertPriceMoney(alert.price, 'alert.price');
  if (alert.kind !== 'price_drop' && alert.kind !== 'restock') {
    throw new TypeError(`alert.kind: ${String(alert.kind)} does not stamp watch state`);
  }
  for (const [i, d] of deliveries.entries()) {
    if ((d.state === 'accepted') !== (d.acceptedAt !== null)) {
      throw new RangeError(`deliveries[${i}]: acceptedAt must be set exactly when accepted`);
    }
    if (d.acceptedAt !== null) timestampMs(d.acceptedAt, `deliveries[${i}].acceptedAt`);
  }

  const push = deliveries.filter((d) => d.channelType !== 'in_app');
  const counted = push.length > 0 ? push : deliveries;

  let acceptedAt: Timestamp | null = null;
  for (const d of counted) {
    if (d.acceptedAt !== null && (acceptedAt === null || d.acceptedAt < acceptedAt)) {
      acceptedAt = d.acceptedAt;
    }
  }
  if (acceptedAt === null) {
    const pending = counted.some((d) => d.state === 'pending');
    return { stamp: null, status: pending ? 'awaiting_delivery' : 'undelivered' };
  }
  const stamp: WatchStamp =
    alert.kind === 'price_drop'
      ? { kind: 'price_cooldown', at: acceptedAt, price: alert.price }
      : { kind: 'restock_watermark', at: acceptedAt };
  return { stamp, status: 'accepted' };
}
