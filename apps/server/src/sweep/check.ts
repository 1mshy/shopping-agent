// One listing's check, start to finish (S§5.8 "Per-listing scheduling", S§2 invariants 3, 4, 10).
// No model anywhere; the network is reached only through the injected fetcher.
//
// Order, and why:
// 1. Claim (one IMMEDIATE transaction): the listing must exist, be tracked by an active watch (else
//    its next_check_at is cleared) and be due; its next_check_at moves CLAIM_LEASE_MS ahead, so
//    another sweep does not read it meanwhile and a check that dies leaves it due again.
// 2. Resume: an observation newer than listing_check.last_read_at was written by a check that died
//    before its evaluation finished (a read's time is always strictly after last_read_at, see
//    step 4, so "newer" holds even when the clock stepped back). It is evaluated now (events are keyed by observation, so the
//    part that had run records nothing twice), then listing_check is brought up to it.
// 3. Read through the ladder under a per-check deadline, the job's signal and a request budget,
//    with the user's market (no market: the check does not run, S§2.3).
// 4a. A read: transaction A writes the observation (append-only, one row per read), the listing
//    (last_seen_at, errors reset, fields adopted only while unknown) and the store's health; then
//    every watch is evaluated (evaluate.ts, one transaction per watch); then transaction C writes
//    listing_check (last_read_at, errors cleared, next_check_at). listing_check is written last
//    on purpose: until C commits, last_read_at < the observation's time marks it unevaluated (step
//    2), and the failed-read marker the evaluation needs (last_error, last_read_at: the state before
//    this read) is still there.
// 4b. A failed read (S§2.10): no observation, nothing a user sees as a price changes, no alert is
//    evaluated. listing.consecutive_errors + 1, listing_check error columns, store health, the
//    re-discovery queue, and one structured log record with the reason, detail, fetch outcome and
//    candidates.
// 4c. A read refused before it reached the store (the host is closed: host_limit; the budget) is
//    not a failure of the listing: only next_check_at moves, to when the host opens.
// 4d. Aborted: nothing is written and the listing is left due as it was.

import { buildObservationRecord } from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import type { Fetcher, FetcherResult } from '@agentic-dasher/fetch';
import { ABORT_CODE, bindReaderGet, createRequestBudget } from '@agentic-dasher/fetch';
import { ListingCurrency, type ReadFailureCause, type StorePlatform } from '@agentic-dasher/shared';
import {
  type EndpointReader,
  type ListingReadResult,
  type Market,
  magentoReader,
  type ReaderContext,
  type ReadRequest,
  readListing,
  shopifyReader,
  wooReader,
} from '@agentic-dasher/sources';
import { and, eq, sql } from 'drizzle-orm';
import {
  directPlatformEvidence,
  fingerprintPlatformEvidence,
  marketPrefixOf,
} from '../directory/storefront.ts';
import { evaluateObservation, type WatchEvaluation } from './evaluate.ts';
import { CODE_ONLY_VERSIONS, recordReadIdentity, type VerdictVersions } from './identity.ts';
import { errorSummary, type SweepLogger, stderrLogger } from './log.ts';
import {
  CHECK_DEADLINE_MS,
  CHECK_REQUEST_BUDGET,
  CLAIM_LEASE_MS,
  checkInterval,
  DEFERRED_RETRY_MS,
  errorBackoff,
  failureCause,
  iso,
  REDISCOVERY_AFTER_ERRORS,
  REDISCOVERY_ERROR_SPAN_MS,
  REDISCOVERY_MIN_GAP_MS,
} from './policy.ts';
import {
  activeTrackingWatchIds,
  type CheckRow,
  checkOf,
  immediate,
  type ListingRow,
  latestObservation,
  listingById,
  type StoreRow,
  storeById,
  watchById,
} from './rows.ts';

/** `readListing` of packages/sources, injectable so tests can script reads. */
export type ReadListingFn = (
  request: ReadRequest,
  endpointReaders: readonly EndpointReader[],
  context: ReaderContext,
) => Promise<ListingReadResult>;

