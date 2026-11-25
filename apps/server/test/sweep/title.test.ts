// The listing's title: a pasted link is saved with its URL as a placeholder title (the lookup
// contacts no retailer), and the first real read replaces it. A title a read already gave stays.
import { schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkListing } from '../../src/sweep/index.ts';
import {
  Clock,
  depsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  readOf,
  TempDb,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
});
afterEach(() => tmp.dispose());

function listingTitled(title: (url: string) => string): number {
  const id = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  const url = listingRow(tmp.db, id)?.urlCanonical as string;
  tmp.db.orm
    .update(schema.listing)
    .set({ title: title(url) })
    .where(eq(schema.listing.id, id))
    .run();
  follow(tmp.db, insertWatch(tmp.db, clock), id);
  return id;
}

const reading = (title: string | null) => async () =>
  ({ kind: 'read', read: readOf({ title }), methods: [], candidates: [] }) as const;

describe('the listing title after a read', () => {
  it('replaces the placeholder (the listing URL) with the title the store states', async () => {
    const id = listingTitled((url) => url);
    await checkListing(depsOf(tmp, clock, reading('  Samsung 990 PRO 2TB  ')), id);
    expect(listingRow(tmp.db, id)?.title).toBe('Samsung 990 PRO 2TB');
  });

  it('keeps the placeholder when the read states no title', async () => {
    const id = listingTitled((url) => url);
    const url = listingRow(tmp.db, id)?.urlCanonical;
    await checkListing(depsOf(tmp, clock, reading(null)), id);
    expect(listingRow(tmp.db, id)?.title).toBe(url);
  });

  it('keeps a title an earlier read gave', async () => {
    const id = listingTitled(() => 'Widget, as first read');
    await checkListing(depsOf(tmp, clock, reading('Widget, renamed by the store')), id);
    expect(listingRow(tmp.db, id)?.title).toBe('Widget, as first read');
  });
});
