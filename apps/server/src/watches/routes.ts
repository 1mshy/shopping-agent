// The watch API (S§5.8, S§5.12 Watches, S§5.15 human-only doors). A Hono sub-app, not mounted here:
// the integration unit mounts it behind the session middleware, e.g.
// `app.route('/api', createWatchRoutes(…))`. Every body and query is validated with the zod
// schemas of packages/shared (watch-api.ts). No route takes a profile id from the client.
//
//   POST   /watches               create (save first), then the immediate lookup attempt
//   GET    /watches               list (?includeArchived=1 adds archived ones)
//   GET    /watches/:id           one watch with its listings
//   PATCH  /watches/:id           rules, pause/resume, user-confirmed reference
//   DELETE /watches/:id           archive (the UI's delete)
//   POST   /watches/:id/listings/:listingId/{exclude,track,wrong-match}
//   GET    /listings/:id          one listing with its deal verdict (judgeDeal at now)
//   GET    /listings/:id/history  observations oldest first, for the chart
//   POST   /refresh               idempotent: the injected refresh (the scheduler's trigger)
//   GET    /notifications         the in-app feed, newest first, paged
//   GET    /diagnostics/jobs      the scheduler's health and the recent job runs
//   GET    /diagnostics/fetch     the host_access playbook and the available rungs
//
// A refusal answers `{ error: { code, message, fields? } }` with 400, 404 or 409.
import { judgeDeal } from '@agentic-dasher/core';
import { type Database, DEFAULT_PROFILE_ID, schema } from '@agentic-dasher/db';
import {
  CreateWatchBody,
  type CreateWatchResponse,
  type ListingCurrency,
  type ListingHistory,
  type NotificationItem,
  type NotificationsPage,
  NotificationsQuery,
  type Rung,
  UpdateWatchBody,
} from '@agentic-dasher/shared';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { buildMessage, loadAlertRecords } from '../notify/message.ts';
import { eventFromRow } from '../notify/store.ts';
import type { JobHealth } from '../scheduler/index.ts';
import { WatchError, type WatchErrorCode, type WatchService } from './service.ts';

/** What `refresh()` answers: the scheduler's trigger result, without its promise. */
export interface RefreshResult {
  readonly runId: number;
  readonly joined: boolean;
}

/** The fetch rungs available in Phase 1 (S§5.1); the browser rung is an add-on. */
export const AVAILABLE_RUNGS: readonly Rung[] = ['api', 'http'];

export interface WatchRoutesDeps {
  readonly db: Database;
  readonly watches: WatchService;
  /** Bound by the orchestrator to the scheduler's `trigger` (a running job is joined). */
  readonly refresh: () => RefreshResult;
  /** The scheduler's health (`scheduler.health`). */
  readonly jobs?: () => readonly JobHealth[];
  /** Milliseconds since the epoch, for the deal verdict's `now`. */
  readonly now?: () => number;
  /** The user's market country, the deal verdict's market key. */
  readonly marketCountry?: () => string | null;
  /** The profile of the request's session; v1 has one (S§1.2). */
  readonly profileId?: (c: Context) => number;
}

const STATUS: Record<WatchErrorCode, 400 | 404 | 409> = {
  invalid: 400,
  not_one_link_or_name: 400,
  not_an_http_link: 400,
  target_not_positive: 400,
  drop_out_of_range: 400,
  cooldown_too_short: 400,
  not_found: 404,
  market_not_set: 409,
  currency_mismatch: 409,
  no_currency_yet: 409,
  archived: 409,
};

const IdParam = z.coerce.number().int().positive();
const ListingAction = z.enum(['exclude', 'track', 'wrong-match']);

function refusal(c: Context, error: unknown) {
  if (error instanceof WatchError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      },
      STATUS[error.code],
    );
  }
  throw error;
}

function fieldsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join('.') || '_'] = issue.message;
  return fields;
}

async function body<T extends z.ZodType>(c: Context, schemaOf: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new WatchError('invalid', 'the body is not JSON');
  }
  const parsed = schemaOf.safeParse(raw);
  if (!parsed.success) {
    throw new WatchError(
      'invalid',
      'the body does not have the expected shape',
      fieldsOf(parsed.error),
    );
  }
  return parsed.data;
}

