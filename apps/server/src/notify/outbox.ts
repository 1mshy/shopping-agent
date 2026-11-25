// The outbox pass (S§5.11, S§2.11, S§2.12): take the pending deliveries that are due, send each
// through its channel's adapter, record each channel's outcome. No model anywhere (S§2.4).
//
// Guarantees, and where they come from:
// - Only `accepted` (the adapter saw the channel confirm acceptance: a 2xx, or the in-app row) sets
//   accepted_at. Every state change is a plain UPDATE of one delivery; nothing is upserted or
//   deleted, and the audit triggers stay as they are.
// - Claiming is a lease: in one IMMEDIATE transaction the pass picks the due deliveries and moves
//   their next_attempt_at to now + leaseMs. A concurrent pass (same process or another one on the
//   same file) does not see them as due, so it does not send them too. Every outcome UPDATE is
//   conditional on the delivery still being pending (and, except for acceptance, on still holding
//   the lease), so a late pass cannot overwrite a newer decision.
// - A crash at any point leaves the delivery pending with its lease, so it is due again when the
//   lease runs out: before the send, after it, or between a successful send and the UPDATE. The
//   last case sends the message a second time: delivery is AT LEAST ONCE, never "accepted without
//   acceptance". The webhook carries an Idempotency-Key so a receiver can drop the repeat; ntfy has
//   no such key.
// - Channels are independent: each channel's deliveries run in order, channels run side by side,
//   and one channel's failures (or thrown errors) never fail the pass or another channel.
// - Deliveries of a disabled or removed channel are never claimed (channels.ts parks them).
import { type AttemptResult, decideDeliveryRetry } from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import type { NotificationEvent } from '@agentic-dasher/shared';
import { and, asc, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import type { SecretBox } from '../secrets/index.ts';
import type { ChannelOutcome, ErrorClass, MessageLabel } from './adapters/index.ts';
import { buildMessage, loadAlertRecords } from './message.ts';
import { eventById, eventFromRow, immediate, iso } from './store.ts';
import { resolveTarget } from './target.ts';

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
/**
 * How long a claimed delivery is held. It must exceed the longest a pass can spend on one
 * delivery: four requests of DEFAULT_REQUEST_TIMEOUT_MS plus three waits of at most 30 s each
 * (130 s); a pass that dies leaves its deliveries due again after this.
 */
export const DEFAULT_LEASE_MS = 10 * 60_000;
export const DEFAULT_BATCH_SIZE = 200;
/** When a channel cannot be sent through at all (its secret no longer decrypts), try again then. */
export const DEFAULT_UNAVAILABLE_RETRY_MS = 5 * 60_000;

export interface OutboxPassOptions {
  readonly db: Database;
  readonly secrets: SecretBox;
  /** Epoch milliseconds (the scheduler's clock). */
  readonly now: () => number;
  /** The job's signal: on abort no new attempt starts and what is in flight is left pending. */
  readonly signal?: AbortSignal;
  /** The job's partial-results reporter (cumulative counts, for Diagnostics). */
  readonly report?: (partial: Record<string, unknown>) => void;
  /** Waits between attempts; injected by tests. Rejects on abort. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly leaseMs?: number;
  readonly batchSize?: number;
  readonly unavailableRetryMs?: number;
  /** Labels the caller supplies for an event (a caution store is added by code on its own). */
  readonly labelsFor?: (event: NotificationEvent) => readonly MessageLabel[];
  /** Errors that did not fail the pass. Never given a secret. */
  readonly onError?: (error: unknown, context: string) => void;
}

export type DeliveryResult = 'accepted' | 'failed' | 'retry' | 'released' | 'unavailable' | 'error';

export interface PassDelivery {
  readonly deliveryId: number;
  readonly channelId: number;
  readonly result: DeliveryResult;
  /** Attempts made in this pass. */
  readonly attempts: number;
  readonly errorClass: ErrorClass | null;
  /** Redacted. */
  readonly detail: string | null;
}

export interface OutboxPassResult {
  readonly claimed: number;
  readonly accepted: number;
  readonly failed: number;
  /** Attempted and left pending for a later pass. */
  readonly retry: number;
  /** Not attempted: their channel deferred, or the pass was stopped; still pending. */
  readonly released: number;
  readonly unavailable: number;
  readonly errors: number;
  readonly deliveries: readonly PassDelivery[];
}

interface Claimed {
  readonly id: number;
  readonly eventId: number;
  readonly channelId: number;
  /** next_attempt_at before the claim. */
  readonly original: string;
  /** next_attempt_at while claimed: the lease token. */
  readonly lease: string;
}

const { delivery, channel } = schema;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(handle);
      reject(signal.reason);
    };
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    handle.unref();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Picks the due deliveries of enabled channels and leases them, in one IMMEDIATE transaction. */
function claim(db: Database, nowMs: number, leaseMs: number, batchSize: number): Claimed[] {
  const now = iso(nowMs);
  const lease = iso(nowMs + leaseMs);
  return immediate(db, () => {
    const due = db.orm
      .select({
        id: delivery.id,
        eventId: delivery.eventId,
        channelId: delivery.channelId,
        nextAttemptAt: delivery.nextAttemptAt,
      })
      .from(delivery)
      .innerJoin(channel, eq(channel.id, delivery.channelId))
      .where(
        and(
          eq(delivery.state, 'pending'),
          lte(delivery.nextAttemptAt, now),
          isNull(channel.disabledAt),
          isNull(channel.removedAt),
        ),
      )
      .orderBy(asc(delivery.nextAttemptAt), asc(delivery.id))
      .limit(batchSize)
      .all();
    const claimed: Claimed[] = [];
    for (const d of due) {
      const original = d.nextAttemptAt;
      if (original === null) continue;
      if (decideDeliveryRetry({ kind: 'due', now, nextAttemptAt: original }).action !== 'attempt') {
        continue;
      }
      const changed = db.orm
        .update(delivery)
        .set({ nextAttemptAt: lease })
        .where(
          and(
            eq(delivery.id, d.id),
            eq(delivery.state, 'pending'),
            eq(delivery.nextAttemptAt, original),
          ),
        )
        .run().changes;
      if (changed === 1) claimed.push({ ...d, original, lease });
    }
    return claimed;
  });
}

