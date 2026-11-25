// Small shared pieces of the outbox's SQL side.
import { type Database, schema } from '@agentic-dasher/db';
import { NotificationEvent } from '@agentic-dasher/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

export type EventRow = typeof schema.notificationEvent.$inferSelect;
export type ChannelRow = typeof schema.channel.$inferSelect;
export type DeliveryRow = typeof schema.delivery.$inferSelect;

/**
 * The next_attempt_at of a pending delivery that will never be attempted: one whose channel was
 * disabled or removed while it was pending. The schema cannot move it to `failed` (a failed
 * delivery has been attempted, `delivery_outcome`), and it must not be sent if the channel is
 * switched on again weeks later, so it is parked here: never due, and left out of the gating
 * status (gating.ts). Its attempts and outcome stay what they were.
 */
export const PARKED_AT = '9999-12-31T23:59:59.999Z';

/** The S§4 timestamp form. */
export function iso(ms: number): string {
  return new Date(Math.floor(ms)).toISOString();
}

/**
 * Runs `fn` in a `BEGIN IMMEDIATE` transaction: the write lock is taken before the first read, so
 * two passes or two writers on one database file decide one after the other. `fn` is synchronous.
 */
export function immediate<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
  return result;
}

/** A notification_event row as the shared contract, validated. */
export function eventFromRow(row: EventRow): NotificationEvent {
  const base = { id: row.id, profileId: row.profileId, key: row.key, createdAt: row.createdAt };
  switch (row.kind) {
    case 'price_drop':
    case 'restock':
    case 'new_listing':
      return NotificationEvent.parse({
        ...base,
        kind: row.kind,
        watchId: row.watchId,
        listingId: row.listingId,
        observationId: row.observationId,
      });
    case 'recommendation':
      return NotificationEvent.parse({ ...base, kind: row.kind, feedCardId: row.feedCardId });
    case 'agent':
      return NotificationEvent.parse({ ...base, kind: row.kind, runId: row.runId, text: row.text });
    case 'system':
      return NotificationEvent.parse({ ...base, kind: row.kind, text: row.text });
  }
}

export function eventById(db: Database, id: number): EventRow | undefined {
  return db.orm
    .select()
    .from(schema.notificationEvent)
    .where(eq(schema.notificationEvent.id, id))
    .get();
}

/**
 * The profile's in-app channel, created when missing (S§5.11: in-app is always on). It is never
 * disabled or removed by the channel service.
 */
export function ensureInAppChannel(db: Database, profileId: number, now: string): ChannelRow {
  const { channel } = schema;
  const found = db.orm
    .select()
    .from(channel)
    .where(
      and(
        eq(channel.profileId, profileId),
        eq(channel.type, 'in_app'),
        isNull(channel.removedAt),
        isNull(channel.disabledAt),
      ),
    )
    .orderBy(asc(channel.id))
    .get();
  if (found !== undefined) return found;
  return db.orm
    .insert(channel)
    .values({
      profileId,
      type: 'in_app',
      config: {},
      secretEnc: null,
      name: 'In the app',
      createdAt: now,
      disabledAt: null,
      removedAt: null,
    })
    .returning()
    .get();
}
