// checkListing and the alert evaluation after each read, on a real SQLite file with scripted reads.
import { schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODE_ONLY_VERSIONS } from '../../src/sweep/identity.ts';
import { checkListing, evaluateObservation } from '../../src/sweep/index.ts';
import type { SweepLogRecord } from '../../src/sweep/log.ts';
import {
  CA,
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
  resultOf,
  Script,
  type Scripted,
  storeRow,
  TempDb,
  watchRow,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;
let script: Script;
let logs: SweepLogRecord[];

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
  script = new Script();
  logs = [];
});
afterEach(() => tmp.dispose());

const deps = () => depsOf(tmp, clock, script.read, logs);

/** One listing at one store, followed by one watch (added by the user unless said otherwise). */
function setup(
  options: {
    rules?: Record<string, unknown>;
    restock?: boolean;
    addedBy?: 'user' | 'discovery';
  } = {},
) {
  const storeId = insertStore(tmp.db);
  const listingId = insertListing(tmp.db, clock, { storeId });
  const watchId = insertWatch(tmp.db, clock, {
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.restock ? { restock: true } : {}),
  });
  follow(tmp.db, watchId, listingId, options.addedBy ?? 'user');
  const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
  return { storeId, listingId, watchId, url };
}

/** Reads the listing once per step, 30 minutes apart (forced: the schedule has its own test). */
async function reads(listingId: number, url: string, ...steps: Scripted[]) {
  const out = [];
  for (const step of steps) {
    clock.advance(30 * MIN);
    script.push(url, step);
    out.push(await checkListing(deps(), listingId, { force: true }));
  }
  return out;
}

const BASE: Scripted = { price: 10_000 };
const LOW: Scripted = { price: 9_500 };

