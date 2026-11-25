// The read model: shown price and freshness, read state, last alerts with their delivery status.
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runOutboxPass } from '../../src/notify/index.ts';
import { createSecretBox } from '../../src/secrets/index.ts';
import { checkListing, listingState, watchState } from '../../src/sweep/index.ts';
import {
  Clock,
  depsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  MIN,
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

async function readOnce(listingId: number, url: string, step: Scripted) {
  clock.advance(30 * MIN);
  script.push(url, step);
  return checkListing(depsOf(tmp, clock, script.read), listingId, { force: true });
}

describe('listingState and watchState', () => {
  it('a never-read listing shows no price', () => {
    const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    expect(listingState(tmp.db, listingId)).toMatchObject({
      shown: { freshness: 'none' },
      lastReadAt: null,
      consecutiveErrors: 0,
    });
    expect(listingState(tmp.db, 999)).toBeNull();
  });

  it('a price is current after a read and stale after a failed one, never refreshed by it', async () => {
    const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    const watchId = insertWatch(tmp.db, clock);
    follow(tmp.db, watchId, listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
    await readOnce(listingId, url, { price: 10_000 });
    const readAt = clock.iso();
    expect(listingState(tmp.db, listingId)?.shown).toEqual({
      freshness: 'current',
      price: { amountMinor: 10_000, currency: 'CAD' },
      asOf: readAt,
      availability: 'in',
    });
    await readOnce(listingId, url, { fail: 'server_error' });
    expect(listingState(tmp.db, listingId)).toMatchObject({
      shown: { freshness: 'stale', asOf: readAt, price: { amountMinor: 10_000 } },
      consecutiveErrors: 1,
      lastError: 'server_error',
      lastReadAt: clock.iso(),
    });
    expect(watchState(tmp.db, watchId)).toMatchObject({
      status: 'active',
      currency: 'CAD',
      reference: { price: { amountMinor: 10_000, currency: 'CAD' }, kind: 'median_verified' },
      best: { listingId, shown: { freshness: 'stale' } },
      lastAlert: { price_drop: null, restock: null },
    });
  });

  it('the last alert of each kind carries its delivery status, accepted after the outbox pass', async () => {
    const listingId = insertListing(tmp.db, clock, { storeId: insertStore(tmp.db) });
    const watchId = insertWatch(tmp.db, clock);
    follow(tmp.db, watchId, listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
    for (let i = 0; i < 4; i++) await readOnce(listingId, url, { price: 10_000 });
    await readOnce(listingId, url, { price: 9_500 });
    await readOnce(listingId, url, { price: 9_500 });
    const before = watchState(tmp.db, watchId);
    expect(before?.lastAlert.price_drop).toMatchObject({
      price: { amountMinor: 9_500, currency: 'CAD' },
      status: 'awaiting_delivery',
      gating: { stamp: null, status: 'awaiting_delivery' },
    });
    expect(before?.lastAccepted.price_drop).toBeNull();
    await runOutboxPass({
      db: tmp.db,
      secrets: createSecretBox(randomBytes(32)),
      now: clock.now,
      sleep: async () => {},
    });
    const after = watchState(tmp.db, watchId);
    expect(after?.lastAlert.price_drop).toMatchObject({
      status: 'accepted',
      gating: { stamp: { kind: 'price_cooldown', at: clock.iso() } },
    });
    expect(after?.lastAccepted.price_drop).toMatchObject({ acceptedAt: clock.iso() });
    expect(after?.listings[0]).toMatchObject({ confirmed: true, flags: [] });
  });
});
