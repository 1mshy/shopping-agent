// A push channel that has failed for good (a 401, say) must not turn one drop into a new alert on
// every read (found by the independent review of 2026-11-25). Nothing counts as delivered while
// the push is failed, so there is no cooldown to read back; the sweep bounds the repeats itself,
// from the audit trail: one event per cooldown for a price that is not lower.
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
let pushChannelId: number;
let inAppChannelId: number;

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
  const channel = (type: 'in_app' | 'ntfy') =>
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
      .returning()
      .get().id;
  inAppChannelId = channel('in_app');
  pushChannelId = channel('ntfy');
});
afterEach(() => tmp.dispose());

/** What an outbox pass would leave: in-app accepted, the push failed for good. */
function settleDeliveries(): void {
  const d = schema.delivery;
  const at = clock.iso();
  tmp.db.orm
    .update(d)
    .set({
      state: 'accepted',
      outcome: 'accepted',
      attempts: 1,
      nextAttemptAt: null,
      acceptedAt: at,
    })
    .where(eq(d.channelId, inAppChannelId))
    .run();
  tmp.db.orm
    .update(d)
    .set({ state: 'failed', outcome: 'failed', attempts: 1, nextAttemptAt: null, acceptedAt: null })
    .where(eq(d.channelId, pushChannelId))
    .run();
}

async function reads(listingId: number, url: string, ...steps: Scripted[]) {
  for (const step of steps) {
    clock.advance(30 * MIN);
    script.push(url, step);
    await checkListing(depsOf(tmp, clock, script.read), listingId, { force: true });
    settleDeliveries();
  }
}

function watched() {
  const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
  follow(tmp.db, insertWatch(tmp.db, clock), listingId);
  return { listingId, url: listingRow(tmp.db, listingId)?.urlCanonical as string };
}

const H: Scripted = { price: 10_000 };
const L: Scripted = { price: 9_000 };
const many = (step: Scripted, n: number) => Array.from({ length: n }, () => step);

describe('a push channel that failed for good', () => {
  it('one drop at an unchanged price is one event, not one per read', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, ...many(H, 20), ...many(L, 10));
    expect(eventsOf(tmp.db)).toHaveLength(1);
  });

  it('a lower price still alerts at once', async () => {
    const { listingId, url } = watched();
    await reads(listingId, url, ...many(H, 20), L, L, { price: 8_000 }, { price: 8_000 });
    expect(eventsOf(tmp.db).length).toBeGreaterThanOrEqual(2);
  });

  it('the same price alerts again once the cooldown has passed, since nothing was delivered', async () => {
    const { listingId, url } = watched();
    // A baseline long enough that the reference is still the old price 13 hours into the drop
    // (a lasting drop pulls the reference down once low reads outnumber the baseline's).
    await reads(listingId, url, ...many(H, 60), ...many(L, 3));
    expect(eventsOf(tmp.db)).toHaveLength(1);
    // The default cooldown is 12 hours: 25 more reads at 30 minutes cross it once.
    await reads(listingId, url, ...many(L, 25));
    expect(eventsOf(tmp.db)).toHaveLength(2);
  });
});
