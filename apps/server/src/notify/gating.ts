// The delivery-gating read model (S§2.11, S§5.8, S§5.11). Nothing is stamped on a watch: its last
// accepted alert is read from the outbox (migration 0002's design note, `LAST_ACCEPTED` in
// packages/db/test/state.test.ts).
//
// The rule (owner's ruling of 2026-11-23; orchestrator's settlement of 2026-11-24):
// - Push means every channel type but `in_app`.
// - An event counts as delivered at the earliest accepted_at of its push deliveries.
// - Acceptance by the in-app channel alone does not count while the event has a push delivery that
//   is live: push keeps being retried until a push channel accepts.
// - Where the event has no live push delivery at all, its in-app acceptance is the delivery.
// - A push delivery is live unless it is pending and will never be attempted: its channel is
//   disabled or removed, or it was parked (PARKED_AT) when its channel was. Such a delivery is
//   left out, as if the channel had not been configured for the event, so an alert never stays
//   "awaiting delivery" forever because a channel was switched off. Accepted and failed deliveries
//   always count, whatever their channel's state now: a failed push still means "not delivered by
//   push", and the in-app acceptance does not stand in for it.
import { type Database, schema } from '@agentic-dasher/db';
import type { ChannelType, DeliveryState, Money } from '@agentic-dasher/shared';
import { eq, sql } from 'drizzle-orm';
import { PARKED_AT } from './store.ts';

export type GatedKind = 'price_drop' | 'restock';

export interface LastAcceptedAlert {
  readonly eventId: number;
  /** When it counts as delivered: the earliest push acceptance, or the in-app one (see above). */
  readonly acceptedAt: string;
  readonly observationId: number;
  /** The observation's effective price; null when it has none (currency unknown, no price). */
  readonly price: Money | null;
}

/**
 * The newest event of the watch and kind that counts as delivered, or null when none does, with the
 * time it counts as delivered (its own acceptance: the cooldown starts there).
 *
 * "Newest" is by the event's order (its id: the order in which the decisions were recorded), not by
 * acceptance time (finding 5 of the review of 2026-11-25). Deliveries can be accepted out of order:
 * with A (90.00) and then B (80.00, a further drop) both on their way, a push may accept B and then
 * A a minute later. The user has then been told 80.00, and B is what a new read must beat; ordering
 * by acceptance would make A "the last accepted" and let 85.00 pass as a further drop. The newest
 * accepted decision is preferred over "the lowest accepted price within the cooldown" because it is
 * also right after the cooldown (a price that rose and was alerted again must not be compared with
 * an older, lower one) and it keeps one alert as the basis of both the price and the cooldown.
 */
export function lastAcceptedAlert(
  db: Database,
  query: { readonly profileId: number; readonly watchId: number; readonly kind: GatedKind },
): LastAcceptedAlert | null {
  const row = db.orm.get<{
    eventId: number;
    observationId: number;
    effective: number | null;
    currency: string;
    acceptedAt: string;
  }>(sql`
    select e.id as eventId, e.observation_id as observationId, o.effective as effective,
      o.currency as currency, min(d.accepted_at) as acceptedAt
    from notification_event e
    join delivery d on d.event_id = e.id and d.state = 'accepted'
    join channel c on c.id = d.channel_id
    join price_observation o on o.id = e.observation_id
    where e.profile_id = ${query.profileId} and e.watch_id = ${query.watchId}
      and e.kind = ${query.kind}
      and (c.type <> 'in_app' or not exists (
        select 1 from delivery p join channel pc on pc.id = p.channel_id
        where p.event_id = e.id and pc.type <> 'in_app'
          and not (p.state = 'pending' and (
            pc.disabled_at is not null or pc.removed_at is not null
            or p.next_attempt_at = ${PARKED_AT}))))
    group by e.id
    order by e.id desc
    limit 1`);
  if (row === undefined) return null;
  return {
    eventId: row.eventId,
    acceptedAt: row.acceptedAt,
    observationId: row.observationId,
    price:
      row.effective === null || row.currency === 'unknown'
        ? null
        : { amountMinor: row.effective, currency: row.currency as Money['currency'] },
  };
}

/** One delivery of an event, in the shape of alert-delivery-gating's GatingDelivery. */
export interface EventDelivery {
  readonly channelId: number;
  readonly channelType: ChannelType;
  readonly state: DeliveryState;
  readonly acceptedAt: string | null;
}

/**
 * The deliveries of an event that the gating decision should see: every delivery except a pending
 * one that will never be attempted (see the rule above). The alert rules (packages/core/src/alerts,
 * `GateOnDelivery`) take these as `deliveries`.
 */
export function gatingDeliveries(db: Database, eventId: number): EventDelivery[] {
  const { delivery, channel } = schema;
  const rows = db.orm
    .select({
      channelId: delivery.channelId,
      channelType: channel.type,
      state: delivery.state,
      acceptedAt: delivery.acceptedAt,
      nextAttemptAt: delivery.nextAttemptAt,
      disabledAt: channel.disabledAt,
      removedAt: channel.removedAt,
    })
    .from(delivery)
    .innerJoin(channel, eq(channel.id, delivery.channelId))
    .where(eq(delivery.eventId, eventId))
    .orderBy(delivery.channelId)
    .all();
  return rows
    .filter(
      (r) =>
        r.state !== 'pending' ||
        (r.disabledAt === null && r.removedAt === null && r.nextAttemptAt !== PARKED_AT),
    )
    .map((r) => ({
      channelId: r.channelId,
      channelType: r.channelType,
      state: r.state,
      acceptedAt: r.acceptedAt,
    }));
}

export type AlertDeliveryStatus = 'accepted' | 'awaiting_delivery' | 'undelivered';

/**
 * The event's delivery status as a whole (alert-delivery-gating's proposed vocabulary), for the
 * UI's "awaiting delivery" and Diagnostics. Same rule as `lastAcceptedAlert`.
 */
export function deliveryStatus(deliveries: readonly EventDelivery[]): AlertDeliveryStatus {
  const push = deliveries.filter((d) => d.channelType !== 'in_app');
  const judged = push.length > 0 ? push : deliveries;
  if (judged.some((d) => d.state === 'accepted')) return 'accepted';
  if (judged.some((d) => d.state === 'pending')) return 'awaiting_delivery';
  return 'undelivered';
}