/** The channel confirmed acceptance: the only write that sets accepted_at (S§2.11). */
function recordAccepted(db: Database, d: Claimed, attempts: number, at: string): void {
  db.orm
    .update(delivery)
    .set({
      state: 'accepted',
      outcome: 'accepted',
      attempts: sql`${delivery.attempts} + ${attempts}`,
      nextAttemptAt: null,
      acceptedAt: at,
    })
    .where(and(eq(delivery.id, d.id), ne(delivery.state, 'accepted')))
    .run();
}

function recordFailed(db: Database, d: Claimed, attempts: number): void {
  db.orm
    .update(delivery)
    .set({
      state: 'failed',
      outcome: 'failed',
      attempts: sql`${delivery.attempts} + ${attempts}`,
      nextAttemptAt: null,
      acceptedAt: null,
    })
    .where(
      and(
        eq(delivery.id, d.id),
        eq(delivery.state, 'pending'),
        eq(delivery.nextAttemptAt, d.lease),
      ),
    )
    .run();
}

/** Attempted, not accepted, retryable: stays pending until `next`. */
function recordRetry(db: Database, d: Claimed, attempts: number, next: string): void {
  db.orm
    .update(delivery)
    .set({
      outcome: 'retry',
      attempts: sql`${delivery.attempts} + ${attempts}`,
      nextAttemptAt: next,
    })
    .where(
      and(
        eq(delivery.id, d.id),
        eq(delivery.state, 'pending'),
        eq(delivery.nextAttemptAt, d.lease),
      ),
    )
    .run();
}

/** Not attempted: gives the lease back, due again at `next`. Attempts and outcome are unchanged. */
function release(db: Database, d: Claimed, next: string): void {
  db.orm
    .update(delivery)
    .set({ nextAttemptAt: next })
    .where(
      and(
        eq(delivery.id, d.id),
        eq(delivery.state, 'pending'),
        eq(delivery.nextAttemptAt, d.lease),
      ),
    )
    .run();
}

function later(a: string, b: string): string {
  return a > b ? a : b;
}

const isListingAlert = (
  e: NotificationEvent,
): e is Extract<NotificationEvent, { watchId: number }> =>
  e.kind === 'price_drop' || e.kind === 'restock' || e.kind === 'new_listing';

/**
 * One outbox pass. Fits the scheduler as a job handler:
 * `handler: (ctx) => runOutboxPass({ ...deps, signal: ctx.signal, report: ctx.report })`; its
 * result is a JSON object for the run's detail. It throws only when the claim itself fails (the
 * database is unusable); everything after the claim is per delivery.
 */
