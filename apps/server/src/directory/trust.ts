import { lookalikeReferences } from '@agentic-dasher/core';
import { type Database, schema } from '@agentic-dasher/db';
import type { TrustTier } from '@agentic-dasher/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

/** Initial trust for a newly discovered host. Intake's ON CONFLICT preserves all owner decisions. */
export function initialStoreTrust(
  db: Database,
  host: string,
): { tier: TrustTier; reasons: string[] } {
  const refs = lookalikeReferences(host);
  if (refs.length) {
    const s = schema.store;
    // Exact candidate keys use the existing (host, market_prefix) index. An unverified
    // shop, a country-pack entry or a successful price read alone is never a reference.
    const bare = host
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
    const known = db.orm
      .selectDistinct({ host: s.host })
      .from(s)
      .where(and(inArray(s.host, [bare, `www.${bare}`, ...refs]), eq(s.trustTier, 'known')))
      .orderBy(asc(s.host))
      .all();
    const first = known[0];
    if (first && !known.some((row) => row.host === bare || row.host === `www.${bare}`))
      return { tier: 'caution', reasons: [`Hostname resembles known storefront ${first.host}`] };
  }
  return { tier: 'unverified', reasons: [] };
}
