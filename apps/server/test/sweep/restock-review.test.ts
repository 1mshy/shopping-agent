// Two defects the review of the restock fix found (2026-11-25, the fourth review), each reproduced
// here on two listings of one watch:
// 1. one out→in moment recorded twice: the watermark was the time of the observation the newest
//    event names, which can be older than the decision that recorded it (the decision covered a
//    second listing that came back later);
// 2. after the clock steps back, another listing's reads lie after "now" and the pure rule threw.
import { schema } from '@agentic-dasher/db';
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
  PROFILE,
  Script,
  type Scripted,
  TempDb,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
let script: Script;

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
  // An in-app and a push channel; no delivery is settled, so every alert stays on its way.
  for (const type of ['in_app', 'ntfy'] as const) {
    tmp.db.orm
      .insert(schema.channel)
      .values({
        profileId: PROFILE,
        type,
        config: {},
        secretEnc: null,
        name: type,
        createdAt: clock.iso(),
        disabledAt: null,
        removedAt: null,
      })
      .run();
  }
});
afterEach(() => tmp.dispose());

const restocks = () => eventsOf(tmp.db).filter((e) => e.kind === 'restock');

function twoListings() {
  const watchId = insertWatch(tmp.db, clock, { restock: true });
  const make = () => {
    const id = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    follow(tmp.db, watchId, id);
    return { id, url: listingRow(tmp.db, id)?.urlCanonical as string };
  };
  return { x: make(), y: make() };
}

async function read(
  listing: { id: number; url: string },
  step: Scripted,
  options: { crash?: boolean; elapsedMs?: number } = {},
) {
  clock.advance(options.elapsedMs ?? 30 * MIN);
  script.push(listing.url, step);
  if (!options.crash) {
    return checkListing(depsOf(tmp, clock, script.read), listing.id, { force: true });
  }
  const crashing = depsOf(tmp, clock, script.read, [], {
    hooks: {
      afterObservationWritten: () => {
        throw new Error('process died');
      },
    },
  });
  await expect(checkListing(crashing, listing.id, { force: true })).rejects.toThrow('process died');
  return null;
}

const inAt = (price: number): Scripted => ({ price });
const outAt = (price: number): Scripted => ({ price, availability: 'out' });

describe('restock, two listings of one watch', () => {
  it.each([
    { firstPrice: 9_000, secondPrice: 10_000 },
    { firstPrice: 10_000, secondPrice: 9_000 },
  ])(
    'records a later decision in the same millisecond ($firstPrice first)',
    async ({ firstPrice, secondPrice }) => {
      const { x, y } = twoListings();
      await read(x, outAt(firstPrice));
      await read(y, outAt(secondPrice));
      await read(x, inAt(firstPrice));
      const first = observationsOf(tmp.db, x.id).at(-1);
      expect(restocks().map((e) => e.observationId)).toEqual([first?.id]);

      await read(y, inAt(secondPrice), { elapsedMs: 0 });
      const second = observationsOf(tmp.db, y.id).at(-1);
      expect(second?.observedAt).toBe(first?.observedAt);
      expect(restocks().map((e) => e.observationId)).toEqual([first?.id, second?.id]);

      await read(x, inAt(firstPrice));
      await read(y, inAt(secondPrice));
      expect(restocks().map((e) => e.observationId)).toEqual([first?.id, second?.id]);
    },
  );

  it('one decision that covers both listings is not recorded again for the second', async () => {
    const { x, y } = twoListings();
    await read(x, inAt(9_000));
    await read(y, inAt(10_000));
    await read(x, outAt(9_000));
    await read(y, outAt(10_000));
    // X comes back, and the process dies before its evaluation.
    await read(x, inAt(9_000), { crash: true });
    expect(restocks()).toHaveLength(0);
    // Y comes back: one event, naming the cheaper listing that is back, X.
    await read(y, inAt(10_000));
    expect(restocks()).toHaveLength(1);
    expect(restocks()[0]?.listingId).toBe(x.id);
    // Y is read again, still in stock: the same moment, no second event.
    await read(y, inAt(10_000));
    await read(x, inAt(9_000));
    expect(restocks()).toHaveLength(1);
    // A new transition is still a new decision.
    await read(y, outAt(10_000));
    await read(y, inAt(10_000));
    expect(restocks()).toHaveLength(2);
  });

  it('a clock that steps back does not stop the evaluation', async () => {
    const { x: a, y: b } = twoListings();
    await read(b, inAt(10_000));
    await read(a, inAt(9_000));
    await read(b, outAt(10_000));
    await read(a, inAt(9_000));
    clock.advance(-180 * MIN);
    // B comes back while A's last read is, by this clock, three hours ahead.
    clock.advance(-29 * MIN);
    const result = await read(b, inAt(10_000));
    expect(result).not.toBeNull();
    expect(observationsOf(tmp.db, b.id)).toHaveLength(3);
    expect(restocks()).toHaveLength(1);
    // And the next reads, still behind A's, go through and add nothing.
    await read(b, inAt(10_000));
    await read(a, inAt(9_000));
    expect(restocks()).toHaveLength(1);
  });
});
