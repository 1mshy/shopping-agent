// An out→in transition can outlive the bounded history used to compare prices.
import { schema } from '@agentic-dasher/db';
import { afterEach, beforeEach, expect, it } from 'vitest';
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
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
let script: Script;
let listingId: number;
let watchId: number;
let url: string;
beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
  listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  watchId = insertWatch(tmp.db, clock, { restock: true });
  follow(tmp.db, watchId, listingId);
  url = listingRow(tmp.db, listingId)?.urlCanonical as string;
});
afterEach(() => tmp.dispose());

async function check(step: Scripted, crash = false) {
  clock.advance(MIN);
  script.push(url, step);
  const deps = depsOf(tmp, clock, script.read);
  return checkListing(
    crash
      ? {
          ...deps,
          hooks: {
            afterObservationWritten: () => {
              throw new Error('interrupted');
            },
          },
        }
      : deps,
    listingId,
    { force: true },
  );
}

function latest() {
  const row = observationsOf(tmp.db, listingId).at(-1);
  if (!row) throw new Error('Expected a stored observation');
  return row;
}

function expectRestock(transitionId: number, pricedId: number) {
  expect(eventsOf(tmp.db)).toMatchObject([
    { kind: 'restock', watchId, listingId, observationId: pricedId },
  ]);
  expect(tmp.db.orm.select().from(schema.restockCoverage).all()).toMatchObject([
    { listingId, throughObservationId: transitionId },
  ]);
}

it('recovers the first priced return after 31 days out and records the transition once', async () => {
  await check({ price: 500, availability: 'out' });
  clock.advance(31 * 24 * 60 * MIN);
  await expect(check({ price: 500 }, true)).rejects.toThrow('interrupted');
  const pending = latest();
  expect(eventsOf(tmp.db)).toHaveLength(0);
  tmp.db.close();
  tmp.db = TempDb.open(tmp.file);
  await check({ price: 500 });
  expectRestock(pending.id, pending.id);
  await check({ price: 500 });
  expectRestock(pending.id, pending.id);
});

it('finds the original transition over 500 in-stock reads before the first comparable price', async () => {
  await check({ price: 500, availability: 'out' });
  await check({ price: null, availability: 'in' });
  const { id: transitionId, ...unpriced } = latest();
  tmp.db.orm.transaction((tx) => {
    for (let count = 0; count < 500; count++) {
      clock.advance(MIN);
      tx.insert(schema.priceObservation)
        .values({ ...unpriced, observedAt: clock.iso() })
        .run();
    }
  });
  expect(eventsOf(tmp.db)).toHaveLength(0);
  await check({ price: 500 });
  const pricedId = latest().id;
  expectRestock(transitionId, pricedId);
  await check({ price: 500 });
  expectRestock(transitionId, pricedId);
});
