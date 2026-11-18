// Contract of delivery-gated state (S§2 invariant 11 "A cooldown or 'notified' stamp is set only
// when a channel confirms acceptance"; S§5.11 "Each channel returns a per-channel outcome, which
// gates the cooldown"; predecessor service.py `_evaluate_trackers` 1311-1336). A pure decision:
// given an alert and the state of each of its deliveries, what (if anything) to stamp on the watch.
import type {
  ChannelType,
  DeliveryState,
  Id,
  Money,
  NotificationKind,
  Timestamp,
} from '@agentic-dasher/shared';

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
 * What to write on the watch. A price alert stamps the cooldown (when, and at what price, so the
 * next evaluation can tell a further drop or a moved price); a restock alert moves the restock
 * watermark. `null`: nothing is stamped, so the watch stays armed.
 */
export type WatchStamp =
  | { readonly kind: 'price_cooldown'; readonly at: Timestamp; readonly price: Money }
  | { readonly kind: 'restock_watermark'; readonly at: Timestamp };

/**
 * Proposed vocabulary. The alert's delivery status as a whole: `accepted` (a channel accepted it),
 * `awaiting_delivery` (none accepted yet, at least one still pending: the outbox keeps retrying),
 * `undelivered` (no channel accepted and none is pending). The event itself is kept in every case
 * (S§2.11: every alert is written to one audit trail, delivered or not).
 */
export type AlertDeliveryStatus = 'accepted' | 'awaiting_delivery' | 'undelivered';

export interface DeliveryGatingDecision {
  readonly stamp: WatchStamp | null;
  readonly status: AlertDeliveryStatus;
}

/**
 * The subject (Phase 1, the outbox in apps/server or packages/core). The stamp is set only when at
 * least one delivery is `accepted`; its time is that delivery's `acceptedAt`. Pending or failed
 * deliveries never stamp. Whether the always-on in-app channel's acceptance stamps the cooldown on
 * its own is open (see the area report); no case here includes an in-app delivery.
 */
export type GateOnDelivery = (input: DeliveryGatingInput) => DeliveryGatingDecision;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface DeliveryGatingCase {
  readonly id: string;
  readonly what: string;
  readonly input: DeliveryGatingInput;
  readonly expected: DeliveryGatingDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
