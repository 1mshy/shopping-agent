// The reference a drop is measured from (S§5.8), on the rows: found by the independent review of
// 2026-11-25. (a) A read being evaluated, and the read that confirms it, must not be part of
// their own reference, or a new watch can never alert and the reference follows every drop down
// before it is confirmed. (b) Only in-stock reads count: an out-of-stock page often carries a
// placeholder or list price.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkListing } from '../../src/sweep/index.ts';
import {
  Clock,
  depsOf,
  eventsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  MIN,
  observationsOf,
  Script,
  type Scripted,
  TempDb,
  watchRow,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
let script: Script;
beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
});
afterEach(() => tmp.dispose());

function watched() {
  const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  const watchId = insertWatch(tmp.db, clock);
  follow(tmp.db, watchId, listingId);
  return { listingId, watchId, url: listingRow(tmp.db, listingId)?.urlCanonical as string };
}

async function reads(listingId: number, url: string, ...steps: Scripted[]) {
  for (const step of steps) {
    clock.advance(30 * MIN);
    script.push(url, step);
    await checkListing(depsOf(tmp, clock, script.read), listingId, { force: true });
  }
}

const H: Scripted = { price: 10_000 };
const L: Scripted = { price: 9_000 };

describe('the reference does not include the reads being judged', () => {
  it('a new watch alerts on a drop after one baseline read: H, L, L fires once, on the confirming read', async () => {
    const { listingId, watchId, url } = watched();
    await reads(listingId, url, H, L, L);
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'price_drop',
      watchId,
      observationId: observationsOf(tmp.db, listingId)[2]?.id,
    });
  });

  it('a halving of the price on a new watch alerts too', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, { price: 5_000 }, { price: 5_000 });
    expect(eventsOf(tmp.db)).toHaveLength(1);
  });

  it('the reference stays at the old price while a drop is read and confirmed', async () => {
    const { listingId, watchId, url } = watched();
    await reads(listingId, url, H, H, H, L);
    expect(watchRow(tmp.db, watchId)?.referencePrice).toBe(10_000);
    await reads(listingId, url, L);
    expect(watchRow(tmp.db, watchId)?.referencePrice).toBe(10_000);
    expect(eventsOf(tmp.db)).toHaveLength(1);
  });

  it('a single low read that recovers fires nothing', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, H, L, H, H);
    expect(eventsOf(tmp.db)).toHaveLength(0);
  });

  it('a steady price never fires', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, H, H, H, H, H);
    expect(eventsOf(tmp.db)).toHaveLength(0);
  });
});

describe('only in-stock reads count towards the reference', () => {
  it('out-of-stock reads at a placeholder price do not turn a steady price into a drop', async () => {
    const { listingId, watchId, url } = watched();
    const placeholder: Scripted = { price: 20_000, availability: 'out' };
    await reads(listingId, url, H, H, H, ...Array.from({ length: 6 }, () => placeholder), H, H);
    expect(eventsOf(tmp.db)).toHaveLength(0);
    expect(watchRow(tmp.db, watchId)?.referencePrice).toBe(10_000);
  });

  it('low out-of-stock placeholders do not hide a real drop', async () => {
    const { listingId, url } = watched();
    const placeholder: Scripted = { price: 100, availability: 'out' };
    await reads(listingId, url, H, H, H, ...Array.from({ length: 6 }, () => placeholder), L, L);
    expect(eventsOf(tmp.db).map((e) => e.kind)).toEqual(['price_drop']);
  });
});
