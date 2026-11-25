// An older alert accepted late must not become "the last accepted" (finding 5 of the independent
// review of 2026-11-25). With alerts A (90.00) and then B (80.00, a further drop) both on their
// way, a push that accepts B and then A a minute later leaves the user told 80.00: a read at 85.00
// inside the cooldown is not a further drop.
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

/** What an outbox pass would leave once every channel accepted the event, now. */
function accept(eventId: number): void {
  const d = schema.delivery;
  tmp.db.orm
    .update(d)
    .set({
      state: 'accepted',
      outcome: 'accepted',
      attempts: 1,
      nextAttemptAt: null,
      acceptedAt: clock.iso(),
    })
    .where(eq(d.eventId, eventId))
    .run();
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
const many = (step: Scripted, n: number) => Array.from({ length: n }, () => step);

describe('an older alert accepted after a newer one', () => {
  it('does not reopen a further drop: told 80.00, a read at 85.00 does not alert', async () => {
    const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    follow(tmp.db, insertWatch(tmp.db, clock), listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;

    await reads(listingId, url, ...many(H, 10), L, L);
    expect(eventsOf(tmp.db)).toHaveLength(1);
    await reads(listingId, url, { price: 8_000 });
    const [a, b] = eventsOf(tmp.db);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // The push accepts B first, then A a minute later.
    accept((b as { id: number }).id);
    clock.advance(MIN);
    accept((a as { id: number }).id);

    await reads(listingId, url, { price: 8_500 });
    expect(eventsOf(tmp.db)).toHaveLength(2);
  });

  it('a lower price than the newest accepted decision still alerts', async () => {
    const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    follow(tmp.db, insertWatch(tmp.db, clock), listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;

    await reads(listingId, url, ...many(H, 10), L, L, { price: 8_000 });
    const [a, b] = eventsOf(tmp.db);
    accept((b as { id: number }).id);
    clock.advance(MIN);
    accept((a as { id: number }).id);

    await reads(listingId, url, { price: 7_500 });
    expect(eventsOf(tmp.db)).toHaveLength(3);
  });
});
