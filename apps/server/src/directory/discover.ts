import { type Database, schema } from '@agentic-dasher/db';
import { bindReaderGet, createRequestBudget, type Fetcher } from '@agentic-dasher/fetch';
import type { SearchRoute } from '@agentic-dasher/shared';
import {
  type DirectoryCandidate,
  type ReaderContext,
  type StoreFingerprint,
  type StoreSearch,
  type StoreSearchResult,
  searchBestBuyCanada,
  searchDeclaredTemplate,
  searchMagento,
  searchShopify,
  searchWoo,
} from '@agentic-dasher/sources';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import type { Discover } from '../watches/service.ts';
import { createRdapTrust } from './rdap.ts';
import { createStoreDirectory } from './triage.ts';

async function searchPlatform(
  input: StoreSearch,
  evidence: StoreFingerprint,
  context: ReaderContext,
): Promise<{ route: SearchRoute; result: StoreSearchResult } | null> {
  if (input.origin === 'https://www.bestbuy.ca' && input.market.country === 'CA')
    return { route: 'adapter', result: await searchBestBuyCanada(input, context) };
  switch (evidence.platform) {
    case 'shopify':
      if (evidence.predictiveSearch === false) return null;
      return { route: 'shopify_suggest', result: await searchShopify(input, context) };
    case 'woo':
      return { route: 'woo_store_api', result: await searchWoo(input, context) };
    case 'magento':
      return {
        route: 'magento_graphql',
        result: await searchMagento(
          { ...input, magentoGeneration: evidence.magentoGeneration },
          context,
        ),
      };
    default:
      return null;
  }
}

/** Execute only the store's declared routes. A wall, timeout or rate limit ends this store's lookup. */
export async function searchStoreRoutes(
  input: StoreSearch,
  evidence: StoreFingerprint,
  context: ReaderContext,
) {
  const platform = await searchPlatform(input, evidence, context);
  if (platform && platform.result.kind !== 'unsupported') return platform;
  const seen = new Set<string>();
  for (const [route, template] of [
    ['search_action', evidence.searchAction],
    ['opensearch', evidence.openSearchTemplate],
  ] as const) {
    if (!template || seen.has(template)) continue;
    seen.add(template);
    const result = await searchDeclaredTemplate(input, template, context);
    if (result.kind !== 'unsupported') return { route, result };
  }
  return platform;
}

/** Search eligible directory rows. Scheduled product reads supply the prices shown on a watch. */
export function createDirectoryDiscovery(deps: {
  db: Database;
  fetcher: Fetcher;
  now: () => number;
}): Discover {
  const { db, fetcher, now } = deps;
  const directory = createStoreDirectory(deps);
  const registration = createRdapTrust(deps);
  const s = schema.store;
  return async ({ name, market, signal }) => {
    const rows = db.orm
      .select()
      .from(s)
      .where(and(ne(s.trustTier, 'blocked'), or(eq(s.country, market.country), isNull(s.country))))
      .orderBy(
        desc(eq(s.country, market.country)),
        desc(eq(s.isShop, 'yes')),
        desc(s.lastOkAt),
        asc(s.id),
      )
      .limit(15)
      .all();
    const deadline = now() + 60_000;
    type Result = { candidates: DirectoryCandidate[]; state: 'failed' | 'answered' | 'skipped' };
    const searchStore = async (row: (typeof rows)[number]): Promise<Result> => {
      const skipped: Result = { state: 'skipped', candidates: [] };
      const fp = await directory.fingerprint({ storeId: row.id, market, signal, deadline });
      if (fp.kind !== 'fresh' && fp.kind !== 'cached') return skipped;
      if (fp.isShop !== 'yes') {
        const incomplete = fp.evidence.probes.some(
          (p) => p.outcome !== 'ok' && p.outcome !== 'not_found',
        );
        return { state: incomplete ? 'failed' : 'skipped', candidates: [] };
      }
      const context = {
        now,
        get: bindReaderGet(fetcher, {
          pageKind: 'search',
          deadline,
          signal,
          budget: createRequestBudget(3),
        }),
      };
      const search = await searchStoreRoutes(
        { origin: `https://${row.host}`, marketPrefix: row.marketPrefix, market, query: name },
        fp.evidence,
        context,
      );
      if (!search || search.result.kind === 'unsupported') return skipped;
      if (search.result.kind !== 'results') return { state: 'failed', candidates: [] };
      await registration.enrich(row.id, { deadline, signal });
      const active = db.orm
        .update(s)
        .set({ searchRoute: search.route })
        .where(and(eq(s.id, row.id), ne(s.trustTier, 'blocked')))
        .returning({ id: s.id })
        .get();
      return { state: 'answered', candidates: active ? search.result.candidates.slice(0, 2) : [] };
    };
    const results: Result[] = [];
    // Preserve market priority when independent stores finish in a different order.
    for (let start = 0; start < rows.length && now() < deadline; start += 3) {
      signal.throwIfAborted();
      results.push(...(await Promise.all(rows.slice(start, start + 3).map(searchStore))));
    }
    signal.throwIfAborted();
    if (!results.some((r) => r.state === 'answered') && results.some((r) => r.state === 'failed'))
      throw new Error('Directory stores could not be read. Lookup will retry.');
    return results.flatMap((r) => r.candidates);
  };
}
