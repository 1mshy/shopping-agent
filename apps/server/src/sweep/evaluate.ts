// Alert evaluation after a read (S§5.8 "Alert rules", "Evaluation is serialised"; S§2 invariants
// 1, 2, 10, 11). For one observation of one listing: every active watch that tracks the listing is
// evaluated in its own BEGIN IMMEDIATE transaction (never interleaved with another evaluation of the
// same watch: SQLite's write lock across processes, a synchronous body within this one). In it the
// watch adopts its currency, its reference is recomputed and stored, and the price and restock
// rules decide; a decision that fires is recorded through the outbox's recordEventInTransaction
// under alertEventKey (kind, watch, observation): re-evaluating the same observation finds the
// event already there and adds nothing. Delivery and the cooldown are the outbox's: nothing is
// stamped on the watch (S§2.11); the last accepted alert is read back from the deliveries.
//
// Row-to-input mapping (where this unit can go wrong):
//
// chooseReferencePrice (packages/core/src/alerts/reference-price.ts)
//   watch.productId          WATCH_PRODUCT, a stand-in: the watch has no product column, so "the
//                            watch's product" is "a listing whose identity is confirmed for this
//                            watch" (identity.ts); such a listing gets productId WATCH_PRODUCT,
//                            any other null.
//   watch.marketCurrency     the user's market currency (the market accessor).
//   watch.currency           watch.currency (null until adopted).
//   watch.reference          watch.reference_price + reference_kind, in watch.currency.
//   watch.userConfirmedPrice watch.reference_price when reference_kind = 'user_confirmed' (the user's
//                            price is stored as the reference, so it wins until the user changes it).
//   listing.channel, sellerKind, condition   listing.channel, seller_kind, condition.
//   listing.relation         `exact` when confirmed, else the effective verdict's relation or unknown.
//   listing.identityVerified confirmed, and the store is not `blocked`.
//   listing.latest           the listing's RECENT price: the median (half up) of the effective prices
//                            of its in-stock observations in its own currency over
//                            HISTORY_WINDOW_MS, leaving out its two newest (the read being judged and
//                            its confirmation; with one or two reads in all, the oldest stands),
//                            carried on its latest priced observation (id, time, availability). With
//                            no in-stock read in the window: null. Never observed: a failed marker
//                            when its last attempt failed, else null. Why not the bare latest price:
//                            a watch on one listing would then have a reference equal to the price
//                            just read and the drop rule could never fire; the owner's ruling says
//                            "the median of recent observations, recomputed as reads arrive".
//   → set: watch.reference_price/kind (and watch.currency when it had none). none: a held
//     median_verified reference is cleared. keep: nothing.
//   Currency: when the reference sets none, the first real read (a price in a known currency) of a
//   confirmed listing adopts watch.currency (S§5.8 Intake), so a target can be compared.
//
// evaluatePriceAlert (price-rules.ts), for the listing just read, when it is confirmed and its store
// is not blocked:
//   now                      the clock (never before the evaluated observation).
//   watch.currency           watch.currency after adoption.
//   watch.referencePrice     the reference just stored, in watch.currency.
//   watch.targetPrice        rules_json.targetPrice (policy.ts readWatchRules).
//   watch.dropBasisPoints    rules_json.dropBasisPoints, or dropPct × 100, default 500 (5%).
//   watch.cooldownSeconds    watch.cooldown_s.
//   reads                    the listing's observations over HISTORY_WINDOW_MS (at most
//                            HISTORY_MAX_READS), oldest first, ending at the evaluated one:
//                            observationId = id, price = effective, sticker when it differs,
//                            actionCouponOff = coupon, availability, readPath = read_path, rung.
//                            Plus one failed read right before the evaluated observation when the
//                            attempt before this read failed: listing_check.last_error was set, at
//                            listing_check.last_read_at, in the state before this read was applied
//                            (check.ts writes listing_check only after evaluation, so the marker is
//                            still there when a crashed evaluation is resumed).
//   lastAcceptedPriceAlert   notify `lastAcceptedAlert(kind price_drop)`: price and acceptedAt.
//   Then: the outlier rule (assessOutlier over the confirmed listings of the same currency and
//   condition, their latest priced observations, market = the user's country): an outlier needs the
//   read before it to be an observation that confirmOutlierRead confirms (within 1%, same path and
//   rung). And an alert already on its way holds a repeat: while the watch's newest price event is
//   awaiting delivery, a new one is recorded only for a price below it.
//
// evaluateRestock (restock.ts), when watch.restock_enabled_at is set:
//   watch.currency, targetPrice   as above; restockRuleOnSince = watch.restock_enabled_at;
//   lastAcceptedRestockAt    notify `lastAcceptedAlert(kind restock)`.acceptedAt.
//   listings                 the confirmed listings of unblocked stores, each with its observations
//                            over the window, oldest first, and a failed read at its end when its
//                            last attempt failed (for the listing just read: before the evaluated
//                            observation, as above). The event names the listing and observation the
//                            decision names.
import {
  type AlertListingRead,
  type AlertObservedRead,
  assessOutlier,
  type ConfirmingRead,
  chooseReferencePrice,
  confirmOutlierRead,
  type ExactListingPrice,
  evaluatePriceAlert,
  evaluateRestock,
  priceMedian,
  type ReferenceLatestRead,
  type ReferenceListing,
  type RestockListing,
} from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import {
  type MinorUnitCurrency,
  MinorUnitCurrency as MinorUnitCurrencySchema,
  type Money,
} from '@agentic-dasher/shared';
import type { Market } from '@agentic-dasher/sources';
import { eq } from 'drizzle-orm';
import {
  alertEventKey,
  deliveryStatus,
  gatingDeliveries,
  lastAcceptedAlert,
  recordEventInTransaction,
} from '../notify/index.ts';
import { identityOf, type ListingIdentityVerdict, type VerdictVersions } from './identity.ts';
import type { SweepLogger } from './log.ts';
import { HISTORY_MAX_READS, HISTORY_WINDOW_MS, iso, readWatchRules } from './policy.ts';
import {
  activeTrackingWatchIds,
  historyOf,
  immediate,
  latestEventOf,
  latestPricedIn,
  type Member,
  type ObservationRow,
  observationById,
  trackedMembers,
  type WatchRow,
  watchById,
} from './rows.ts';

