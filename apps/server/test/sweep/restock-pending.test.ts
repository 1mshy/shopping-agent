// A restock held while a push is pending must not be lost (finding 6 of the independent review of
// 2026-11-25). A new out→in transition is a new decision and is recorded once, whatever the
// delivery state of the previous restock alert; the same transition is never recorded twice.
import { schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
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

const H: Scripted = { price: 10_000 };
const OUT: Scripted = { price: 10_000, availability: 'out' };
const many = (step: Scripted, n: number) => Array.from({ length: n }, () => step);

function watched() {
  const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  follow(tmp.db, insertWatch(tmp.db, clock, { restock: true }), listingId);
  return { listingId, url: listingRow(tmp.db, listingId)?.urlCanonical as string };
}

async function reads(listingId: number, url: string, ...steps: Scripted[]) {
  for (const step of steps) {
    clock.advance(30 * MIN);
    script.push(url, step);
    await checkListing(depsOf(tmp, clock, script.read), listingId, { force: true });
  }
}

const restocks = () => eventsOf(tmp.db).filter((e) => e.kind === 'restock');

/** Every delivery of every event so far: in-app accepted, the push as given, now. */
function settle(push: 'accepted' | 'failed'): void {
  const d = schema.delivery;
  for (const e of eventsOf(tmp.db)) {
    for (const row of tmp.db.orm.select().from(d).where(eq(d.eventId, e.id)).all()) {
      if (row.state !== 'pending') continue;
      const accepted = push === 'accepted' || row.channelId === 1;
      tmp.db.orm
        .update(d)
        .set({
          state: accepted ? 'accepted' : 'failed',
          outcome: accepted ? 'accepted' : 'failed',
          attempts: 1,
          nextAttemptAt: null,
          acceptedAt: accepted ? clock.iso() : null,
        })
        .where(eq(d.id, row.id))
        .run();
    }
  }
}

describe('restock alerts while the push of the previous one is pending', () => {
  it('two transitions are two events: H, out, H, out, H', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, OUT, H, OUT, H);
    expect(restocks()).toHaveLength(2);
  });

  it('one transition is one event: H, out, H, H, H', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, OUT, H, H, H);
    expect(restocks()).toHaveLength(1);
  });

  it('the push accepted after the second transition: later reads add nothing', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, OUT, H, OUT, H);
    settle('accepted');
    await reads(listingId, url, H, H, OUT, H);
    // The third transition is news; the reads in between are not.
    expect(restocks()).toHaveLength(3);
  });
});

describe('restock alerts after a push that failed for good', () => {
  it('the same transition is never recorded twice, even after the cooldown', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, H, OUT, H);
    settle('failed');
    // 30 reads at 30 minutes: well past the default 12-hour cooldown.
    for (const step of many(H, 30)) {
      await reads(listingId, url, step);
      settle('failed');
    }
    expect(restocks()).toHaveLength(1);
    await reads(listingId, url, OUT, H);
    expect(restocks()).toHaveLength(2);
  });
});
