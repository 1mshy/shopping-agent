// The composed runtime on a fake clock and a real SQLite file: the scheduler's sweep reads a
// watched listing through scripted reads, a confirmed drop records one event, and the outbox job
// accepts its in-app delivery. No network, no model.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRuntime, JOB_NAMES, type Runtime } from '../../src/runtime.ts';
import { createSecretBox } from '../../src/secrets/index.ts';
import { advanceBy, FakeClock, FakeTimers, flush } from '../scheduler/harness.ts';
import {
  CA,
  Clock,
  eventsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  observationsOf,
  Script,
  T0,
  TempDb,
  watchRow,
} from '../sweep/harness.ts';

const MIN = 60_000;

describe('createRuntime', () => {
  let tmp: TempDb;
  let clock: FakeClock;
  let timers: FakeTimers;
  let runtime: Runtime | undefined;

  beforeEach(() => {
    tmp = new TempDb();
    clock = new FakeClock(new Date(T0).toISOString());
    timers = new FakeTimers(clock);
  });
  afterEach(async () => {
    await runtime?.stop();
    runtime = undefined;
    tmp.dispose();
  });

  function build(script: Script, market: () => typeof CA | null = () => CA): Runtime {
    runtime = createRuntime({
      db: tmp.db,
      dataDir: tmp.dir,
      secrets: createSecretBox(new Uint8Array(32).fill(7)),
      market,
      robotsMode: () => 'ignore',
      now: clock.now,
      network: {
        open() {
          throw new Error('the network is not reachable in this test');
        },
      },
      scheduler: { timers, probe: async () => true },
      sweep: { readListing: script.read, endpointReaders: [], logger: () => {} },
      onError: (error, context) => {
        throw new Error(`${context}: ${String(error)}`);
      },
    });
    return runtime;
  }

  function watchedListing(): { listingId: number; watchId: number; url: string } {
    const seed = new Clock();
    seed.ms = clock.ms;
    const listingId = insertListing(tmp.db, seed, { storeId: insertStore(tmp.db) });
    const watchId = insertWatch(tmp.db, seed);
    follow(tmp.db, watchId, listingId);
    return { listingId, watchId, url: listingRow(tmp.db, listingId)?.urlCanonical as string };
  }

  it('registers the sweep, the outbox and the backup, and reports them', async () => {
    const rt = build(new Script());
    rt.start();
    await flush();
    expect(
      rt
        .jobs()
        .map((j) => j.name)
        .sort(),
    ).toEqual([...JOB_NAMES].sort());
    // Boot schedules a catch-up of every job: the backup job has written one copy.
    await advanceBy(clock, [timers], 2 * MIN);
    expect(existsSync(join(tmp.dir, 'backups'))).toBe(true);
    expect(readdirSync(join(tmp.dir, 'backups')).filter((f) => f.endsWith('.db'))).toHaveLength(1);
  });

  it('reads a watched listing on the schedule, alerts once on a confirmed drop and delivers it in-app', async () => {
    const { listingId, watchId, url } = watchedListing();
    // Six reads at 100.00 set the baseline; then the price drops 10% and stays there.
    const script = new Script().push(
      url,
      ...Array.from({ length: 6 }, () => ({ price: 10_000 })),
      { price: 9_000 },
      { price: 9_000 },
      { price: 9_000 },
    );
    const rt = build(script);
    rt.start();

    // The default interval is 30 minutes: nine reads need a little over four hours.
    await advanceBy(clock, [timers], 9 * 31 * MIN);

    const observations = observationsOf(tmp.db, listingId);
    expect(observations.map((o) => o.sticker)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 9_000, 9_000, 9_000,
    ]);
    expect(watchRow(tmp.db, watchId)?.currency).toBe('CAD');

    // One event, for the read that confirmed the drop; the third low read adds none.
    const events = eventsOf(tmp.db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'price_drop',
      watchId,
      listingId,
      observationId: observations[7]?.id,
    });

    // The outbox job delivered it through the in-app channel, the only one on this install.
    const deliveries = tmp.db.orm.select().from(schema.delivery).all();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ eventId: events[0]?.id, state: 'accepted' });
    expect(deliveries[0]?.acceptedAt).not.toBeNull();
  });

  it('reads nothing while no market is set, and refresh joins a sweep that is running', async () => {
    const { listingId, url } = watchedListing();
    const rt = build(new Script().push(url, { price: 10_000 }), () => null);
    rt.start();
    await advanceBy(clock, [timers], 5 * MIN);
    expect(observationsOf(tmp.db, listingId)).toHaveLength(0);

    const first = rt.refresh();
    const second = rt.refresh();
    expect(second.runId).toBe(first.runId);
    expect(second.joined).toBe(true);
    await flush();
  });
});