/** The stand-in product id of "the watch's product" (see the mapping above). */
const WATCH_PRODUCT = 1;

export interface EvaluationContext {
  readonly db: Database;
  readonly now: () => number;
  /** The user's market when the read was made. */
  readonly market: Market;
  readonly versions: VerdictVersions;
  readonly log: SweepLogger;
}

export interface ObservationToEvaluate {
  readonly listingId: number;
  readonly observationId: number;
  /**
   * listing_check.last_read_at when the attempt before this read failed (listing_check.last_error
   * set before the read was applied); null otherwise.
   */
  readonly failedBeforeAt: string | null;
}

/** Why a rule recorded no event, beyond the pure functions' own silences. */
export type HeldReason =
  | 'unconfirmed_listing'
  | 'store_blocked'
  | 'outlier_unconfirmed'
  | 'outlier_not_judged'
  | 'awaiting_delivery'
  | 'undelivered_recently';

export interface RuleResult {
  /** An event stands for this decision: recorded now, or found under its key. */
  readonly fired: boolean;
  /** The pure function's silence, or why the sweep held a decision that fired. */
  readonly silence: string | null;
  /** The event recorded or found under the key; null when nothing fired. */
  readonly eventId: number | null;
  /** False when the event already existed (the same observation evaluated again). */
  readonly created: boolean;
}

export interface WatchEvaluation {
  readonly watchId: number;
  /** The watch stopped being active between the read and its evaluation. */
  readonly skipped: boolean;
  readonly reference: 'set' | 'keep' | 'none' | 'cleared';
  readonly price: RuleResult | null;
  readonly restock: RuleResult | null;
  /** `condition_unknown`, `currency_differs`, `unconfirmed`, `marked_wrong`. */
  readonly flags: readonly string[];
}

/**
 * Evaluates one observation for every active watch that tracks its listing, one transaction per
 * watch. Safe to call again for the same observation: an event is recorded once per key.
 */
export function evaluateObservation(
  ctx: EvaluationContext,
  target: ObservationToEvaluate,
): WatchEvaluation[] {
  const results: WatchEvaluation[] = [];
  for (const watchId of activeTrackingWatchIds(ctx.db, target.listingId)) {
    results.push(immediate(ctx.db, () => evaluateWatch(ctx, watchId, target)));
  }
  return results;
}

