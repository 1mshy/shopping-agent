// S§4.4 notification_event and delivery: the outbox (S§5.11).
import { z } from 'zod';
import { Id, Timestamp } from './common.ts';

const event = {
  id: Id,
  profileId: Id,
  /** Stable event key: the outbox's (event, channel) keys rest on it. */
  key: z.string().min(1).max(200),
  createdAt: Timestamp,
};
const text = z.string().min(1).max(4000);
/** An alert references the engine records it rests on; the figures shown are read from them. */
const listingAlert = { ...event, watchId: Id, listingId: Id, observationId: Id };

/** Every alert, recommendation, agent message and system notice (S§5.11), by kind. */
export const NotificationEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('price_drop'), ...listingAlert }),
  z.strictObject({ kind: z.literal('restock'), ...listingAlert }),
  /** Pushed on a valuation, which rests on a price (S§5.9). */
  z.strictObject({ kind: z.literal('new_listing'), ...listingAlert }),
  z.strictObject({ kind: z.literal('recommendation'), ...event, feedCardId: Id }),
  /** Model prose, rendered as plain text (S§5.15); its placeholder contract is Phase 2's (S§2.1). */
  z.strictObject({ kind: z.literal('agent'), ...event, runId: Id, text }),
  z.strictObject({ kind: z.literal('system'), ...event, text }),
]);
export type NotificationEvent = z.infer<typeof NotificationEvent>;

const delivery = { id: Id, profileId: Id, eventId: Id, channelId: Id };

/**
 * One event through one channel (S§5.11). `accepted` means the channel confirmed acceptance and is
 * the only state that may stamp a cooldown or "notified" (S§2.11); an attempted or sent delivery
 * that was not accepted stays `pending` (to retry) or `failed`.
 */
export const Delivery = z.discriminatedUnion('state', [
  z
    .strictObject({
      state: z.literal('pending'),
      ...delivery,
      attempts: z.int().nonnegative(),
      outcome: z.literal('retry').nullable(),
      nextAttemptAt: Timestamp,
      acceptedAt: z.null(),
    })
    .refine((d) => (d.attempts === 0) === (d.outcome === null), {
      path: ['outcome'],
      message: 'a pending delivery has an outcome exactly when it was attempted',
    }),
  z.strictObject({
    state: z.literal('accepted'),
    ...delivery,
    attempts: z.int().positive(),
    outcome: z.literal('accepted'),
    nextAttemptAt: z.null(),
    acceptedAt: Timestamp,
  }),
  z.strictObject({
    state: z.literal('failed'),
    ...delivery,
    attempts: z.int().positive(),
    outcome: z.literal('failed'),
    nextAttemptAt: z.null(),
    acceptedAt: z.null(),
  }),
]);
export type Delivery = z.infer<typeof Delivery>;