describe('a read that produced a listing read', () => {
  it('first read: writes the observation, adopts currency and reference, fires nothing', async () => {
    const { listingId, watchId, url, storeId } = setup();
    const [r] = await reads(listingId, url, BASE);
    expect(r?.outcome.kind).toBe('read');
    const obs = observationsOf(tmp.db, listingId);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      currency: 'CAD',
      sticker: 10_000,
      effective: 10_000,
      readPath: 'platform_json',
    });
    expect(listingRow(tmp.db, listingId)).toMatchObject({
      currency: 'CAD',
      consecutiveErrors: 0,
      lastSeenAt: clock.iso(),
    });
    expect(checkRow(tmp.db, listingId)).toMatchObject({
      lastReadAt: clock.iso(),
      lastError: null,
      firstErrorAt: null,
      nextCheckAt: new Date(clock.ms + 30 * MIN).toISOString(),
    });
    expect(storeRow(tmp.db, storeId)).toMatchObject({
      consecutiveErrors: 0,
      lastOkAt: clock.iso(),
      readRoute: 'platform_json',
    });
    expect(watchRow(tmp.db, watchId)).toMatchObject({
      currency: 'CAD',
      referencePrice: 10_000,
      referenceKind: 'median_verified',
    });
    expect(eventsOf(tmp.db)).toHaveLength(0);
  });

  it('a 5% drop read twice on the same path fires once, naming the confirming observation', async () => {
    const { listingId, watchId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE);
    const [first, second, third] = await reads(listingId, url, LOW, LOW, LOW);
    expect(first?.outcome.kind === 'read' && first.outcome.evaluations[0]?.price?.silence).toBe(
      'awaiting_confirmation',
    );
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    const confirming = second?.outcome.kind === 'read' ? second.outcome.observationId : -1;
    expect(events[0]).toMatchObject({
      kind: 'price_drop',
      watchId,
      listingId,
      observationId: confirming,
      key: `price_drop:watch:${watchId}:observation:${confirming}`,
    });
    // The third low read: the first alert is still awaiting delivery and this is not lower.
    expect(third?.outcome.kind === 'read' && third.outcome.evaluations[0]?.price?.silence).toBe(
      'awaiting_delivery',
    );
    // The reference held at the median of the recent reads.
    expect(watchRow(tmp.db, watchId)?.referencePrice).toBe(10_000);
  });

  it('evaluating the same observation again records no second event', async () => {
    const { listingId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW);
    const [second] = await reads(listingId, url, LOW);
    const observationId = second?.outcome.kind === 'read' ? second.outcome.observationId : -1;
    const ctx = {
      db: tmp.db,
      now: clock.now,
      market: CA,
      versions: CODE_ONLY_VERSIONS,
      log: () => {},
    };
    const again = evaluateObservation(ctx, { listingId, observationId, failedBeforeAt: null });
    expect(again[0]?.price).toMatchObject({ fired: true, created: false });
    expect(eventsOf(tmp.db)).toHaveLength(1);
  });

  it('the same drop on another read path the second time does not fire', async () => {
    const { listingId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW);
    const [r] = await reads(listingId, url, { price: 9_500, path: 'json_ld' });
    expect(r?.outcome.kind === 'read' && r.outcome.evaluations[0]?.price?.silence).toBe(
      'awaiting_confirmation',
    );
    expect(eventsOf(tmp.db)).toHaveLength(0);
  });

  it('a target reached fires on one read', async () => {
    const { listingId, url } = setup({
      rules: { dropBasisPoints: null, targetPrice: { amountMinor: 9_000, currency: 'CAD' } },
    });
    await reads(listingId, url, BASE, { price: 9_000 });
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('price_drop');
  });

  it('out→in fires a restock once; a first sighting in stock does not', async () => {
    const { listingId, url } = setup({ restock: true });
    const [first] = await reads(listingId, url, BASE);
    expect(first?.outcome.kind === 'read' && first.outcome.evaluations[0]?.restock?.silence).toBe(
      'first_sighting',
    );
    await reads(listingId, url, { price: null, availability: 'out' });
    expect(eventsOf(tmp.db)).toHaveLength(0);
    const [back, again] = await reads(listingId, url, BASE, BASE);
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'restock',
      observationId: back?.outcome.kind === 'read' ? back.outcome.observationId : -1,
    });
    // The same transition is already in the audit trail, whatever its delivery state (finding 6).
    expect(again?.outcome.kind === 'read' && again.outcome.evaluations[0]?.restock?.silence).toBe(
      'already_told',
    );
  });

  it('an unconfirmed discovery listing never alerts', async () => {
    const { listingId, watchId, url } = setup({ addedBy: 'discovery' });
    const out = await reads(listingId, url, BASE, BASE, BASE, BASE, LOW, LOW, LOW);
    expect(eventsOf(tmp.db)).toHaveLength(0);
    const last = out.at(-1);
    expect(last?.outcome.kind === 'read' && last.outcome.evaluations[0]).toMatchObject({
      price: { silence: 'unconfirmed_listing' },
      flags: ['unconfirmed'],
    });
    // Nor does it set the watch's currency or reference.
    expect(watchRow(tmp.db, watchId)).toMatchObject({ currency: null, referencePrice: null });
  });

  it('a person marking a verdict is not needed for a pasted link, but a blocked store never alerts', async () => {
    const { listingId, storeId, url } = setup();
    tmp.db.orm
      .update(schema.store)
      .set({ trustTier: 'blocked' })
      .where(eq(schema.store.id, storeId))
      .run();
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW, LOW);
    expect(eventsOf(tmp.db)).toHaveLength(0);
  });

  it('a paused or archived watch is never evaluated; an active one beside it is, independently', async () => {
    const storeId = insertStore(tmp.db);
    const listingId = insertListing(tmp.db, clock, { storeId });
    const active = insertWatch(tmp.db, clock);
    const paused = insertWatch(tmp.db, clock, { paused: true });
    const archived = insertWatch(tmp.db, clock, { archived: true });
    for (const w of [active, paused, archived]) follow(tmp.db, w, listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
    const out = await reads(listingId, url, BASE, BASE, BASE, BASE, LOW, LOW);
    expect(out.at(-1)?.outcome.kind === 'read' && out.at(-1)?.outcome).toBeTruthy();
    const events = eventsOf(tmp.db);
    expect(events.map((e) => e.watchId)).toEqual([active]);
    for (const w of [paused, archived]) {
      expect(watchRow(tmp.db, w)).toMatchObject({ currency: null, referencePrice: null });
    }
  });

  it('two active watches on one listing are evaluated independently', async () => {
    const storeId = insertStore(tmp.db);
    const listingId = insertListing(tmp.db, clock, { storeId });
    const drop = insertWatch(tmp.db, clock);
    const target = insertWatch(tmp.db, clock, {
      rules: { dropBasisPoints: null, targetPrice: { amountMinor: 8_000, currency: 'CAD' } },
    });
    follow(tmp.db, drop, listingId);
    follow(tmp.db, target, listingId);
    const url = listingRow(tmp.db, listingId)?.urlCanonical as string;
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW, LOW);
    expect(eventsOf(tmp.db).map((e) => e.watchId)).toEqual([drop]);
    await reads(listingId, url, { price: 8_000 });
    // The drop watch: 80.00 is below its pending alert's 95.00, so a further drop is recorded.
    expect(eventsOf(tmp.db).map((e) => e.watchId)).toEqual([drop, drop, target]);
  });

  it('a read in another currency than the listing adopted is stored but never compared', async () => {
    const { listingId, watchId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE);
    // Two USD reads of a CAD listing, 10% under its CAD price.
    const usd = async () => {
      const r = resultOf({ price: 9_000 });
      return r.kind === 'read' ? { ...r, read: { ...r.read, currency: 'USD' as const } } : r;
    };
    for (let i = 0; i < 2; i++) {
      clock.advance(30 * MIN);
      await checkListing({ ...deps(), readListing: usd }, listingId, { force: true });
    }
    expect(observationsOf(tmp.db, listingId).map((o) => o.currency)).toEqual([
      'CAD',
      'CAD',
      'CAD',
      'CAD',
      'USD',
      'USD',
    ]);
    expect(listingRow(tmp.db, listingId)?.currency).toBe('CAD');
    expect(watchRow(tmp.db, watchId)).toMatchObject({ currency: 'CAD', referencePrice: 10_000 });
    expect(eventsOf(tmp.db)).toHaveLength(0);
    expect(logs.filter((l) => l.event === 'currency_differs')).toHaveLength(2);
  });
});