const isMinorUnit = (c: string): c is MinorUnitCurrency =>
  MinorUnitCurrencySchema.safeParse(c).success;

interface Judged extends Member {
  readonly identity: ListingIdentityVerdict;
  readonly blocked: boolean;
  /** May alert: confirmed and not at a blocked store. */
  readonly mayAlert: boolean;
}

function evaluateWatch(
  ctx: EvaluationContext,
  watchId: number,
  target: ObservationToEvaluate,
): WatchEvaluation {
  const { db } = ctx;
  const watch0 = watchById(db, watchId);
  const evaluated = observationById(db, target.observationId);
  if (
    watch0 === undefined ||
    watch0.archivedAt !== null ||
    watch0.pausedAt !== null ||
    evaluated === undefined
  ) {
    return { watchId, skipped: true, reference: 'keep', price: null, restock: null, flags: [] };
  }
  const nowMs = Math.max(ctx.now(), Date.parse(evaluated.observedAt));
  const nowIso = iso(nowMs);
  const sinceIso = iso(nowMs - HISTORY_WINDOW_MS);

  const members: Judged[] = trackedMembers(db, watchId).map((m) => {
    const identity = identityOf(db, {
      watch: watch0,
      link: m.link,
      listing: m.listing,
      store: m.store,
      versions: ctx.versions,
    });
    const blocked = m.store.trustTier === 'blocked';
    return { ...m, identity, blocked, mayAlert: identity.confirmed && !blocked };
  });
  const self = members.find((m) => m.listing.id === target.listingId);
  if (self === undefined) {
    return { watchId, skipped: true, reference: 'keep', price: null, restock: null, flags: [] };
  }

  const flags: string[] = [];
  if (self.listing.condition === 'unknown') flags.push('condition_unknown');
  if (evaluated.currency !== self.listing.currency) flags.push('currency_differs');
  if (!self.identity.confirmed) flags.push('unconfirmed');
  if (self.identity.markedWrong) flags.push('marked_wrong');

  // 1. Currency and reference.
  const { watch, reference } = recomputeReference(ctx, watch0, members, evaluated, self, sinceIso);

  // 2. The price rules, for the listing just read.
  const rules = readWatchRules(watch.rules);
  const price = evaluatePrice(
    ctx,
    watch,
    rules,
    members,
    self,
    evaluated,
    target,
    nowIso,
    sinceIso,
  );

  // 3. The restock rule, over the watch's listings.
  const restock =
    watch.restockEnabledAt === null
      ? null
      : evaluateRestockRule(
          ctx,
          watch,
          rules.targetPrice,
          members,
          evaluated,
          target,
          nowIso,
          sinceIso,
        );

  return { watchId, skipped: false, reference, price, restock, flags };
}

function recomputeReference(
  ctx: EvaluationContext,
  watch0: WatchRow,
  members: readonly Judged[],
  evaluated: ObservationRow,
  self: Judged,
  sinceIso: string,
): { watch: WatchRow; reference: WatchEvaluation['reference'] } {
  const { db } = ctx;
  const currency = watch0.currency;
  const held =
    watch0.referencePrice !== null && watch0.referenceKind !== null && currency !== null
      ? { price: { amountMinor: watch0.referencePrice, currency }, kind: watch0.referenceKind }
      : null;
  const userConfirmedPrice = held !== null && held.kind === 'user_confirmed' ? held.price : null;
  const listings: ReferenceListing[] = members.map((m) => ({
    listingId: m.listing.id,
    productId: m.identity.confirmed ? WATCH_PRODUCT : null,
    channel: m.listing.channel,
    sellerKind: m.listing.sellerKind,
    condition: m.listing.condition,
    relation: m.identity.relation,
    identityVerified: m.mayAlert,
    latest: recentPrice(db, m, sinceIso),
  }));
  const decision = chooseReferencePrice({
    watch: {
      productId: WATCH_PRODUCT,
      marketCurrency: ctx.market.currency,
      currency,
      reference: held,
      userConfirmedPrice,
    },
    listings,
  });

  const w = schema.watch;
  let next: WatchRow = watch0;
  let outcome: WatchEvaluation['reference'] = decision.action;
  if (decision.action === 'set') {
    const patch = {
      currency: decision.currency,
      referencePrice: decision.price.amountMinor,
      referenceKind: decision.kind,
    };
    db.orm.update(w).set(patch).where(eq(w.id, watch0.id)).run();
    next = { ...next, ...patch };
  } else if (decision.action === 'none' && held !== null && held.kind === 'median_verified') {
    db.orm
      .update(w)
      .set({ referencePrice: null, referenceKind: null })
      .where(eq(w.id, watch0.id))
      .run();
    next = { ...next, referencePrice: null, referenceKind: null };
    outcome = 'cleared';
  }
  // The first real read of a confirmed listing adopts the currency even when no reference can be
  // set (an unknown condition keeps a listing out of the reference, not out of the target rule).
  if (
    next.currency === null &&
    self.mayAlert &&
    evaluated.effective !== null &&
    isMinorUnit(evaluated.currency)
  ) {
    db.orm.update(w).set({ currency: evaluated.currency }).where(eq(w.id, watch0.id)).run();
    next = { ...next, currency: evaluated.currency };
  }
  return { watch: next, reference: outcome };
}