export interface SweepDeps {
  readonly db: Database;
  /** The composed fetcher (packages/fetch createFetcher): the only way to the network. */
  readonly fetcher: Fetcher;
  /** Epoch milliseconds. */
  readonly now?: () => number;
  /** The user's market (the settings service backs it); null while none is set. */
  readonly market: () => Market | null;
  /** The check interval setting in ms (S§5.8: default 30 min, floor 5 min); null for the default. */
  readonly checkIntervalMs?: () => number | null;
  readonly readListing?: ReadListingFn;
  /** The endpoint readers of the ladder; default the platform readers (Shopify, Woo, Magento). */
  readonly endpointReaders?: readonly EndpointReader[];
  readonly logger?: SweepLogger;
  /** The versions a cached verdict must match (S§5.4); default: code verdicts only. */
  readonly verdictVersions?: () => VerdictVersions;
  readonly checkDeadlineMs?: number;
  readonly checkRequestBudget?: number;
  /** For tests and diagnostics: called after an observation's transaction commits. */
  readonly hooks?: { readonly afterObservationWritten?: (observationId: number) => void };
}

export type CheckOutcome =
  | {
      readonly kind: 'read';
      readonly observationId: number;
      readonly evaluations: readonly WatchEvaluation[];
      readonly nextCheckAt: string;
    }
  | {
      readonly kind: 'failed';
      readonly cause: ReadFailureCause;
      /** The ladder's reason, `reader_error` (the reader threw) or `not_a_record`. */
      readonly reason: string;
      readonly nextCheckAt: string;
      /** Watches whose lookup was queued again for re-discovery. */
      readonly rediscoveryQueued: readonly number[];
    }
  | {
      readonly kind: 'deferred';
      readonly reason: 'host_closed' | 'budget';
      readonly nextCheckAt: string;
    }
  | { readonly kind: 'aborted' }
  | {
      readonly kind: 'skipped';
      readonly why: 'missing' | 'not_tracked' | 'not_due' | 'in_flight' | 'no_market';
    };

export interface CheckResult {
  readonly listingId: number;
  readonly outcome: CheckOutcome;
  /** Evaluations of an observation a previous check wrote and did not finish evaluating. */
  readonly resumed: readonly WatchEvaluation[];
}

export interface CheckOptions {
  readonly signal?: AbortSignal;
  /** Check even when not due (a refresh, the first check after a lookup). */
  readonly force?: boolean;
}

const inFlight = new WeakMap<Database, Set<number>>();

const PLATFORM_READERS_BY_NAME: readonly (readonly [EndpointReader, StorePlatform])[] = [
  [shopifyReader, 'shopify'],
  [wooReader, 'woo'],
  [magentoReader, 'magento'],
];

/** The platform readers, each noting its platform when it reads (store.platform is learnt so). */
function platformReaders(note: (platform: StorePlatform) => void): EndpointReader[] {
  return PLATFORM_READERS_BY_NAME.map(([reader, platform]) => ({
    method: reader.method,
    applies: (request) => reader.applies(request),
    read: async (request, context) => {
      const outcome = await reader.read(request, context);
      if (outcome.kind === 'read') note(platform);
      return outcome;
    },
  }));
}

/** Checks one listing (see the header). Never throws for a store's failure; a database error throws. */
export async function checkListing(
  deps: SweepDeps,
  listingId: number,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const { db } = deps;
  const busy = inFlight.get(db) ?? new Set<number>();
  inFlight.set(db, busy);
  if (busy.has(listingId))
    return { listingId, outcome: { kind: 'skipped', why: 'in_flight' }, resumed: [] };
  busy.add(listingId);
  try {
    return await runCheck(deps, listingId, options);
  } finally {
    busy.delete(listingId);
  }
}

interface Claimed {
  readonly listing: ListingRow;
  readonly store: StoreRow;
  readonly check: CheckRow;
  /** next_check_at before the claim, restored when the check is aborted. */
  readonly previousNext: string | null;
  readonly lease: string;
}