describe('a failed read', () => {
  it('writes no observation, counts the error, keeps the price, backs off and logs its candidates', async () => {
    const { listingId, watchId, url, storeId } = setup();
    await reads(listingId, url, BASE);
    const before = watchRow(tmp.db, watchId);
    const [r] = await reads(listingId, url, { fail: 'no_price' });
    expect(r?.outcome).toMatchObject({ kind: 'failed', cause: 'no_price' });
    expect(observationsOf(tmp.db, listingId)).toHaveLength(1);
    expect(listingRow(tmp.db, listingId)?.consecutiveErrors).toBe(1);
    expect(checkRow(tmp.db, listingId)).toMatchObject({
      lastReadAt: clock.iso(),
      firstErrorAt: clock.iso(),
      lastError: 'no_price',
      nextCheckAt: new Date(clock.ms + 30 * MIN).toISOString(),
    });
    expect(storeRow(tmp.db, storeId)).toMatchObject({
      consecutiveErrors: 1,
      lastError: 'no_price',
    });
    expect(watchRow(tmp.db, watchId)).toEqual(before);
    const record = logs.find((l) => l.event === 'failed_read');
    expect(record).toMatchObject({
      listingId,
      cause: 'no_price',
      reason: 'no_price',
      candidates: [{ method: 'json_ld', confidence: 0.2, value: 'call for price' }],
    });
    const firstErrorAt = clock.iso();
    const [w] = await reads(listingId, url, { fail: 'wall' });
    expect(w?.outcome).toMatchObject({ kind: 'failed', cause: 'wall' });
    expect(checkRow(tmp.db, listingId)).toMatchObject({
      firstErrorAt,
      lastError: 'wall',
      nextCheckAt: new Date(clock.ms + 60 * MIN).toISOString(),
    });
    // An observed read clears the run of errors.
    await reads(listingId, url, BASE);
    expect(checkRow(tmp.db, listingId)).toMatchObject({ firstErrorAt: null, lastError: null });
    expect(listingRow(tmp.db, listingId)?.consecutiveErrors).toBe(0);
  });

  it('a failed read between two low reads confirms nothing', async () => {
    const { listingId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE);
    const out = await reads(listingId, url, LOW, { fail: 'server_error' }, LOW);
    expect(eventsOf(tmp.db)).toHaveLength(0);
    const last = out[2];
    expect(last?.outcome.kind === 'read' && last.outcome.evaluations[0]?.price?.silence).toBe(
      'awaiting_confirmation',
    );
  });

  it('a stale low price and a store that goes down: no alert, ever', async () => {
    const { listingId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW);
    await reads(
      listingId,
      url,
      { fail: 'network_error' },
      { fail: 'server_error' },
      { fail: 'wall' },
      { fail: 'not_found' },
    );
    expect(eventsOf(tmp.db)).toHaveLength(0);
    expect(observationsOf(tmp.db, listingId)).toHaveLength(5);
  });

  it('3+ errors over a day queue re-discovery, at most daily', async () => {
    const { listingId, watchId, url } = setup();
    tmp.db.orm
      .update(schema.watch)
      .set({ lookupQueuedAt: new Date(clock.ms - 48 * 60 * MIN).toISOString() })
      .where(eq(schema.watch.id, watchId))
      .run();
    const fail = (): Scripted => ({ fail: 'server_error' });
    const [a, b] = await reads(listingId, url, fail(), fail());
    expect(a?.outcome.kind === 'failed' && a.outcome.rediscoveryQueued).toEqual([]);
    expect(b?.outcome.kind === 'failed' && b.outcome.rediscoveryQueued).toEqual([]);
    clock.advance(24 * 60 * MIN);
    const [c] = await reads(listingId, url, fail());
    expect(c?.outcome.kind === 'failed' && c.outcome.rediscoveryQueued).toEqual([watchId]);
    expect(watchRow(tmp.db, watchId)).toMatchObject({
      lookupState: 'queued',
      lookupQueuedAt: clock.iso(),
      lookupDueAt: clock.iso(),
    });
    // The lookup unit marks it done; the next errors within a day do not queue it again.
    tmp.db.orm
      .update(schema.watch)
      .set({ lookupState: 'done', lookupDueAt: null })
      .where(eq(schema.watch.id, watchId))
      .run();
    const [d] = await reads(listingId, url, fail());
    expect(d?.outcome.kind === 'failed' && d.outcome.rediscoveryQueued).toEqual([]);
  });
});