/** How many of a listing's newest comparable reads stay out of its recent price: the judged read and its confirmation. */
const REFERENCE_EXCLUDES_NEWEST = 2;

/** The listing's recent price for the reference (see the mapping in the header). */
function recentPrice(db: Database, m: Member, sinceIso: string): ReferenceLatestRead | null {
  const currency = m.listing.currency;
  const latest = currency === 'unknown' ? undefined : latestPricedIn(db, m.listing.id, currency);
  if (latest === undefined) {
    // Never priced in its currency: a failed read only when it was never observed at all.
    const any = historyOf(db, m.listing.id, { sinceIso: '0000', upTo: null, limit: 1 });
    if (any.length > 0) {
      const o = any[0] as ObservationRow;
      return {
        kind: 'observation',
        observationId: o.id,
        observedAt: o.observedAt,
        currency: o.currency,
        price: o.effective,
        availability: o.availability,
      };
    }
    const check = m.check;
    return check?.lastError != null && check.lastReadAt !== null
      ? { kind: 'failed', at: check.lastReadAt }
      : null;
  }
  // Only what the alert rule itself would compare (S§5.8): in stock, priced above zero, in the
  // listing's currency. An out-of-stock page often carries a placeholder or list price.
  const window = historyOf(db, m.listing.id, {
    sinceIso,
    upTo: null,
    limit: HISTORY_MAX_READS,
  }).filter(
    (o) =>
      o.currency === currency && o.effective !== null && o.effective > 0 && o.availability === 'in',
  );
  // Never in stock in the window: nothing of this listing can stand as a baseline yet.
  if (window.length === 0) return null;
  // The two newest reads are left out: a read being judged and the read that confirms it must not
  // be part of their own baseline, or a new watch could never alert and the reference would
  // follow every drop down before it is confirmed. With one or two reads in all, the oldest
  // stands (the first read is the baseline, S§5.8 Intake).
  const before = window.slice(0, -REFERENCE_EXCLUDES_NEWEST);
  const basis = before.length > 0 ? before : window.slice(0, 1);
  const prices = basis.map((o) => o.effective as number);
  return {
    kind: 'observation',
    observationId: latest.id,
    observedAt: latest.observedAt,
    currency: latest.currency,
    price: priceMedian(prices),
    availability: latest.availability,
  };
}

function observedRead(o: ObservationRow): AlertObservedRead {
  return {
    kind: 'observation',
    observationId: o.id,
    observedAt: o.observedAt,
    currency: o.currency,
    price: o.effective,
    ...(o.sticker !== null && o.effective !== null && o.sticker !== o.effective
      ? { sticker: o.sticker }
      : {}),
    ...(o.coupon !== null ? { actionCouponOff: o.coupon } : {}),
    availability: o.availability,
    readPath: o.readPath,
    rung: o.rung,
  };
}

