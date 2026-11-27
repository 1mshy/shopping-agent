// Who may alert (S§5.4 "Verdict cache": alerts fire only for listings confirmed by identifier,
// rules, cached verdict or a person; S§5.5). A listing's identity for a watch is confirmed when:
// 1. a person's verdict says `exact` (a person's word beats everything, S§4.1 match_verdict); a
//    person's verdict of anything else ("marked wrong") means never, even for a pasted link;
// 2. otherwise, the user added it (`watch_listing.added_by = 'user'`: a pasted link is the person's
//    own word);
// 3. otherwise, the effective cached verdict (packages/core `effectiveVerdict`: identifier, then
//    rules, then a model verdict made under the current prompt and model) is `exact`.
// Anything else is unconfirmed and never alerts. No model is called: the cache is only read.
import {
  type CurrentVersions,
  decideMatch,
  effectiveVerdict,
  type ListingIdentity,
  listingFingerprint,
  MATCHER_VERSION,
  type MatchAsked,
  type MatchDecision,
  mpnConflict,
  normaliseGtin,
  specFingerprint,
} from '@agentic-dasher/core';
import { type Database, schema, writeVerdict } from '@agentic-dasher/db';
import { type DecidedBy, type MatchRelation, MatchVerdict } from '@agentic-dasher/shared';
import type { ListingRead } from '@agentic-dasher/sources';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ListingRow, StoreRow, WatchListingRow, WatchRow } from './rows.ts';

/** The versions a cached verdict must have been made under to count (S§5.4). */
export type VerdictVersions = CurrentVersions;

/** No model configured: only identifier, rules and person verdicts count. */
export const CODE_ONLY_VERSIONS: VerdictVersions = {
  matcherVersion: MATCHER_VERSION,
  promptVersion: null,
  modelId: null,
};

export interface ListingIdentityVerdict {
  readonly confirmed: boolean;
  /** The relation the alert and reference rules use: `exact` when confirmed. */
  readonly relation: MatchRelation;
  /** What confirmed it, or what the effective verdict was decided by; null with no verdict. */
  readonly by: 'user' | DecidedBy | null;
  /** A person's verdict other than `exact`. */
  readonly markedWrong: boolean;
}

type StoredListing = Pick<ListingRow, 'sku' | 'urlCanonical' | 'title' | 'variant'>;
type StoredStore = Pick<StoreRow, 'id' | 'host' | 'marketPrefix'>;

/** The identity fields as stored for the listing. */
export function listingIdentityOf(listing: StoredListing, store: StoredStore): ListingIdentity {
  return {
    store: String(store.id),
    sku: listing.sku,
    url: listing.urlCanonical,
    title: listing.title,
    variant: listing.variant,
  };
}

/** The URL of the stored listing stays the same when a later read supplies its SKU. Also read
 * verdicts written under older store/SKU keys until a lookup or owner action updates them. */
export function verdictKeys(listing: StoredListing, store: StoredStore, previousSku = listing.sku) {
  const identity = listingIdentityOf(listing, store);
  const stable = { ...identity, sku: null };
  const primary = listingFingerprint(stable);
  const untitled = listingFingerprint({ ...stable, title: listing.urlCanonical });
  const equivalent = new Set([primary]);
  for (const storeKey of new Set([
    identity.store,
    store.host,
    `${store.host}${store.marketPrefix}`,
    store.marketPrefix ? `${store.host}/${store.marketPrefix.replace(/^\/+/, '')}` : store.host,
  ])) {
    for (const sku of new Set([null, listing.sku, previousSku])) {
      equivalent.add(listingFingerprint({ ...identity, store: storeKey, sku }));
    }
  }
  return { primary, untitled, equivalent: [...equivalent] };
}

/** An interpreted intent supplies its identity fields. Ordinary name watches use the input. */
export function askedOf(watch: {
  readonly input: string;
  readonly spec?: WatchRow['spec'];
}): MatchAsked {
  const spec = watch.spec;
  return {
    name: spec?.name ?? watch.input,
    brand: spec?.brand ?? null,
    model: spec?.model ?? null,
    mpn: spec?.mpn ?? null,
    gtin: spec?.gtin ?? null,
    mustHave: Array.isArray(spec?.mustHave) ? spec.mustHave : [],
    packQuantity: spec?.packQuantity ?? null,
  };
}

