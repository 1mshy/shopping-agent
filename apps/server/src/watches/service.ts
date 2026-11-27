// The watch service (S§5.8 Intake, S§2.9 save first): create, change and read watches, on the
// tables of migrations 0001 and 0002. It never fetches a page, writes an observation or evaluates
// an alert: the sweep (apps/server/src/sweep) reads the rows this writes, the listings whose
// `listing_check.next_check_at` is due.
//
// Save first: `create` commits the `watch` row before anything else runs. Its lookup (`runLookup`,
// also the `watch-lookup` job) then writes what a link needs (store, listing, watch_listing,
// listing_check due now) or, for a name, asks the injected `discover` for candidates.
import {
  canonicalText,
  checkWatchRules,
  decideMatch,
  type IntakeRefusal,
  intakeWatch,
  type ListingUrlInput,
  MATCHER_VERSION,
  type MatchAsked,
  normaliseWatchInput,
  regionalListingUrl,
  specFingerprint,
} from '@agentic-dasher/core';
import { type Database, schema, writeVerdict } from '@agentic-dasher/db';
import {
  type Availability,
  type Condition,
  type MinorUnitCurrency,
  type Money,
  type ReadFailureCause,
  type ReferenceKind,
  type TrustTier,
  type WatchDetail,
  type WatchKind,
  type WatchLastAlert,
  type WatchListingAddedBy,
  type WatchListingRole,
  type WatchListingView,
  type WatchLookupState,
  WatchRules,
  type WatchStatus,
  type WatchView,
} from '@agentic-dasher/shared';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { marketPrefixOf } from '../directory/storefront.ts';
import { deliveryStatus, gatingDeliveries, lastAcceptedAlert } from '../notify/gating.ts';
import {
  askedOf,
  CODE_ONLY_VERSIONS,
  cachedVerdict,
  saveCodeDecision,
  verdictKeys,
} from '../sweep/identity.ts';

export { askedOf as askedFor } from '../sweep/identity.ts';

export const WATCH_ERROR_CODES = [
  'invalid',
  'not_found',
  'market_not_set',
  'currency_mismatch',
  'no_currency_yet',
  'archived',
] as const;
export type WatchErrorCode = (typeof WATCH_ERROR_CODES)[number] | IntakeRefusal;

export class WatchError extends Error {
  readonly code: WatchErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;
  constructor(code: WatchErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'WatchError';
    this.code = code;
    this.fields = fields;
  }
}

const REFUSAL_TEXT: Record<IntakeRefusal, [field: string, message: string]> = {
  not_one_link_or_name: ['input', 'Enter one product link or name (up to 1,000 characters).'],
  not_an_http_link: ['input', 'Use an http or https product link without login details.'],
  target_not_positive: ['targetPrice', 'A target price must be greater than zero.'],
  drop_out_of_range: ['dropBasisPoints', 'A price drop must be more than 0% and less than 100%.'],
  cooldown_too_short: ['cooldownSeconds', 'The alert cooldown must be at least one hour.'],
};

function refused(code: IntakeRefusal): WatchError {
  const [field, message] = REFUSAL_TEXT[code];
  return new WatchError(code, message, { [field]: message });
}

/** The user's configured market (S§2.3), from settings; null before the wizard set it. */
export interface UserMarketSetting {
  readonly country: string;
  readonly currency: MinorUnitCurrency;
  readonly language: string;
}

/** The storefronts of a store that runs several, from the store directory, for a pasted host. */
export type StorefrontsFor = (
  host: string,
) => Pick<ListingUrlInput, 'storefronts' | 'listingId'> | null;

/**
 * One listing a discovery source found for a name (the store directory's in-store search, S§5.2).
 * Everything in it is page text: data that is matched and stored, never an instruction (S§2.7).
 */
export interface Candidate {
  /** The listing's URL as the store gave it (http or https). */
  readonly url: string;
  /** The store's host, lower case. */
  readonly storeHost: string;
  /** The Shopify market prefix the result was found under ("/en-ca"), or "" for none. */
  readonly marketPrefix: string;
  readonly title: string;
  /** Identifiers the store states for it. */
  readonly gtin: string | null;
  readonly mpn: string | null;
  readonly sku: string | null;
  readonly brand: string | null;
  /** Variant options as the store names them. */
  readonly variant: Readonly<Record<string, string>>;
}

export interface DiscoverRequest {
  readonly name: string;
  readonly market: UserMarketSetting;
  readonly signal: AbortSignal;
}

export type Discover = (request: DiscoverRequest) => Promise<readonly Candidate[]>;

export interface WatchServiceDeps {
  readonly db: Database;
  /** Milliseconds since the epoch (an injected clock in tests). */
  readonly now: () => number;
  readonly market: () => UserMarketSetting | null;
  /** Called after a lookup made listings due, so the sweep can be triggered. */
  readonly onListingsDue?: () => void;
  /** The candidate source for a name; absent until the store directory is wired. */
  readonly discover?: Discover;
  readonly storefrontsFor?: StorefrontsFor;
}

