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
  effectiveVerdict,
  type ListingIdentity,
  listingFingerprint,
  MATCHER_VERSION,
  type MatchAsked,
  specFingerprint,
} from '@agentic-dasher/core';
import { type Database, readVerdicts } from '@agentic-dasher/db';
import type { DecidedBy, MatchRelation, MatchVerdict, SearchIntent } from '@agentic-dasher/shared';
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

/**
 * The listing's identity as the verdict cache keys it (S§4.1 listing_fp: store, SKU or clean URL,
 * title hash, variant). The store is written as its id. Exported so the unit that writes verdicts
 * keys them the same way.
 */
export function listingIdentityOf(listing: ListingRow, store: StoreRow): ListingIdentity {
  return {
    store: String(store.id),
    sku: listing.sku,
    url: listing.urlCanonical,
    title: listing.title,
    variant: listing.variant,
  };
}

/**
 * The listing fingerprints a cached verdict may sit under: the store as its id (the form above),
 * and as its host, or host and market prefix (the other reading of "the store" in
 * packages/core `ListingIdentity`), until the unit that writes verdicts settles on one.
 */
function fingerprintsOf(listing: ListingRow, store: StoreRow): string[] {
  const identity = listingIdentityOf(listing, store);
  const stores = new Set([
    String(store.id),
    store.host,
    `${store.host}${store.marketPrefix}`,
    store.marketPrefix === ''
      ? store.host
      : `${store.host}/${store.marketPrefix.replace(/^\/+/, '')}`,
  ]);
  return [...new Set([...stores].map((s) => listingFingerprint({ ...identity, store: s })))];
}

/** The identity part of the watch's stored intent, or null when it was never interpreted. */
export function askedOf(watch: WatchRow): MatchAsked | null {
  const spec = watch.spec as SearchIntent | null;
  if (spec === null || typeof spec !== 'object' || typeof spec.name !== 'string') return null;
  return {
    name: spec.name,
    brand: spec.brand ?? null,
    model: spec.model ?? null,
    mpn: spec.mpn ?? null,
    gtin: spec.gtin ?? null,
    mustHave: Array.isArray(spec.mustHave) ? spec.mustHave : [],
    packQuantity: spec.packQuantity ?? null,
  };
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
  const asked = askedOf(input.watch);
  let verdict: MatchVerdict | null = null;
  if (asked !== null) {
    const specFp = specFingerprint(asked);
    const all: MatchVerdict[] = [];
    for (const fp of fingerprintsOf(input.listing, input.store)) {
      all.push(...readVerdicts(db, specFp, fp));
    }
    verdict = effectiveVerdict(all, input.versions);
  }
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