export function cachedVerdict(
  db: Database,
  specFp: string,
  keys: ReturnType<typeof verdictKeys>,
  versions: VerdictVersions,
): MatchVerdict | null {
  const v = schema.matchVerdict;
  const rows = db.orm
    .select()
    .from(v)
    .where(and(eq(v.specFp, specFp), inArray(v.listingFp, [...keys.equivalent, keys.untitled])))
    .orderBy(desc(v.decidedAt), desc(v.id))
    .all();
  const verdicts: MatchVerdict[] = [];
  for (const { id: _id, ...row } of rows) {
    // The first read can fill a missing title. Only an identifier or an owner could establish
    // identity without that title. Older lookup code sometimes used the URL itself as a title.
    const placeholder = keys.primary === keys.untitled || row.listingFp === keys.untitled;
    if (placeholder && row.decidedBy !== 'person' && row.decidedBy !== 'identifier') continue;
    verdicts.push(MatchVerdict.parse(row));
  }
  return effectiveVerdict(verdicts, versions);
}

/** Replace the code decision even when changed evidence moves it between rules and identifier.
 * The caller's transaction also commits the discovery link or the corresponding observation. */
export function saveCodeDecision(
  db: Database,
  specFp: string,
  keys: ReturnType<typeof verdictKeys>,
  decision: MatchDecision,
  at: string,
): void {
  const v = schema.matchVerdict;
  db.orm
    .delete(v)
    .where(
      and(
        eq(v.specFp, specFp),
        inArray(v.listingFp, [...keys.equivalent, keys.untitled]),
        eq(v.matcherVersion, MATCHER_VERSION),
        inArray(v.decidedBy, ['identifier', 'rules']),
      ),
    )
    .run();
  writeVerdict(db, {
    specFp,
    listingFp: keys.primary,
    relation: decision.relation,
    differingAttrs: [...decision.differingAttrs],
    decidedBy: decision.decidedBy,
    matcherVersion: MATCHER_VERSION,
    promptVersion: null,
    modelId: null,
    decidedAt: at,
  });
}

/** A direct read can contradict a search result. Record the decision alongside the observation
 * so both immediate and resumed evaluations use the evidence on the page that supplied the price. */
export function recordReadIdentity(
  db: Database,
  listing: ListingRow,
  store: StoreRow,
  read: ListingRead,
  at: string,
): void {
  const w = schema.watch;
  const link = schema.watchListing;
  const watches = db.orm
    .select({ input: w.input, spec: w.spec })
    .from(w)
    .innerJoin(link, eq(w.id, link.watchId))
    .where(
      and(
        eq(link.listingId, listing.id),
        eq(w.kind, 'query'),
        eq(link.role, 'tracked'),
        eq(link.addedBy, 'discovery'),
      ),
    )
    .all();
  if (!watches.length) return;
  const keys = verdictKeys(listing, store);
  const page = {
    title: read.title === listing.urlCanonical ? '' : (read.title ?? ''),
    brand: read.identifiers.brand,
    gtin: read.identifiers.gtin,
    mpn: read.identifiers.mpn,
    variant: Object.keys(read.variant).length ? read.variant : listing.variant,
    url: listing.urlCanonical,
  };
  for (const watch of watches) {
    const asked = askedOf(watch);
    const decision = decideMatch({ asked, listing: page });
    // With no title a different valid barcode or part number is still evidence against identity.
    // An empty read, on the other hand, adds nothing to a cached decision.
    const askedGtin = normaliseGtin(asked.gtin);
    const pageGtin = normaliseGtin(page.gtin);
    const conflictingId =
      (askedGtin !== null && pageGtin !== null && askedGtin !== pageGtin) ||
      mpnConflict(asked.mpn, [], page.mpn);
    if (decision.rule !== 'unconfirmed' || conflictingId) {
      saveCodeDecision(db, specFingerprint(asked), keys, decision, at);
    }
  }
}

/** Whether the listing may alert for the watch (see the header). */
export function identityOf(
  db: Database,
  input: {
    readonly watch: WatchRow;
    readonly link: WatchListingRow;
    readonly listing: ListingRow;
    readonly store: StoreRow;
    readonly versions: VerdictVersions;
  },
): ListingIdentityVerdict {
  const verdict = cachedVerdict(
    db,
    specFingerprint(askedOf(input.watch)),
    verdictKeys(input.listing, input.store),
    input.versions,
  );
  if (verdict !== null && verdict.decidedBy === 'person') {
    const exact = verdict.relation === 'exact';
    return { confirmed: exact, relation: verdict.relation, by: 'person', markedWrong: !exact };
  }
  if (input.link.addedBy === 'user') {
    return { confirmed: true, relation: 'exact', by: 'user', markedWrong: false };
  }
  if (verdict !== null && verdict.relation === 'exact') {
    return { confirmed: true, relation: 'exact', by: verdict.decidedBy, markedWrong: false };
  }
  return {
    confirmed: false,
    relation: verdict?.relation ?? 'unknown',
    by: verdict?.decidedBy ?? null,
    markedWrong: false,
  };
}