export interface CreateWatchInput {
  readonly input: string;
  readonly targetPrice?: Money | null;
  readonly dropBasisPoints?: number | null;
  readonly restock?: boolean;
  readonly cooldownSeconds?: number | null;
}

export interface UpdateWatchInput {
  readonly targetPrice?: Money | null;
  readonly dropBasisPoints?: number | null;
  readonly restock?: boolean;
  readonly cooldownSeconds?: number;
  readonly paused?: boolean;
  readonly referencePrice?: Money | null;
}

/** Delays between lookup attempts that failed for a reason a retry may change. */
export const LOOKUP_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 3_600_000];
/** After this many failed attempts a lookup ends `failed`. */
export const LOOKUP_MAX_ATTEMPTS = 6;

export const NO_DISCOVERY_SOURCE =
  'no discovery source is configured yet: a name is looked up once the store directory can search stores';

const iso = (ms: number): string => new Date(ms).toISOString();

type WatchRow = typeof schema.watch.$inferSelect;

function statusOf(w: Pick<WatchRow, 'archivedAt' | 'pausedAt'>): WatchStatus {
  return w.archivedAt !== null ? 'archived' : w.pausedAt !== null ? 'paused' : 'active';
}

function rulesOf(w: WatchRow): WatchRules {
  const parsed = WatchRules.safeParse(w.rules);
  if (parsed.success) return parsed.data;
  // A row written by something else; shown with no rule rather than guessed.
  return { targetPrice: null, dropBasisPoints: null, restock: w.restockEnabledAt !== null };
}

/** S§5.3's candidate filter caps. */
export const MAX_LINKS_PER_HOST = 2;
export const MAX_CANDIDATE_HOSTS = 25;

/** Variant options that fit listing.variant_json (StoreText keys, values of 1-200 characters). */
function cleanVariant(variant: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (variant === null || typeof variant !== 'object') return out;
  for (const [name, value] of Object.entries(variant)) {
    if (
      typeof value === 'string' &&
      /^\S(?:.{0,98}\S)?$/.test(name) &&
      value.length >= 1 &&
      value.length <= 200
    ) {
      out[name] = value;
    }
  }
  return out;
}

function variantOf(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of url.searchParams) {
    // listing.variant_json holds option names as the store writes them (StoreText) and values.
    if (/^\S(?:.{0,98}\S)?$/.test(name) && value.length >= 1 && value.length <= 200) {
      out[name] = value;
    }
  }
  return out;
}

