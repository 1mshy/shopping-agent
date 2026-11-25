// A crash right after the observation insert, on a host whose clock also stepped back, must not
// leave that observation unevaluated for ever (finding 8 of the independent review of 2026-11-25).
// The read time is never before the last one (max(now, last_read_at)); with the clock behind, the
// new observation used to carry exactly last_read_at, and the resume test (newer than last_read_at)
// never saw it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkListing } from '../../src/sweep/index.ts';
import {
  Clock,
  checkRow,
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

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
});
afterEach(() => tmp.dispose());

const H: Scripted = { price: 10_000 };
const L: Scripted = { price: 9_000 };

function watched() {
  const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  follow(tmp.db, insertWatch(tmp.db, clock), listingId);
  return { listingId, url: listingRow(tmp.db, listingId)?.urlCanonical as string };
}

async function reads(listingId: number, url: string, ...steps: Scripted[]) {
  const out = [];
  for (const step of steps) {
    clock.advance(30 * MIN);
    script.push(url, step);
    out.push(await checkListing(depsOf(tmp, clock, script.read), listingId, { force: true }));
  }
  return out;
}

/** The clock steps back, then a read whose process dies right after the observation insert. */
async function crashAfterStepBack(listingId: number, url: string, step: Scripted): Promise<number> {
  clock.advance(-10 * MIN);
  script.push(url, step);
  let crashedOn = -1;
  const crashing = depsOf(tmp, clock, script.read, [], {
    hooks: {
      afterObservationWritten: (id: number) => {
        crashedOn = id;
        throw new Error('process died');
      },
    },
  });
  await expect(checkListing(crashing, listingId, { force: true })).rejects.toThrow('process died');
  return crashedOn;
}

describe('a crash after the observation insert, with the clock stepped back', () => {
  it('the next check still evaluates the observation, and records its alert once', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, H, H, H, L);
    expect(eventsOf(tmp.db)).toHaveLength(0);
    const crashedOn = await crashAfterStepBack(listingId, url, L);
    expect(eventsOf(tmp.db)).toHaveLength(0);

    const [next] = await reads(listingId, url, L);
    expect(next?.resumed).toHaveLength(1);
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]?.observationId).toBe(crashedOn);
  });

  it('after a failed read too: the observation is evaluated on resume', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, H, { fail: 'network_error' });
    await crashAfterStepBack(listingId, url, H);
    const [next] = await reads(listingId, url, H);
    expect(next?.resumed).toHaveLength(1);
  });

  it('observation times stay in order, and the newest is evaluated', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, H);
    clock.advance(-60 * MIN);
    await reads(listingId, url, H); // 30 minutes behind the last read
    const times = observationsOf(tmp.db, listingId).map((o) => o.observedAt);
    expect([...times].sort()).toEqual(times);
    expect(checkRow(tmp.db, listingId)?.lastReadAt).toBe(times[times.length - 1]);
    // Nothing is left to resume.
    const [next] = await reads(listingId, url, H);
    expect(next?.resumed).toHaveLength(0);
  });
});