function idOf(c: Context, what: string): number {
  const parsed = IdParam.safeParse(c.req.param('id'));
  if (!parsed.success) throw new WatchError('not_found', `no such ${what}`);
  return parsed.data;
}

export function createWatchRoutes(deps: WatchRoutesDeps) {
  const { db, watches } = deps;
  const o = db.orm;
  const profileOf = deps.profileId ?? (() => DEFAULT_PROFILE_ID);

  function history(listingId: number): ListingHistory {
    const { listing, priceObservation: p } = schema;
    const exists = o
      .select({ id: listing.id })
      .from(listing)
      .where(eq(listing.id, listingId))
      .get();
    if (exists === undefined) throw new WatchError('not_found', 'no such listing');
    const points = o
      .select({
        observationId: p.id,
        observedAt: p.observedAt,
        currency: p.currency,
        effective: p.effective,
        sticker: p.sticker,
        availability: p.availability,
      })
      .from(p)
      .where(eq(p.listingId, listingId))
      .orderBy(asc(p.observedAt), asc(p.id))
      .all();
    return { listingId, points };
  }

  /**
   * One listing and its deal verdict (S§5.5) from its own observations at now. Peers are not
   * passed yet (the cross-store form needs the product grouping of Phase 2), so that tier says
   * `no_peers`. A refusal of the verdict (unknown currency, mixed currencies) is shown as such.
   */
  function listingDetail(listingId: number) {
    const { listing, store, priceObservation: p } = schema;
    const l = o
      .select({
        id: listing.id,
        storeId: listing.storeId,
        url: listing.urlCanonical,
        title: listing.title,
        condition: listing.condition,
        currency: listing.currency,
        storeHost: store.host,
        trustTier: store.trustTier,
      })
      .from(listing)
      .innerJoin(store, eq(store.id, listing.storeId))
      .where(eq(listing.id, listingId))
      .get();
    if (l === undefined) throw new WatchError('not_found', 'no such listing');
    const history = o
      .select({
        id: p.id,
        observedAt: p.observedAt,
        effective: p.effective,
        currency: p.currency,
        availability: p.availability,
      })
      .from(p)
      .where(eq(p.listingId, listingId))
      .orderBy(asc(p.observedAt), asc(p.id))
      .all();
    // Until the sweep records the listing's currency, the latest priced read's currency stands.
    const latestPriced = [...history].reverse().find((h) => h.currency !== 'unknown');
    const currency: ListingCurrency =
      l.currency !== 'unknown' ? l.currency : (latestPriced?.currency ?? 'unknown');
    const judged =
      history.length === 0
        ? null
        : judgeDeal({
            now: new Date((deps.now ?? Date.now)()).toISOString(),
            listing: {
              listingId,
              storeId: l.storeId,
              currency,
              condition: l.condition,
              market: deps.marketCountry?.() ?? '',
            },
            history,
            peers: [],
          });
    return {
      listing: { ...l, conditionUnknown: l.condition === 'unknown' },
      verdict: judged?.ok ? judged.value : null,
      verdictRefusal: judged && !judged.ok ? judged.refusal : null,
    };
  }

  function notifications(profileId: number, query: NotificationsQuery): NotificationsPage {
    const { notificationEvent: e, delivery: d, channel: ch } = schema;
    const limit = query.limit ?? 50;
    const rows = o
      .select()
      .from(e)
      .where(
        and(
          eq(e.profileId, profileId),
          query.before !== undefined ? lt(e.id, query.before) : undefined,
        ),
      )
      .orderBy(desc(e.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    const items = page.map((r): NotificationItem => {
      const event = eventFromRow(r);
      const records = 'watchId' in event ? loadAlertRecords(db, event) : null;
      const message = buildMessage(event, records);
      const inApp = o
        .select({ state: d.state })
        .from(d)
        .innerJoin(ch, eq(ch.id, d.channelId))
        .where(and(eq(d.eventId, r.id), eq(ch.type, 'in_app')))
        .get();
      return {
        eventId: r.id,
        kind: r.kind,
        createdAt: r.createdAt,
        watchId: r.watchId,
        listingId: r.listingId,
        title: message.title,
        body: message.body,
        url: message.url,
        inApp: inApp?.state ?? null,
      };
    });
    const last = page.at(-1);
    return { items, next: rows.length > limit && last !== undefined ? last.id : null };
  }

  return new Hono()
    .post('/watches', async (c) => {
      try {
        const input = await body(c, CreateWatchBody);
        const result = watches.create(profileOf(c), input);
        if (result.created) {
          // Save first: the row is committed; only now is the lookup attempted.
          await watches.runLookup(result.watch.id, c.req.raw.signal);
          const fresh = watches.get(profileOf(c), result.watch.id).watch;
          return c.json({ created: true, watch: fresh } satisfies CreateWatchResponse, 201);
        }
        return c.json({ created: false, watch: result.watch } satisfies CreateWatchResponse, 200);
      } catch (error) {
        return refusal(c, error);
      }
    })
    .get('/watches', (c) => {
      const includeArchived = c.req.query('includeArchived') === '1';
      return c.json({ watches: watches.list(profileOf(c), { includeArchived }) });
    })
    .get('/watches/:id', (c) => {
      try {
        return c.json(watches.get(profileOf(c), idOf(c, 'watch')));
      } catch (error) {
        return refusal(c, error);
      }
    })
    .patch('/watches/:id', async (c) => {
      try {
        const id = idOf(c, 'watch');
        const input = await body(c, UpdateWatchBody);
        return c.json({ watch: watches.update(profileOf(c), id, input) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .delete('/watches/:id', (c) => {
      try {
        return c.json({ watch: watches.archive(profileOf(c), idOf(c, 'watch')) });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post('/watches/:id/listings/:listingId/:action', (c) => {
      try {
        const id = idOf(c, 'watch');
        const listingId = IdParam.safeParse(c.req.param('listingId'));
        const action = ListingAction.safeParse(c.req.param('action'));
        if (!listingId.success || !action.success) {
          throw new WatchError('not_found', 'no such listing action');
        }
        const verb = action.data === 'wrong-match' ? 'wrong_match' : action.data;
        return c.json({
          listing: watches.setListingRole(profileOf(c), id, listingId.data, verb),
        });
      } catch (error) {
        return refusal(c, error);
      }
    })
    .get('/listings/:id', (c) => {
      try {
        return c.json(listingDetail(idOf(c, 'listing')));
      } catch (error) {
        return refusal(c, error);
      }
    })
    .get('/diagnostics/jobs', (c) => {
      const { job, jobRun } = schema;
      const runs = o
        .select({
          id: jobRun.id,
          job: job.name,
          status: jobRun.status,
          reason: jobRun.reason,
          startedAt: jobRun.startedAt,
          endedAt: jobRun.endedAt,
          coalescedSlots: jobRun.coalescedSlots,
          detail: jobRun.detail,
        })
        .from(jobRun)
        .innerJoin(job, eq(job.id, jobRun.jobId))
        .orderBy(desc(jobRun.startedAt), desc(jobRun.id))
        .limit(50)
        .all();
      return c.json({ jobs: deps.jobs?.() ?? [], runs });
    })
    .get('/diagnostics/fetch', (c) => {
      const hosts = o
        .select()
        .from(schema.hostAccess)
        .orderBy(asc(schema.hostAccess.host), asc(schema.hostAccess.pageKind))
        .all();
      return c.json({ rungs: AVAILABLE_RUNGS, hosts });
    })
    .get('/listings/:id/history', (c) => {
      try {
        return c.json(history(idOf(c, 'listing')));
      } catch (error) {
        return refusal(c, error);
      }
    })
    .post('/refresh', (c) => {
      const result = deps.refresh();
      return c.json({ runId: result.runId, joined: result.joined }, 202);
    })
    .get('/notifications', (c) => {
      try {
        const parsed = NotificationsQuery.safeParse(c.req.query());
        if (!parsed.success) {
          throw new WatchError('invalid', 'the query is not valid', fieldsOf(parsed.error));
        }
        return c.json(notifications(profileOf(c), parsed.data));
      } catch (error) {
        return refusal(c, error);
      }
    });
}

export type WatchRoutes = ReturnType<typeof createWatchRoutes>;