export async function runOutboxPass(options: OutboxPassOptions): Promise<OutboxPassResult> {
  const { db, now } = options;
  const signal = options.signal ?? new AbortController().signal;
  const sleep = options.sleep ?? defaultSleep;
  const onError = options.onError ?? (() => {});
  const sendContext = {
    signal,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    fetch: options.fetch ?? globalThis.fetch,
  };
  const unavailableRetryMs = options.unavailableRetryMs ?? DEFAULT_UNAVAILABLE_RETRY_MS;

  const claimed = claim(
    db,
    now(),
    options.leaseMs ?? DEFAULT_LEASE_MS,
    options.batchSize ?? DEFAULT_BATCH_SIZE,
  );
  const results: PassDelivery[] = [];
  const counts = {
    claimed: claimed.length,
    accepted: 0,
    failed: 0,
    retry: 0,
    released: 0,
    unavailable: 0,
    errors: 0,
  };
  const done = (r: PassDelivery) => {
    results.push(r);
    counts[r.result === 'error' ? 'errors' : r.result] += 1;
    options.report?.({ ...counts });
  };

  const byChannel = new Map<number, Claimed[]>();
  for (const d of claimed) byChannel.set(d.channelId, [...(byChannel.get(d.channelId) ?? []), d]);

  async function runChannel(channelId: number, queue: readonly Claimed[]): Promise<void> {
    let row: typeof channel.$inferSelect | undefined;
    try {
      row = db.orm.select().from(channel).where(eq(channel.id, channelId)).get();
    } catch (error) {
      onError(error, `outbox: channel ${channelId}`);
    }
    const resolved = row === undefined ? null : resolveTarget(row, options.secrets);
    if (resolved === null || !resolved.ok) {
      const reason = resolved === null ? 'the channel could not be read' : resolved.reason;
      for (const d of queue) {
        try {
          release(db, d, iso(now() + unavailableRetryMs));
        } catch (error) {
          onError(error, `outbox: delivery ${d.id}`);
        }
        done({
          deliveryId: d.id,
          channelId,
          result: 'unavailable',
          attempts: 0,
          errorClass: null,
          detail: reason,
        });
      }
      return;
    }
    const { adapter, target } = resolved;
    /** Set once the channel deferred: the rest of its queue waits, unattempted. */
    let deferredTo: string | null = null;

    for (const d of queue) {
      if (deferredTo !== null || signal.aborted) {
        try {
          release(db, d, deferredTo === null ? d.original : later(d.original, deferredTo));
        } catch (error) {
          onError(error, `outbox: delivery ${d.id}`);
        }
        done({
          deliveryId: d.id,
          channelId,
          result: 'released',
          attempts: 0,
          errorClass: null,
          detail: null,
        });
        continue;
      }
      const attempts: AttemptResult[] = [];
      let last: ChannelOutcome | null = null;
      try {
        const eventRow = eventById(db, d.eventId);
        if (eventRow === undefined) throw new Error(`event ${d.eventId} is missing`);
        const event = eventFromRow(eventRow);
        const records = isListingAlert(event) ? loadAlertRecords(db, event) : null;
        const message = buildMessage(event, records, options.labelsFor?.(event) ?? [], now());
        let result: DeliveryResult | null = null;
        while (result === null) {
          if (signal.aborted) {
            // Stopped before this attempt: the delivery stays pending, due at once.
            if (attempts.length === 0) {
              release(db, d, d.original);
              result = 'released';
            } else {
              recordRetry(db, d, attempts.length, iso(now()));
              result = 'retry';
            }
            break;
          }
          last = await adapter.send(message, target, sendContext);
          attempts.push(last.attempt);
          const at = iso(now());
          const decision = decideDeliveryRetry({ kind: 'after_attempt', now: at, attempts });
          switch (decision.action) {
            case 'accepted':
              recordAccepted(db, d, attempts.length, at);
              result = 'accepted';
              break;
            case 'fail':
              recordFailed(db, d, attempts.length);
              result = 'failed';
              break;
            case 'defer': {
              const next = decision.notBefore ?? at;
              recordRetry(db, d, attempts.length, next);
              deferredTo = next;
              result = 'retry';
              break;
            }
            case 'wait_and_retry':
              try {
                await sleep(decision.waitMs, signal);
              } catch {
                recordRetry(db, d, attempts.length, iso(now()));
                result = 'retry';
              }
              break;
            default:
              throw new Error(`unexpected decision ${decision.action}`);
          }
        }
        done({
          deliveryId: d.id,
          channelId,
          result,
          attempts: attempts.length,
          errorClass: result === 'accepted' ? null : (last?.errorClass ?? null),
          detail: result === 'accepted' ? null : (last?.detail ?? null),
        });
      } catch (error) {
        // A database or message error: the delivery keeps its lease and is due again when the
        // lease runs out (at least once). Never fails the pass or another channel.
        onError(error, `outbox: delivery ${d.id}`);
        done({
          deliveryId: d.id,
          channelId,
          result: 'error',
          attempts: attempts.length,
          errorClass: last?.errorClass ?? null,
          detail: 'an internal error stopped this delivery; it will be retried',
        });
      }
    }
  }

  await Promise.all([...byChannel].map(([channelId, queue]) => runChannel(channelId, queue)));
  results.sort((a, b) => a.deliveryId - b.deliveryId);
  return { ...counts, deliveries: results };
}