describe('scheduling and guards', () => {
  it('with no market set the check does not run', async () => {
    const { listingId } = setup();
    const r = await checkListing({ ...deps(), market: () => null }, listingId);
    expect(r.outcome).toEqual({ kind: 'skipped', why: 'no_market' });
    expect(script.calls).toHaveLength(0);
  });

  it('a listing is read only when due, and a listing no active watch tracks has next_check_at cleared', async () => {
    const { listingId, watchId, url } = setup();
    script.push(url, BASE);
    expect((await checkListing(deps(), listingId)).outcome.kind).toBe('read');
    expect((await checkListing(deps(), listingId)).outcome).toEqual({
      kind: 'skipped',
      why: 'not_due',
    });
    clock.advance(30 * MIN);
    tmp.db.orm
      .update(schema.watch)
      .set({ pausedAt: clock.iso() })
      .where(eq(schema.watch.id, watchId))
      .run();
    expect((await checkListing(deps(), listingId)).outcome).toEqual({
      kind: 'skipped',
      why: 'not_tracked',
    });
    expect(checkRow(tmp.db, listingId)?.nextCheckAt).toBeNull();
  });

  it('the check interval setting is floored at 5 minutes', async () => {
    const { listingId, url } = setup();
    script.push(url, BASE);
    await checkListing({ ...deps(), checkIntervalMs: () => 60_000 }, listingId);
    expect(checkRow(tmp.db, listingId)?.nextCheckAt).toBe(
      new Date(clock.ms + 5 * MIN).toISOString(),
    );
  });

  it('a host that is closed is not asked again before it opens; nothing else changes', async () => {
    const { listingId, url } = setup();
    const opens = clock.ms + 3 * 60 * MIN;
    const closed = async (
      _req: unknown,
      _r: unknown,
      context: { get: (r: { url: string; rung: 'http' }) => Promise<unknown> },
    ) => {
      await context.get({ url, rung: 'http' });
      return {
        kind: 'failed' as const,
        reason: 'fetch_failed' as const,
        detail: 'closed',
        fetch: {
          kind: 'refused_by_policy' as const,
          rung: 'http' as const,
          reason: 'host_limit' as const,
        },
        methods: [],
        candidates: [],
      };
    };
    const fetcher = {
      get: async () => ({
        outcome: {
          kind: 'refused_by_policy' as const,
          rung: 'http' as const,
          reason: 'host_limit' as const,
        },
        response: null,
        robots: null,
        closedUntil: opens,
      }),
    };
    const r = await checkListing({ ...deps(), fetcher, readListing: closed as never }, listingId);
    expect(r.outcome).toMatchObject({
      kind: 'deferred',
      reason: 'host_closed',
      nextCheckAt: new Date(opens).toISOString(),
    });
    expect(listingRow(tmp.db, listingId)?.consecutiveErrors).toBe(0);
    expect(checkRow(tmp.db, listingId)).toMatchObject({ lastReadAt: null, lastError: null });
  });
});

describe('a crash between the observation insert and the evaluation', () => {
  it('the next check evaluates the observation it left, and records its alert once', async () => {
    const { listingId, url } = setup();
    await reads(listingId, url, BASE, BASE, BASE, BASE, LOW);
    clock.advance(30 * MIN);
    script.push(url, LOW);
    let crashedOn = -1;
    const crashing = {
      ...deps(),
      hooks: {
        afterObservationWritten: (id: number) => {
          crashedOn = id;
          throw new Error('process died');
        },
      },
    };
    await expect(checkListing(crashing, listingId, { force: true })).rejects.toThrow(
      'process died',
    );
    expect(eventsOf(tmp.db)).toHaveLength(0);
    // Restart: the next check resumes the evaluation before reading again.
    const [next] = await reads(listingId, url, LOW);
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]?.observationId).toBe(crashedOn);
    expect(next?.resumed[0]?.price).toMatchObject({ fired: true, created: true });
    expect(logs.some((l) => l.event === 'resumed_evaluation')).toBe(true);
  });
});