async function runCheck(
  deps: SweepDeps,
  listingId: number,
  options: CheckOptions,
): Promise<CheckResult> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.logger ?? stderrLogger;
  const skipped = (why: Extract<CheckOutcome, { kind: 'skipped' }>['why']): CheckResult => ({
    listingId,
    outcome: { kind: 'skipped', why },
    resumed: [],
  });

  const market = deps.market();
  if (market === null) return skipped('no_market');

  const claim = immediate(db, (): Claimed | Extract<CheckOutcome, { kind: 'skipped' }>['why'] => {
    const nowIso = iso(now());
    const listing = listingById(db, listingId);
    if (listing === undefined) return 'missing';
    const store = storeById(db, listing.storeId);
    if (store === undefined) return 'missing';
    const lc = schema.listingCheck;
    let check = checkOf(db, listingId);
    if (activeTrackingWatchIds(db, listingId).length === 0) {
      if (check !== undefined && check.nextCheckAt !== null) {
        db.orm.update(lc).set({ nextCheckAt: null }).where(eq(lc.listingId, listingId)).run();
      }
      return 'not_tracked';
    }
    if (check === undefined) {
      check = {
        listingId,
        nextCheckAt: nowIso,
        lastReadAt: null,
        firstErrorAt: null,
        lastError: null,
      };
      db.orm.insert(lc).values(check).run();
    }
    if (!options.force && (check.nextCheckAt === null || check.nextCheckAt > nowIso)) {
      return 'not_due';
    }
    const lease = iso(now() + CLAIM_LEASE_MS);
    db.orm.update(lc).set({ nextCheckAt: lease }).where(eq(lc.listingId, listingId)).run();
    return { listing, store, check, previousNext: check.nextCheckAt, lease };
  });
  if (typeof claim === 'string') return skipped(claim);

  const ctx = {
    db,
    now,
    market,
    versions: deps.verdictVersions?.() ?? CODE_ONLY_VERSIONS,
    log,
  };

  // 2. Resume an observation whose evaluation did not finish.
  let check = claim.check;
  let resumed: WatchEvaluation[] = [];
  const pending = latestObservation(db, listingId);
  if (
    pending !== undefined &&
    (check.lastReadAt === null || pending.observedAt > check.lastReadAt)
  ) {
    resumed = evaluateObservation(ctx, {
      listingId,
      observationId: pending.id,
      failedBeforeAt: check.lastError !== null ? check.lastReadAt : null,
    });
    check = immediate(db, () => {
      const lc = schema.listingCheck;
      const patch = { lastReadAt: pending.observedAt, firstErrorAt: null, lastError: null };
      db.orm.update(lc).set(patch).where(eq(lc.listingId, listingId)).run();
      return { ...check, ...patch };
    });
    log({
      level: 'warn',
      event: 'resumed_evaluation',
      at: iso(now()),
      listingId,
      observationId: pending.id,
      watches: resumed.length,
    });
  }

  // 3. The read.
  const signal = options.signal ?? new AbortController().signal;
  const interval = checkInterval(deps.checkIntervalMs?.());
  let closedUntil: number | null = null;
  let retryUntil: number | null = null;
  let learnt: StorePlatform | null = null;
  const bound = bindReaderGet(deps.fetcher, {
    pageKind: 'product',
    deadline: now() + (deps.checkDeadlineMs ?? CHECK_DEADLINE_MS),
    signal,
    budget: createRequestBudget(deps.checkRequestBudget ?? CHECK_REQUEST_BUDGET),
  });
  // Treat a price as directory evidence only when its rung read from the listing's storefront.
  const directResponses = new Map<'api' | 'http', string | null>();
  const context: ReaderContext = {
    get: async (request) => {
      const result: FetcherResult = await bound(request);
      if (result.outcome.kind === 'ok' && result.response !== null) {
        const received = URL.parse(result.response.finalUrl);
        const origin =
          received?.hostname === claim.store.host &&
          marketPrefixOf(received.pathname) === claim.store.marketPrefix
            ? received.origin
            : null;
        const previous = directResponses.get(request.rung);
        directResponses.set(
          request.rung,
          previous === undefined || previous === origin ? origin : null,
        );
      }
      if (result.closedUntil !== null) closedUntil = Math.max(closedUntil ?? 0, result.closedUntil);
      if (result.outcome.kind === 'rate_limited' && result.outcome.retryAfterMs !== null) {
        retryUntil = Math.max(retryUntil ?? 0, now() + result.outcome.retryAfterMs);
      }
      return result;
    },
    now,
  };
  const { listing, store } = claim;
  const baseCurrency = ListingCurrency.safeParse(store.baseCurrency);
  const request: ReadRequest = {
    url: listing.urlCanonical,
    market,
    store: {
      platform: store.platform,
      marketPrefix: store.marketPrefix,
      country: store.country,
      baseCurrency: baseCurrency.success ? baseCurrency.data : 'unknown',
      locale: null,
    },
    variant: Object.keys(listing.variant).length > 0 ? { options: listing.variant } : null,
  };
  const readers =
    deps.endpointReaders ??
    platformReaders((p) => {
      learnt = p;
    });

  let result: ListingReadResult | { readonly kind: 'error'; readonly error: unknown };
  try {
    result = await (deps.readListing ?? readListing)(request, readers, context);
  } catch (error) {
    result = { kind: 'error', error };
  }

  const aborted =
    signal.aborted ||
    (result.kind === 'failed' &&
      result.fetch?.kind === 'network_error' &&
      result.fetch.code === ABORT_CODE);
  if (aborted) {
    immediate(db, () => {
      const lc = schema.listingCheck;
      db.orm
        .update(lc)
        .set({ nextCheckAt: claim.previousNext ?? iso(now()) })
        .where(and(eq(lc.listingId, listingId), eq(lc.nextCheckAt, claim.lease)))
        .run();
    });
    return { listingId, outcome: { kind: 'aborted' }, resumed };
  }

  // The read time is strictly after the last one (a millisecond after it when the clock is behind),
  // never equal: the resume test of step 2 is "newer than last_read_at", so an observation carrying
  // exactly last_read_at (a clock stepped back, then a crash before its evaluation) would never be
  // evaluated (finding 8 of the review of 2026-11-25). Strictly increasing read times keep that
  // test exact without a schema change: an observation is unevaluated if and only if it is newer
  // than last_read_at. It also keeps a listing's observations, failed reads and alerts in one order.
  const atMs = Math.max(now(), check.lastReadAt === null ? 0 : Date.parse(check.lastReadAt) + 1);
  const at = iso(atMs);
  const later = (base: number) => iso(Math.max(base, closedUntil ?? 0, retryUntil ?? 0));

  if (result.kind === 'failed' && result.reason === 'fetch_failed') {
    const f = result.fetch;
    if (f?.kind === 'refused_by_policy' && (f.reason === 'host_limit' || f.reason === 'budget')) {
      const nextCheckAt = later(atMs + (closedUntil === null ? DEFERRED_RETRY_MS : 0));
      immediate(db, () => {
        const lc = schema.listingCheck;
        db.orm.update(lc).set({ nextCheckAt }).where(eq(lc.listingId, listingId)).run();
      });
      log({
        level: 'info',
        event: 'deferred_read',
        at,
        listingId,
        host: store.host,
        reason: f.reason,
        nextCheckAt,
      });
      return {
        listingId,
        outcome: {
          kind: 'deferred',
          reason: f.reason === 'budget' ? 'budget' : 'host_closed',
          nextCheckAt,
        },
        resumed,
      };
    }
  }

  // 4a. A read.
  if (result.kind === 'read') {
    const read = result.read;
    const record = buildObservationRecord({ ...read, observedAt: at });
    if (record.ok) {
      const r = record.value;
      const observationId = immediate(db, () => {
        const id = db.orm
          .insert(schema.priceObservation)
          .values({
            listingId,
            observedAt: r.observedAt,
            currency: r.currency,
            sticker: r.sticker,
            referenceClaimed: r.referenceClaimed,
            coupon: r.coupon,
            memberPrice: r.memberPrice,
            shipping: r.shipping,
            shippingStatus: r.shippingStatus,
            tax: r.tax,
            taxIncluded: r.taxIncluded,
            dutyEstimate: r.dutyEstimate,
            unitPrice: r.unitPrice,
            unit: r.unit,
            effective: r.effective,
            landed: r.landed,
            missingComponents: r.missingComponents,
            availability: r.availability,
            readPath: r.readPath,
            rung: r.rung,
            rawCandidates: r.rawCandidates,
          })
          .returning({ id: schema.priceObservation.id })
          .get().id;
        const fresh = listingById(db, listingId) as ListingRow;
        const adopt: Partial<ListingRow> = {};
        if (fresh.currency === 'unknown' && r.currency !== 'unknown') adopt.currency = r.currency;
        // A pasted link is saved with its URL as a placeholder title (the lookup contacts no
        // retailer); the first read that states a title replaces it. A title a read gave stays.
        const placeholder = fresh.title.trim() === '' || fresh.title === fresh.urlCanonical;
        if (placeholder && read.title !== null && read.title.trim() !== '') {
          adopt.title = read.title.trim().slice(0, 500);
        }
        if (fresh.condition === 'unknown' && read.condition !== 'unknown') {
          adopt.condition = read.condition;
        }
        if ((fresh.sku ?? '') === '' && read.identifiers.sku !== null)
          adopt.sku = read.identifiers.sku;
        if ((fresh.externalId ?? '') === '' && read.identifiers.externalId !== null) {
          adopt.externalId = read.identifiers.externalId;
        }
        const l = schema.listing;
        db.orm
          .update(l)
          .set({ lastSeenAt: at, consecutiveErrors: 0, ...adopt })
          .where(eq(l.id, listingId))
          .run();
        recordReadIdentity(db, { ...fresh, ...adopt }, store, read, at);
        const s = schema.store;
        const storePatch: Partial<StoreRow> = { consecutiveErrors: 0, lastOkAt: at };
        // The listing already owns the unique host + market-prefix row created at intake.
        // Keep its origin and trust; a stock-only observation does not establish a priced shop.
        const directOrigin = directResponses.get(read.rung);
        const directPrice = r.sticker !== null && !!directOrigin;
        if (directPrice) storePatch.isShop = 'yes';
        if (store.readRoute !== read.method) storePatch.readRoute = read.method;
        if (learnt !== null && directOrigin && read.method === 'platform_json') {
          const current = storeById(db, store.id);
          if (
            current &&
            (current.platform === 'unknown' ||
              fingerprintPlatformEvidence(current.platformEvidence) ||
              (current.platform === learnt && current.platformEvidence === null))
          ) {
            storePatch.platform = learnt;
            storePatch.platformEvidence = directPlatformEvidence(directOrigin);
          }
        }
        db.orm
          .update(s)
          .set({
            ...storePatch,
            // Merge with the latest per-market cache in the observation transaction.
            ...(directPrice
              ? {
                  fingerprint: sql`json_set(coalesce(${s.fingerprint}, '{}'), '$.confirmedShop', json('true'))`,
                }
              : {}),
          })
          .where(eq(s.id, store.id))
          .run();
        if (fresh.currency !== 'unknown' && r.currency !== fresh.currency) {
          log({
            level: 'warn',
            event: 'currency_differs',
            at,
            listingId,
            observationId: id,
            listingCurrency: fresh.currency,
            readCurrency: r.currency,
          });
        }
        return id;
      });
      deps.hooks?.afterObservationWritten?.(observationId);

      const evaluations = evaluateObservation(ctx, {
        listingId,
        observationId,
        failedBeforeAt: check.lastError !== null ? check.lastReadAt : null,
      });

      const nextCheckAt = later(atMs + interval);
      immediate(db, () => {
        const lc = schema.listingCheck;
        db.orm
          .update(lc)
          .set({ lastReadAt: at, firstErrorAt: null, lastError: null, nextCheckAt })
          .where(eq(lc.listingId, listingId))
          .run();
      });
      return {
        listingId,
        outcome: { kind: 'read', observationId, evaluations, nextCheckAt },
        resumed,
      };
    }
    result = {
      kind: 'failed',
      reason: 'no_price',
      detail: `the read makes no observation record: ${record.refusal.code}: ${record.refusal.detail}`,
      fetch: null,
      methods: result.methods,
      candidates: result.candidates,
    };
    return failed(deps, claim, check, result, 'not_a_record', at, atMs, interval, later, resumed);
  }

  if (result.kind === 'error') {
    log({
      level: 'error',
      event: 'reader_error',
      at,
      listingId,
      url: listing.urlCanonical,
      error: errorSummary(result.error),
    });
    return failed(
      deps,
      claim,
      check,
      {
        kind: 'failed',
        reason: 'no_price',
        detail: `the reader threw: ${errorSummary(result.error)}`,
        fetch: null,
        methods: [],
        candidates: [],
      },
      'reader_error',
      at,
      atMs,
      interval,
      later,
      resumed,
    );
  }
  return failed(deps, claim, check, result, result.reason, at, atMs, interval, later, resumed);
}