/** The listing's reads for the rules: its observations, and a failed read where one is known. */
function readsOf(
  db: Database,
  listingId: number,
  options: {
    readonly sinceIso: string;
    readonly upTo: ObservationRow | null;
    /** A failed attempt to place right before `upTo` (or at the end without one). */
    readonly failedAt: string | null;
    readonly nowIso: string;
  },
): AlertListingRead[] {
  const history = historyOf(db, listingId, {
    sinceIso: options.sinceIso,
    upTo: options.upTo,
    limit: HISTORY_MAX_READS,
  });
  const reads: AlertListingRead[] = history.map(observedRead);
  const at = options.failedAt;
  if (at === null || at > options.nowIso) return reads;
  const failed: AlertListingRead = { kind: 'failed', at, rung: 'http' };
  if (options.upTo !== null) {
    const last = reads.length - 1;
    const before = history[last - 1];
    const evaluated = history[last];
    // Only where it belongs in time: after the observation before, not after the evaluated one.
    if (
      evaluated !== undefined &&
      at <= evaluated.observedAt &&
      (before === undefined || at >= before.observedAt)
    ) {
      reads.splice(last, 0, failed);
    }
    return reads;
  }
  const latest = history[history.length - 1];
  if (latest === undefined || at >= latest.observedAt) reads.push(failed);
  return reads;
}

function evaluatePrice(
  ctx: EvaluationContext,
  watch: WatchRow,
  rules: ReturnType<typeof readWatchRules>,
  members: readonly Judged[],
  self: Judged,
  evaluated: ObservationRow,
  target: ObservationToEvaluate,
  nowIso: string,
  sinceIso: string,
): RuleResult {
  const held = (silence: HeldReason | string): RuleResult => ({
    fired: false,
    silence,
    eventId: null,
    created: false,
  });
  if (!self.identity.confirmed) return held('unconfirmed_listing');
  if (self.blocked) return held('store_blocked');
  const { db } = ctx;

  const reads = readsOf(db, self.listing.id, {
    sinceIso,
    upTo: evaluated,
    failedAt: target.failedBeforeAt,
    nowIso,
  });
  const last = lastAcceptedAlert(db, {
    profileId: watch.profileId,
    watchId: watch.id,
    kind: 'price_drop',
  });
  const decision = evaluatePriceAlert({
    now: nowIso,
    watch: {
      currency: watch.currency,
      referencePrice:
        watch.referencePrice !== null && watch.currency !== null
          ? { amountMinor: watch.referencePrice, currency: watch.currency }
          : null,
      targetPrice: rules.targetPrice,
      dropBasisPoints: rules.dropBasisPoints,
      cooldownSeconds: watch.cooldownS,
    },
    reads,
    lastAcceptedPriceAlert:
      last !== null && last.price !== null
        ? { price: last.price, acceptedAt: last.acceptedAt }
        : null,
  });
  if (!decision.fire) return held(decision.silence);

  // The outlier rule (S§5.5): an outlier needs a second read within 1% before it can alert.
  const outlier = outlierCheck(db, members, self, evaluated, reads, ctx.market.country);
  if (outlier !== null) return held(outlier);

  return recordAlert(ctx, watch, {
    kind: 'price_drop',
    listingId: self.listing.id,
    observationId: decision.observationId,
    price: decision.price,
  });
}

/** Null when the read may alert; otherwise why it is held. */
function outlierCheck(
  db: Database,
  members: readonly Judged[],
  self: Judged,
  evaluated: ObservationRow,
  reads: readonly AlertListingRead[],
  market: string,
): HeldReason | null {
  const condition = self.listing.condition;
  const currency = evaluated.currency;
  if (evaluated.effective === null) return null;
  const peers: ExactListingPrice[] = [];
  for (const m of members) {
    if (!m.mayAlert || m.listing.id === self.listing.id) continue;
    if (m.listing.condition !== condition || condition === 'unknown') continue;
    const latest = latestPricedIn(db, m.listing.id, currency);
    if (latest === undefined || latest.effective === null) continue;
    peers.push({
      listingId: m.listing.id,
      observationId: latest.id,
      effective: latest.effective,
      currency: latest.currency,
      condition: m.listing.condition,
      market,
    });
  }
  if (peers.length === 0) return null; // One exact listing: nothing to compare with.
  if (condition === 'unknown') return null; // Never compared (S§5.5); flagged instead.
  const candidate: ExactListingPrice = {
    listingId: self.listing.id,
    observationId: evaluated.id,
    effective: evaluated.effective,
    currency,
    condition,
    market,
  };
  const judged = assessOutlier([candidate, ...peers], self.listing.id);
  if (!judged.ok) return 'outlier_not_judged';
  if (!judged.value.outlier) return null;

  const before = reads[reads.length - 2];
  if (before === undefined || before.kind !== 'observation') return 'outlier_unconfirmed';
  const asConfirming = (r: AlertObservedRead): ConfirmingRead => ({
    id: r.observationId,
    listingId: self.listing.id,
    observedAt: r.observedAt,
    effective: r.price,
    currency: r.currency,
    availability: r.availability,
    readPath: r.readPath,
    rung: r.rung,
  });
  const confirmed = confirmOutlierRead(
    asConfirming(before),
    asConfirming(reads[reads.length - 1] as AlertObservedRead),
  );
  return confirmed.ok && confirmed.value.confirmed ? null : 'outlier_unconfirmed';
}