export function createWatchService(deps: WatchServiceDeps) {
  const { db } = deps;
  const o = db.orm;
  const { watch, watchListing, listing, listingCheck, store, priceObservation } = schema;

  function row(profileId: number, id: number): WatchRow {
    const w = o
      .select()
      .from(watch)
      .where(and(eq(watch.id, id), eq(watch.profileId, profileId)))
      .get();
    if (w === undefined) throw new WatchError('not_found', 'no such watch');
    return w;
  }

  function lastAlert(
    profileId: number,
    watchId: number,
    kind: 'price_drop' | 'restock',
  ): WatchLastAlert | null {
    const latest = o
      .select({ id: schema.notificationEvent.id, createdAt: schema.notificationEvent.createdAt })
      .from(schema.notificationEvent)
      .where(
        and(
          eq(schema.notificationEvent.profileId, profileId),
          eq(schema.notificationEvent.watchId, watchId),
          eq(schema.notificationEvent.kind, kind),
        ),
      )
      .orderBy(desc(schema.notificationEvent.createdAt), desc(schema.notificationEvent.id))
      .limit(1)
      .get();
    if (latest === undefined) return null;
    const accepted = lastAcceptedAlert(db, { profileId, watchId, kind });
    const mine = accepted?.eventId === latest.id ? accepted : null;
    const obs = o
      .select({ effective: priceObservation.effective, currency: priceObservation.currency })
      .from(schema.notificationEvent)
      .innerJoin(priceObservation, eq(priceObservation.id, schema.notificationEvent.observationId))
      .where(eq(schema.notificationEvent.id, latest.id))
      .get();
    return {
      eventId: latest.id,
      createdAt: latest.createdAt,
      delivery: deliveryStatus(gatingDeliveries(db, latest.id)),
      acceptedAt: mine?.acceptedAt ?? null,
      price:
        obs === undefined || obs.effective === null || obs.currency === 'unknown'
          ? null
          : { amountMinor: obs.effective, currency: obs.currency },
    };
  }

  function view(w: WatchRow): WatchView {
    const rules = rulesOf(w);
    const counts = { tracked: 0, candidate: 0, excluded: 0 };
    for (const r of o
      .select({ role: watchListing.role, n: sql<number>`count(*)` })
      .from(watchListing)
      .where(eq(watchListing.watchId, w.id))
      .groupBy(watchListing.role)
      .all()) {
      counts[r.role] = r.n;
    }
    return {
      id: w.id,
      kind: w.kind,
      input: w.input,
      market: w.market,
      currency: w.currency,
      rules,
      targetCurrencyMismatch:
        rules.targetPrice !== null &&
        w.currency !== null &&
        rules.targetPrice.currency !== w.currency,
      cooldownSeconds: w.cooldownS,
      status: statusOf(w),
      createdAt: w.createdAt,
      pausedAt: w.pausedAt,
      archivedAt: w.archivedAt,
      restockEnabledAt: w.restockEnabledAt,
      reference:
        w.referencePrice !== null && w.referenceKind !== null && w.currency !== null
          ? {
              price: { amountMinor: w.referencePrice, currency: w.currency },
              kind: w.referenceKind,
            }
          : null,
      lookup:
        w.lookupState === null || w.lookupQueuedAt === null || w.lookupAttempts === null
          ? null
          : {
              state: w.lookupState,
              queuedAt: w.lookupQueuedAt,
              dueAt: w.lookupDueAt,
              attempts: w.lookupAttempts,
              error: w.lookupError,
            },
      counts,
      lastAlerts: {
        price_drop: lastAlert(w.profileId, w.id, 'price_drop'),
        restock: lastAlert(w.profileId, w.id, 'restock'),
      },
    };
  }

  /** A listing's row in a watch, with what the UI shows; every figure is a stored observation. */
  function listingView(r: {
    listingId: number;
    role: WatchListingRole;
    addedBy: WatchListingAddedBy;
  }): WatchListingView {
    const l = o
      .select({
        url: listing.urlCanonical,
        title: listing.title,
        condition: listing.condition,
        consecutiveErrors: listing.consecutiveErrors,
        storeHost: store.host,
        trustTier: store.trustTier,
        nextCheckAt: listingCheck.nextCheckAt,
        lastReadAt: listingCheck.lastReadAt,
        lastError: listingCheck.lastError,
      })
      .from(listing)
      .innerJoin(store, eq(store.id, listing.storeId))
      .leftJoin(listingCheck, eq(listingCheck.listingId, listing.id))
      .where(eq(listing.id, r.listingId))
      .get();
    if (l === undefined) throw new WatchError('not_found', 'no such listing');
    const priced = o
      .select()
      .from(priceObservation)
      .where(
        and(
          eq(priceObservation.listingId, r.listingId),
          sql`${priceObservation.sticker} is not null`,
          sql`${priceObservation.currency} <> 'unknown'`,
        ),
      )
      .orderBy(desc(priceObservation.observedAt), desc(priceObservation.id))
      .limit(1)
      .get();
    const latest = o
      .select({ availability: priceObservation.availability })
      .from(priceObservation)
      .where(
        and(
          eq(priceObservation.listingId, r.listingId),
          sql`${priceObservation.availability} <> 'unknown'`,
        ),
      )
      .orderBy(desc(priceObservation.observedAt), desc(priceObservation.id))
      .limit(1)
      .get();
    const money = (amount: number | null, currency: string): Money | null =>
      amount === null || currency === 'unknown'
        ? null
        : { amountMinor: amount, currency: currency as MinorUnitCurrency };
    // stale-read's reading: a price is current exactly when the listing's latest read produced it.
    const freshness =
      priced === undefined
        ? 'none'
        : l.consecutiveErrors === 0 && l.lastReadAt !== null && l.lastReadAt === priced.observedAt
          ? 'current'
          : 'stale';
    return {
      listingId: r.listingId,
      role: r.role,
      addedBy: r.addedBy,
      url: l.url,
      title: l.title,
      storeHost: l.storeHost,
      trustTier: l.trustTier as TrustTier,
      condition: l.condition as Condition,
      conditionUnknown: l.condition === 'unknown',
      price:
        priced === undefined
          ? null
          : {
              effective: money(priced.effective, priced.currency),
              sticker: money(priced.sticker, priced.currency),
              observedAt: priced.observedAt,
              observationId: priced.id,
            },
      freshness,
      availability: (latest?.availability ?? 'unknown') as Availability,
      lastReadAt: l.lastReadAt ?? null,
      consecutiveErrors: l.consecutiveErrors,
      lastError: (l.lastError ?? null) as ReadFailureCause | null,
      nextCheckAt: l.nextCheckAt ?? null,
    };
  }

  /** Recomputes whether a listing is due: due while an active watch tracks it, else null. */
  function rescheduleListing(listingId: number, nowIso: string): void {
    const followed = o.get<{ n: number }>(sql`
      select count(*) as n from watch_listing wl join watch w on w.id = wl.watch_id
      where wl.listing_id = ${listingId} and wl.role = 'tracked'
        and w.archived_at is null and w.paused_at is null`);
    if ((followed?.n ?? 0) > 0) {
      o.run(sql`
        insert into listing_check (listing_id, next_check_at, last_read_at, first_error_at, last_error)
        values (${listingId}, ${nowIso}, null, null, null)
        on conflict (listing_id) do update set next_check_at = case
          when listing_check.next_check_at is null or listing_check.next_check_at > ${nowIso}
          then ${nowIso} else listing_check.next_check_at end`);
    } else {
      o.update(listingCheck)
        .set({ nextCheckAt: null })
        .where(eq(listingCheck.listingId, listingId))
        .run();
    }
  }

  function rescheduleWatchListings(watchId: number, nowIso: string): void {
    for (const l of o
      .select({ listingId: watchListing.listingId })
      .from(watchListing)
      .where(eq(watchListing.watchId, watchId))
      .all()) {
      rescheduleListing(l.listingId, nowIso);
    }
  }

  /** Find or insert the store and listing by their durable keys. */
  function upsertListing(
    url: URL,
    canonicalUrl: string,
    marketPrefix: string,
    title: string,
    variant: Record<string, string>,
    nowIso: string,
  ) {
    const host = url.hostname.toLowerCase();
    o.run(sql`
      insert into store (host, market_prefix, platform, platform_evidence, country, base_currency,
        markets_json, ships_to_json, search_route, read_route, identifiers_offered, is_shop,
        trust_tier, trust_reasons_json, source, fingerprinted_at, consecutive_errors, last_ok_at,
        last_error_at, last_error)
      values (${host}, ${marketPrefix}, 'unknown', null, null, 'unknown', null, null, null, null,
        null, 'unknown', 'unverified', '[]', 'pasted', null, 0, null, null, null)
      on conflict (host, market_prefix) do nothing`);
    const storeRow = o
      .select()
      .from(store)
      .where(and(eq(store.host, host), eq(store.marketPrefix, marketPrefix)))
      .get();
    if (storeRow === undefined) throw new Error(`store ${host} was not written`);
    const canonical = canonicalUrl;
    o.run(sql`
      insert into listing (product_id, store_id, channel, url_canonical, external_id, sku,
        seller_id, seller_kind, condition, currency, title, variant_json, trackable, first_seen_at,
        last_seen_at, gone_at, consecutive_errors)
      values (null, ${storeRow.id}, 'retail', ${canonical}, null, null, null, 'first_party',
        'unknown', 'unknown', ${title.slice(0, 500)}, ${JSON.stringify(variant)}, 1, ${nowIso},
        ${nowIso}, null, 0)
      on conflict (store_id, url_canonical) do nothing`);
    const l = o
      .select()
      .from(listing)
      .where(and(eq(listing.storeId, storeRow.id), eq(listing.urlCanonical, canonical)))
      .get();
    if (l === undefined) throw new Error(`listing ${canonical} was not written`);
    return { listing: l, store: storeRow };
  }

  function link(
    profileId: number,
    watchId: number,
    listingId: number,
    role: WatchListingRole,
    addedBy: WatchListingAddedBy,
  ): void {
    o.run(sql`
      insert into watch_listing (profile_id, watch_id, listing_id, role, added_by)
      values (${profileId}, ${watchId}, ${listingId}, ${role}, ${addedBy})
      on conflict (watch_id, listing_id) do update set role = excluded.role
      where watch_listing.added_by = 'discovery'`);
  }

  function lookupDone(watchId: number, attempts: number): void {
    o.update(watch)
      .set({ lookupState: 'done', lookupDueAt: null, lookupAttempts: attempts, lookupError: null })
      .where(eq(watch.id, watchId))
      .run();
  }

  function lookupFailed(watchId: number, attempts: number, error: string, nowMs: number): void {
    const transient = attempts < LOOKUP_MAX_ATTEMPTS;
    const delay =
      LOOKUP_RETRY_DELAYS_MS[Math.min(attempts - 1, LOOKUP_RETRY_DELAYS_MS.length - 1)] ?? 60_000;
    o.update(watch)
      .set(
        transient
          ? {
              lookupState: 'queued',
              lookupDueAt: iso(nowMs + delay),
              lookupAttempts: attempts,
              lookupError: error.slice(0, 500),
            }
          : {
              lookupState: 'failed',
              lookupDueAt: null,
              lookupAttempts: attempts,
              lookupError: error.slice(0, 500),
            },
      )
      .where(eq(watch.id, watchId))
      .run();
  }

  function lookupProduct(w: WatchRow, attempts: number, nowIso: string): boolean {
    const url = URL.parse(w.input);
    if (url === null) {
      // The intake decision never saves such a link; a row written elsewhere ends here.
      o.update(watch)
        .set({
          lookupState: 'failed',
          lookupDueAt: null,
          lookupAttempts: attempts,
          lookupError: 'the saved link is not a URL',
        })
        .where(eq(watch.id, w.id))
        .run();
      return false;
    }
    db.orm.transaction(() => {
      const saved = upsertListing(
        url,
        w.input,
        marketPrefixOf(url.pathname),
        w.input,
        variantOf(url),
        nowIso,
      );
      link(w.profileId, w.id, saved.listing.id, 'tracked', 'user');
      rescheduleListing(saved.listing.id, nowIso);
      lookupDone(w.id, attempts);
    });
    return true;
  }

  async function lookupQuery(w: WatchRow, attempts: number, signal: AbortSignal): Promise<boolean> {
    const nowMs = deps.now();
    if (deps.discover === undefined) {
      // Not a transient failure: nothing changes until a source is configured. The re-discovery
      // rule (lookup_queued_at a day old) queues it again then.
      o.update(watch)
        .set({
          lookupState: 'failed',
          lookupDueAt: null,
          lookupAttempts: attempts,
          lookupError: NO_DISCOVERY_SOURCE,
        })
        .where(eq(watch.id, w.id))
        .run();
      return false;
    }
    const market = deps.market();
    if (market === null) {
      lookupFailed(w.id, attempts, 'the market is not set', nowMs);
      return false;
    }
    let candidates: readonly Candidate[];
    try {
      candidates = await deps.discover({ name: w.input, market, signal });
    } catch (error) {
      lookupFailed(w.id, attempts, error instanceof Error ? error.message : String(error), nowMs);
      return false;
    }
    if (!Array.isArray(candidates)) {
      lookupFailed(
        w.id,
        attempts,
        'the discovery source answered something other than a list',
        nowMs,
      );
      return false;
    }
    // Still the watch's own lookup? (It may have been paused or archived while discovery ran.)
    const still = o.select().from(watch).where(eq(watch.id, w.id)).get();
    if (still === undefined || still.lookupState !== 'queued' || statusOf(still) !== 'active') {
      return false;
    }
    const nowIso = iso(deps.now());
    const asked = askedOf(still);
    const specFp = specFingerprint(asked);
    let tracked = 0;
    db.orm.transaction(() => {
      for (const c of capCandidates(candidates)) {
        const role = linkCandidate(w, c, asked, specFp, nowIso);
        if (role === 'tracked') tracked++;
      }
      lookupDone(w.id, attempts);
    });
    return tracked > 0;
  }

  /**
   * The candidate filter's caps (S§5.3): at most 2 links per host and 25 hosts, in the order the
   * source gave. A candidate whose URL is not an http(s) link is dropped.
   */
  function capCandidates(
    candidates: readonly Candidate[],
  ): { c: Candidate; url: URL; link: string }[] {
    const perHost = new Map<string, number>();
    const out: { c: Candidate; url: URL; link: string }[] = [];
    for (const c of candidates) {
      if (typeof c?.url !== 'string') continue;
      const n = normaliseWatchInput(c.url);
      if (!n.ok || n.kind !== 'product') continue;
      const url = URL.parse(n.value);
      if (url === null) continue;
      const host = url.hostname.toLowerCase();
      const seen = perHost.get(host) ?? 0;
      if (seen === 0 && perHost.size >= MAX_CANDIDATE_HOSTS) continue;
      if (seen >= MAX_LINKS_PER_HOST) continue;
      perHost.set(host, seen + 1);
      out.push({ c, url, link: n.value });
    }
    return out;
  }

  /**
   * Links one candidate: tiers 1-2 of the matcher (or a person's cached verdict, which wins) decide;
   * only `exact` is tracked, everything else is a candidate the UI shows as unconfirmed. A person's choice
   * of role survives rediscovery.
   */
  function linkCandidate(
    w: WatchRow,
    entry: { c: Candidate; url: URL; link: string },
    asked: MatchAsked,
    specFp: string,
    nowIso: string,
  ): WatchListingRole {
    const { c, url, link: canonical } = entry;
    const prefix =
      typeof c.marketPrefix === 'string' && /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?$/.test(c.marketPrefix)
        ? c.marketPrefix
        : '';
    const title = typeof c.title === 'string' ? c.title.trim().slice(0, 500) : '';
    const variant = cleanVariant(c.variant);
    const text = (v: unknown, max: number): string | null =>
      typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : null;
    const saved = upsertListing(url, canonical, prefix, title || canonical, variant, nowIso);
    const listingId = saved.listing.id;
    // One shared row can serve several watches. A different result's display title or options
    // must not change the catalogue identity and check request already used by another watch.
    const shared = o
      .select({ id: watchListing.id })
      .from(watchListing)
      .where(and(eq(watchListing.listingId, listingId), ne(watchListing.watchId, w.id)))
      .limit(1)
      .get();
    const current = shared
      ? saved.listing
      : {
          ...saved.listing,
          title: title || saved.listing.title,
          variant,
          sku: text(c.sku, 256) ?? saved.listing.sku,
        };
    const keys = verdictKeys(current, saved.store, saved.listing.sku);
    const verdict = cachedVerdict(db, specFp, keys, CODE_ONLY_VERSIONS);
    if (!shared) {
      o.update(listing)
        .set({ title: current.title, variant: current.variant, sku: current.sku })
        .where(eq(listing.id, listingId))
        .run();
    }
    const selector = new Map(
      Object.entries(current.variant).map(([k, v]) => [canonicalText(k), canonicalText(v)]),
    );
    const sameSelection = Object.entries(variant).every(
      ([k, v]) => selector.get(canonicalText(k)) === canonicalText(v),
    );
    let relation = verdict?.relation;
    if (verdict?.decidedBy === 'person') {
      if (verdict.listingFp !== keys.primary)
        writeVerdict(db, { ...verdict, listingFp: keys.primary });
    } else if (!sameSelection) {
      // This URL is already scheduled with different options. Another variant's evidence
      // cannot establish or invalidate the identity of the one the reader will actually request.
      relation = 'unknown';
    } else {
      // Brand, MPN and GTIN can change while the cache fingerprint stays the same. Re-evaluate
      // the cheap code tiers and replace any old code decision, including a formerly stronger tier.
      const decision = decideMatch({
        asked,
        listing: {
          title: title === canonical ? '' : title,
          brand: text(c.brand, 200),
          mpn: text(c.mpn, 64),
          gtin: text(c.gtin, 32),
          variant: current.variant,
          url: canonical,
        },
      });
      saveCodeDecision(db, specFp, keys, decision, nowIso);
      relation = decision.relation;
    }
    const role: WatchListingRole = relation === 'exact' ? 'tracked' : 'candidate';
    link(w.profileId, w.id, listingId, role, 'discovery');
    const actual = o
      .select({ role: watchListing.role })
      .from(watchListing)
      .where(and(eq(watchListing.watchId, w.id), eq(watchListing.listingId, listingId)))
      .get();
    rescheduleListing(listingId, nowIso);
    return actual?.role ?? role;
  }

  /**
   * Runs one watch's lookup now. A product watch needs no network; a query watch asks `discover`.
   * Returns true when listings became due.
   */
  async function runLookup(
    watchId: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<boolean> {
    const w = o.select().from(watch).where(eq(watch.id, watchId)).get();
    if (w === undefined || w.lookupState !== 'queued' || statusOf(w) !== 'active') return false;
    const attempts = (w.lookupAttempts ?? 0) + 1;
    const nowIso = iso(deps.now());
    let due = false;
    if (w.kind === 'product') {
      due = lookupProduct(w, attempts, nowIso);
    } else if (w.kind === 'query') {
      due = await lookupQuery(w, attempts, signal);
    } else {
      return false;
    }
    if (due) deps.onListingsDue?.();
    return due;
  }

  /** The `watch-lookup` job's pass: every active watch whose queued lookup is due. */
  async function runDueLookups(signal: AbortSignal): Promise<{ attempted: number; done: number }> {
    const nowIso = iso(deps.now());
    const due = o
      .select({ id: watch.id })
      .from(watch)
      .where(
        and(
          sql`${watch.lookupDueAt} <= ${nowIso}`,
          isNull(watch.archivedAt),
          isNull(watch.pausedAt),
        ),
      )
      .orderBy(asc(watch.lookupDueAt), asc(watch.id))
      .all();
    let done = 0;
    for (const { id } of due) {
      if (signal.aborted) break;
      if (await runLookup(id, signal)) done++;
    }
    return { attempted: due.length, done };
  }

  return {
    /**
     * Save first (S§2.9): the watch row is committed before anything else happens. A duplicate of
     * a watch that is not archived returns that watch. The lookup is not run here: the caller
     * (the route) runs `runLookup` right after, once the row is saved.
     */
    create(profileId: number, input: CreateWatchInput): { created: boolean; watch: WatchView } {
      const market = deps.market();
      const rules = {
        targetPrice: input.targetPrice ?? null,
        dropBasisPoints: input.dropBasisPoints ?? null,
        restock: input.restock ?? false,
        cooldownSeconds: input.cooldownSeconds ?? null,
      };
      // A link is moved to the user's regional storefront before its key is taken (S§5.8).
      let typed = input.input;
      const first = normaliseWatchInput(typed);
      if (first.ok && first.kind === 'product' && market !== null) {
        const url = URL.parse(first.value);
        const fronts = url === null ? null : (deps.storefrontsFor?.(url.hostname) ?? null);
        if (fronts !== null) {
          const moved = regionalListingUrl({ url: first.value, market, ...fronts });
          if (moved.kind === 'rewritten') typed = moved.url;
        }
      }
      const key = normaliseWatchInput(typed);
      const existing = key.ok
        ? o
            .select({ id: watch.id, pausedAt: watch.pausedAt })
            .from(watch)
            .where(
              and(
                eq(watch.profileId, profileId),
                eq(watch.dedupeKey, key.key),
                isNull(watch.archivedAt),
              ),
            )
            .all()
            .map((w) => ({ watchId: w.id, key: key.key, active: w.pausedAt === null }))
        : [];
      const decision = intakeWatch({ input: typed, rules, existing });
      if (!decision.ok) throw refused(decision.refusal);
      if (decision.action === 'existing') {
        return { created: false, watch: view(row(profileId, decision.watchId)) };
      }
      if (market === null) {
        throw new WatchError(
          'market_not_set',
          'Set your country and currency in Settings first: a watch searches your market.',
        );
      }
      const nowIso = iso(deps.now());
      const saved = decision.rules;
      const stored: WatchRules = WatchRules.parse({
        targetPrice: saved.targetPrice,
        dropBasisPoints: saved.dropBasisPoints,
        restock: saved.restock,
      });
      const id = db.orm.transaction((tx) => {
        const r = tx
          .insert(watch)
          .values({
            profileId,
            kind: decision.kind satisfies WatchKind,
            input: decision.normalised,
            spec: null,
            market: market.country,
            currency: null,
            rules: stored,
            referencePrice: null,
            referenceKind: null,
            cooldownS: saved.cooldownSeconds,
            createdAt: nowIso,
            pausedAt: null,
            archivedAt: null,
            dedupeKey: decision.key,
            restockEnabledAt: saved.restock ? nowIso : null,
            lookupState: 'queued' satisfies WatchLookupState,
            lookupQueuedAt: nowIso,
            lookupDueAt: nowIso,
            lookupAttempts: 0,
            lookupError: null,
          })
          .returning({ id: watch.id })
          .get();
        return r.id;
      });
      return { created: true, watch: view(row(profileId, id)) };
    },

    runLookup,
    runDueLookups,

    /**
     * A person's action on one listing of a watch (S§5.12): `exclude` stops following it, `track`
     * follows it again (a person's word confirms it), `wrong_match` excludes it, writes a person's
     * verdict to the cache (it overrides rules and models, S§4.1) and appends a `wrong_match` event.
     */
    setListingRole(
      profileId: number,
      watchId: number,
      listingId: number,
      action: 'exclude' | 'track' | 'wrong_match',
    ): WatchListingView {
      const w = row(profileId, watchId);
      if (w.archivedAt !== null)
        throw new WatchError('archived', 'an archived watch cannot change');
      const linkRow = o
        .select({ id: watchListing.id })
        .from(watchListing)
        .where(and(eq(watchListing.watchId, watchId), eq(watchListing.listingId, listingId)))
        .get();
      if (linkRow === undefined) throw new WatchError('not_found', 'no such listing on this watch');
      const nowIso = iso(deps.now());
      db.orm.transaction((tx) => {
        tx.update(watchListing)
          .set(
            action === 'track'
              ? { role: 'tracked', addedBy: 'user' }
              : { role: 'excluded', addedBy: 'user' },
          )
          .where(eq(watchListing.id, linkRow.id))
          .run();
        if (action !== 'exclude') {
          const l = o
            .select({
              listing,
              store,
            })
            .from(listing)
            .innerJoin(store, eq(store.id, listing.storeId))
            .where(eq(listing.id, listingId))
            .get();
          if (l !== undefined) {
            writeVerdict(db, {
              specFp: specFingerprint(askedOf(w)),
              listingFp: verdictKeys(l.listing, l.store).primary,
              relation: action === 'track' ? 'exact' : 'other_model',
              differingAttrs: [],
              decidedBy: 'person',
              matcherVersion: MATCHER_VERSION,
              promptVersion: null,
              modelId: null,
              decidedAt: nowIso,
            });
          }
        }
        if (action === 'wrong_match') {
          tx.insert(schema.event)
            .values({ profileId, kind: 'wrong_match', createdAt: nowIso })
            .run();
        }
        rescheduleListing(listingId, nowIso);
      });
      if (action === 'track') deps.onListingsDue?.();
      const r = o
        .select({
          listingId: watchListing.listingId,
          role: watchListing.role,
          addedBy: watchListing.addedBy,
        })
        .from(watchListing)
        .where(eq(watchListing.id, linkRow.id))
        .get();
      if (r === undefined) throw new WatchError('not_found', 'no such listing on this watch');
      return listingView(r);
    },

    list(profileId: number, options: { includeArchived?: boolean } = {}): WatchView[] {
      return o
        .select()
        .from(watch)
        .where(
          and(
            eq(watch.profileId, profileId),
            options.includeArchived ? sql`1` : isNull(watch.archivedAt),
          ),
        )
        .orderBy(desc(watch.createdAt), desc(watch.id))
        .all()
        .map(view);
    },

    get(profileId: number, id: number): WatchDetail {
      const w = row(profileId, id);
      const links = o
        .select({
          listingId: watchListing.listingId,
          role: watchListing.role,
          addedBy: watchListing.addedBy,
        })
        .from(watchListing)
        .where(eq(watchListing.watchId, id))
        .orderBy(asc(watchListing.id))
        .all();
      return { watch: view(w), listings: links.map(listingView) };
    },

    update(profileId: number, id: number, input: UpdateWatchInput): WatchView {
      const w = row(profileId, id);
      if (w.archivedAt !== null)
        throw new WatchError('archived', 'an archived watch cannot change');
      const nowMs = deps.now();
      const nowIso = iso(nowMs);
      const current = rulesOf(w);
      const touchesRules =
        input.targetPrice !== undefined ||
        input.dropBasisPoints !== undefined ||
        input.restock !== undefined ||
        input.cooldownSeconds !== undefined;
      const set: Partial<typeof watch.$inferInsert> = {};
      if (touchesRules) {
        const next = {
          targetPrice: input.targetPrice !== undefined ? input.targetPrice : current.targetPrice,
          dropBasisPoints:
            input.dropBasisPoints !== undefined ? input.dropBasisPoints : current.dropBasisPoints,
          restock: input.restock ?? current.restock,
          cooldownSeconds: input.cooldownSeconds ?? w.cooldownS,
        };
        // A target in another currency than the adopted one would never be compared (S§2.2).
        if (
          input.targetPrice != null &&
          w.currency !== null &&
          input.targetPrice.currency !== w.currency
        ) {
          throw new WatchError(
            'currency_mismatch',
            `This watch's prices are in ${w.currency}; a target in ${input.targetPrice.currency} would never be compared.`,
            { targetPrice: 'currency differs from the watch' },
          );
        }
        // The intake decision's validation; with every rule off, its default (5% drop) applies.
        const checked = checkWatchRules(next);
        if (!checked.ok) throw refused(checked.refusal);
        set.rules = WatchRules.parse({
          targetPrice: checked.rules.targetPrice,
          dropBasisPoints: checked.rules.dropBasisPoints,
          restock: checked.rules.restock,
        });
        set.cooldownS = checked.rules.cooldownSeconds;
        if (checked.rules.restock && !current.restock) set.restockEnabledAt = nowIso;
        if (!checked.rules.restock) set.restockEnabledAt = null;
      }
      if (input.referencePrice !== undefined) {
        if (input.referencePrice === null) {
          set.referencePrice = null;
          set.referenceKind = null;
        } else {
          if (w.currency === null) {
            throw new WatchError(
              'no_currency_yet',
              'A reference price can be set once the first price has been read.',
              { referencePrice: 'no currency adopted yet' },
            );
          }
          if (input.referencePrice.currency !== w.currency) {
            throw new WatchError('currency_mismatch', `This watch's prices are in ${w.currency}.`, {
              referencePrice: 'currency differs from the watch',
            });
          }
          if (input.referencePrice.amountMinor <= 0) {
            throw new WatchError('invalid', 'A reference price must be greater than zero.', {
              referencePrice: 'not positive',
            });
          }
          set.referencePrice = input.referencePrice.amountMinor;
          set.referenceKind = 'user_confirmed' satisfies ReferenceKind;
        }
      }
      if (input.paused === true && w.pausedAt === null) set.pausedAt = nowIso;
      if (input.paused === false && w.pausedAt !== null) set.pausedAt = null;
      db.orm.transaction((tx) => {
        if (Object.keys(set).length > 0) tx.update(watch).set(set).where(eq(watch.id, id)).run();
        if (input.paused !== undefined) rescheduleWatchListings(id, nowIso);
      });
      if (input.paused === false && w.pausedAt !== null) deps.onListingsDue?.();
      return view(row(profileId, id));
    },

    /**
     * The UI's delete: archives (a watch that alerted keeps its audit trail; S§4.2). Its key is free
     * again, and a listing no other active watch tracks stops being due (next_check_at null).
     */
    archive(profileId: number, id: number): WatchView {
      const w = row(profileId, id);
      if (w.archivedAt === null) {
        const nowIso = iso(deps.now());
        db.orm.transaction((tx) => {
          tx.update(watch)
            .set({
              archivedAt: nowIso,
              ...(w.lookupState === 'queued'
                ? { lookupState: 'failed', lookupDueAt: null, lookupError: 'archived' }
                : {}),
            })
            .where(eq(watch.id, id))
            .run();
          rescheduleWatchListings(id, nowIso);
        });
      }
      return view(row(profileId, id));
    },
  };
}

export type WatchService = ReturnType<typeof createWatchService>;
