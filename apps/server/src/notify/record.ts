// Recording an event (S§5.11, S§2.11): the event and one pending delivery per channel that should
// carry it, in one transaction. The event is the audit trail: it is written whether or not any
// channel ever accepts it. A stable key makes recording idempotent: the same key twice returns the
// event already there and adds nothing, so a re-evaluated alert never produces a second in-app
// event or a second push.
import { type Database, schema } from '@agentic-dasher/db';
import { NotificationEvent } from '@agentic-dasher/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { ADAPTERS } from './adapters/index.ts';
import { type EventRow, ensureInAppChannel, eventFromRow, immediate, iso } from './store.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An event to record: the shared NotificationEvent without the row id, the profile defaulting to
 * the caller's and `createdAt` to now.
 */
export type NotificationEventInput = DistributiveOmit<
  NotificationEvent,
  'id' | 'profileId' | 'createdAt'
> & { readonly createdAt?: string };

export interface RecordEventOptions {
  readonly profileId: number;
  readonly event: NotificationEventInput;
  /** Epoch milliseconds. */
  readonly now: () => number;
}

export interface RecordedEvent {
  readonly event: NotificationEvent;
  /** False when an event with this key already existed: nothing was written. */
  readonly created: boolean;
  /** The channels a pending delivery was written for (empty when not created). */
  readonly channelIds: readonly number[];
}

/** The stable key of a listing alert: one per (kind, watch, observation). */
export function alertEventKey(input: {
  readonly kind: 'price_drop' | 'restock' | 'new_listing';
  readonly watchId: number;
  readonly observationId: number;
}): string {
  return `${input.kind}:watch:${input.watchId}:observation:${input.observationId}`;
}

/** Thrown for an event that does not satisfy the shared contract; says which fields, not values. */
export class InvalidEventError extends Error {
  override name = 'InvalidEventError';
}

function findByKey(db: Database, profileId: number, key: string): EventRow | undefined {
  const e = schema.notificationEvent;
  return db.orm
    .select()
    .from(e)
    .where(and(eq(e.profileId, profileId), eq(e.key, key)))
    .get();
}

function isDuplicateRefusal(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (
      /notification_event is never replaced|UNIQUE constraint failed: notification_event/.test(
        e.message,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Records the event and its pending deliveries in one IMMEDIATE transaction. Must not be called
 * inside an open transaction: use `recordEventInTransaction` there.
 */
export function recordEvent(db: Database, options: RecordEventOptions): RecordedEvent {
  try {
    return immediate(db, () => recordEventInTransaction(db, options));
  } catch (error) {
    // Another writer recorded the same key between our read and our insert: the table refused the
    // duplicate (its trigger), and the event that exists is the answer.
    if (!isDuplicateRefusal(error)) throw error;
    const existing = findByKey(db, options.profileId, options.event.key);
    if (existing === undefined) throw error;
    return { event: eventFromRow(existing), created: false, channelIds: [] };
  }
}

/**
 * The body of `recordEvent`, for a caller that already holds a transaction (the alert evaluation
 * writing its decision and its event together). The caller commits or rolls back.
 */
export function recordEventInTransaction(db: Database, options: RecordEventOptions): RecordedEvent {
  const { profileId } = options;
  const createdAt = options.event.createdAt ?? iso(options.now());
  const candidate = { ...options.event, createdAt, profileId, id: 1 };
  const parsed = NotificationEvent.safeParse(candidate);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(event)'))];
    throw new InvalidEventError(
      `the event does not satisfy NotificationEvent: ${fields.join(', ')}`,
    );
  }

  const existing = findByKey(db, profileId, parsed.data.key);
  if (existing !== undefined)
    return { event: eventFromRow(existing), created: false, channelIds: [] };

  const e = parsed.data;
  const row = db.orm
    .insert(schema.notificationEvent)
    .values({
      profileId,
      key: e.key,
      kind: e.kind,
      createdAt: e.createdAt,
      watchId: 'watchId' in e ? e.watchId : null,
      listingId: 'listingId' in e ? e.listingId : null,
      observationId: 'observationId' in e ? e.observationId : null,
      feedCardId: 'feedCardId' in e ? e.feedCardId : null,
      runId: 'runId' in e ? e.runId : null,
      text: 'text' in e ? e.text : null,
    })
    .returning()
    .get();

  const now = iso(options.now());
  const inApp = ensureInAppChannel(db, profileId, now);
  const { channel } = schema;
  const others = db.orm
    .select({ id: channel.id, type: channel.type })
    .from(channel)
    .where(
      and(eq(channel.profileId, profileId), isNull(channel.disabledAt), isNull(channel.removedAt)),
    )
    .orderBy(asc(channel.id))
    .all();
  // Every enabled channel this build can send through; the in-app channel once. A channel of a
  // type with no adapter yet (a Phase 3 type written by a later build and rolled back) gets none.
  const channelIds = [
    inApp.id,
    ...others
      .filter((c) => c.id !== inApp.id && c.type !== 'in_app' && ADAPTERS[c.type] !== undefined)
      .map((c) => c.id),
  ];
  db.orm
    .insert(schema.delivery)
    .values(
      channelIds.map((channelId) => ({
        profileId,
        eventId: row.id,
        channelId,
        state: 'pending' as const,
        attempts: 0,
        outcome: null,
        nextAttemptAt: now,
        acceptedAt: null,
      })),
    )
    .run();
  return { event: eventFromRow(row), created: true, channelIds };
}