function evaluateRestockRule(
  ctx: EvaluationContext,
  watch: WatchRow,
  targetPrice: Money | null,
  members: readonly Judged[],
  evaluated: ObservationRow,
  target: ObservationToEvaluate,
  nowIso: string,
  sinceIso: string,
): RuleResult {
  const { db } = ctx;
  const listings: RestockListing[] = members
    .filter((m) => m.mayAlert)
    .map((m) => {
      const isSelf = m.listing.id === target.listingId;
      const check = m.check;
      const failedAt = isSelf
        ? target.failedBeforeAt
        : check?.lastError != null
          ? check.lastReadAt
          : null;
      return {
        listingId: m.listing.id,
        reads: readsOf(db, m.listing.id, {
          sinceIso,
          upTo: isSelf ? evaluated : null,
          failedAt,
          nowIso,
        }),
      };
    });
  const last = lastAcceptedAlert(db, {
    profileId: watch.profileId,
    watchId: watch.id,
    kind: 'restock',
  });
  const decision = evaluateRestock({
    now: nowIso,
    watch: {
      currency: watch.currency,
      targetPrice,
      restockRuleOnSince: watch.restockEnabledAt,
      lastAcceptedRestockAt: last?.acceptedAt ?? null,
    },
    listings,
  });
  if (!decision.fire) {
    return { fired: false, silence: decision.silence, eventId: null, created: false };
  }
  return recordAlert(ctx, watch, {
    kind: 'restock',
    listingId: decision.listingId,
    observationId: decision.observationId,
    price: decision.price,
  });
}

/**
 * Records the alert's event under its stable key, unless an earlier alert of the watch and kind is
 * still on its way (awaiting delivery) and this one is not news: for a price, not below it; for a
 * restock, any. An undelivered earlier alert (its push failed for good) holds a repeat that is not a
 * lower price for the watch's cooldown, counted from that event, so a broken channel cannot turn
 * one drop into an alert per read.
 */
function recordAlert(
  ctx: EvaluationContext,
  watch: WatchRow,
  alert: {
    readonly kind: 'price_drop' | 'restock';
    readonly listingId: number;
    readonly observationId: number;
    readonly price: Money;
  },
): RuleResult {
  const { db } = ctx;
  const key = alertEventKey({
    kind: alert.kind,
    watchId: watch.id,
    observationId: alert.observationId,
  });
  const previous = latestEventOf(db, watch.id, alert.kind);
  if (previous !== undefined && previous.key !== key && previous.observationId !== null) {
    const status = deliveryStatus(gatingDeliveries(db, previous.id));
    // A push that failed for good leaves the alert `undelivered`: nothing counts as delivered, so
    // no cooldown can be read back, and without a bound every read would record the same alert
    // again. The bound comes from the audit trail, not from a delivery: within the watch's
    // cooldown of the previous event, only a lower price is news. Nothing is stamped (S§2.11).
    const recent =
      status === 'undelivered' &&
      ctx.now() - Date.parse(previous.createdAt) < watch.cooldownS * 1000;
    if (status === 'awaiting_delivery' || recent) {
      const before = observationById(db, previous.observationId);
      const lower =
        alert.kind === 'price_drop' &&
        before !== undefined &&
        before.effective !== null &&
        before.currency === alert.price.currency &&
        alert.price.amountMinor < before.effective;
      if (!lower) {
        return {
          fired: false,
          silence: recent ? 'undelivered_recently' : 'awaiting_delivery',
          eventId: null,
          created: false,
        };
      }
    }
  }
  const recorded = recordEventInTransaction(db, {
    profileId: watch.profileId,
    now: ctx.now,
    event: {
      kind: alert.kind,
      key,
      watchId: watch.id,
      listingId: alert.listingId,
      observationId: alert.observationId,
    },
  });
  return { fired: true, silence: null, eventId: recorded.event.id, created: recorded.created };
}