/** 4b: a failed read (see the header). */
function failed(
  deps: SweepDeps,
  claim: Claimed,
  check: CheckRow,
  result: Extract<ListingReadResult, { kind: 'failed' }>,
  reason: string,
  at: string,
  atMs: number,
  interval: number,
  later: (base: number) => string,
  resumed: WatchEvaluation[],
): CheckResult {
  const { db } = deps;
  const log = deps.logger ?? stderrLogger;
  const listingId = claim.listing.id;
  const cause = failureCause(result);
  const outcome = immediate(db, () => {
    const fresh = listingById(db, listingId) as ListingRow;
    const errors = fresh.consecutiveErrors + 1;
    const firstErrorAt = check.firstErrorAt ?? at;
    const nextCheckAt = later(atMs + errorBackoff(errors, interval));
    const l = schema.listing;
    db.orm.update(l).set({ consecutiveErrors: errors }).where(eq(l.id, listingId)).run();
    const lc = schema.listingCheck;
    db.orm
      .update(lc)
      .set({ lastReadAt: at, firstErrorAt, lastError: cause, nextCheckAt })
      .where(eq(lc.listingId, listingId))
      .run();
    const s = schema.store;
    const store = storeById(db, claim.store.id) as StoreRow;
    db.orm
      .update(s)
      .set({
        consecutiveErrors: (store.consecutiveErrors ?? 0) + 1,
        lastErrorAt: at,
        lastError: cause,
      })
      .where(eq(s.id, store.id))
      .run();

    // "After 3+ consecutive errors over a day, re-discovery is queued (at most daily)" (S§5.8).
    const queued: number[] = [];
    if (
      errors >= REDISCOVERY_AFTER_ERRORS &&
      Date.parse(firstErrorAt) <= atMs - REDISCOVERY_ERROR_SPAN_MS
    ) {
      const w = schema.watch;
      for (const watchId of activeTrackingWatchIds(db, listingId)) {
        const watch = watchById(db, watchId);
        if (watch === undefined || watch.lookupState === 'queued') continue;
        if (
          watch.lookupQueuedAt !== null &&
          Date.parse(watch.lookupQueuedAt) > atMs - REDISCOVERY_MIN_GAP_MS
        ) {
          continue;
        }
        db.orm
          .update(w)
          .set({
            lookupState: 'queued',
            lookupQueuedAt: at,
            lookupDueAt: at,
            lookupAttempts: 0,
            lookupError: null,
          })
          .where(eq(w.id, watchId))
          .run();
        queued.push(watchId);
      }
    }
    return { nextCheckAt, queued };
  });

  log({
    level: 'warn',
    event: 'failed_read',
    at,
    listingId,
    storeId: claim.store.id,
    host: claim.store.host,
    url: claim.listing.urlCanonical,
    cause,
    reason,
    detail: result.detail,
    fetch: result.fetch,
    candidates: result.candidates,
    methods: result.methods.map((m) => ({
      method: m.method,
      rung: m.rung,
      outcome: m.outcome.kind,
      ...(m.outcome.kind === 'no_read'
        ? { reason: m.outcome.reason, fetch: m.outcome.fetch?.kind ?? null }
        : {}),
    })),
    nextCheckAt: outcome.nextCheckAt,
    rediscoveryQueued: outcome.queued,
  });
  return {
    listingId,
    outcome: {
      kind: 'failed',
      cause,
      reason,
      nextCheckAt: outcome.nextCheckAt,
      rediscoveryQueued: outcome.queued,
    },
    resumed,
  };
}
