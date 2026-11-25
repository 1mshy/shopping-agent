// The sweep run and job: due listings, counts per outcome kind, bounded concurrency, incremental
// writes, abort.
import { ABORT_CODE } from '@agentic-dasher/fetch';
import type { ListingReadResult, ReadRequest } from '@agentic-dasher/sources';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSweep, sweepJob } from '../../src/sweep/index.ts';
import {
  Clock,
  checkRow,
  depsOf,
  follow,
  insertListing,
  insertStore,
  insertWatch,
  listingRow,
  MIN,
  observationsOf,
  resultOf,
  Script,
  TempDb,
} from './harness.ts';

let tmp: TempDb;
let clock: Clock;

beforeEach(() => {
  tmp = new TempDb();
  clock = new Clock();
});
afterEach(() => tmp.dispose());

/** n listings at n stores, each followed by its own active watch. */
function listings(n: number): { id: number; url: string }[] {
  const out = [];
  for (let i = 0; i < n; i++) {
    const storeId = insertStore(tmp.db);
    const id = insertListing(tmp.db, clock, { storeId });
    follow(tmp.db, insertWatch(tmp.db, clock), id);
    out.push({ id, url: listingRow(tmp.db, id)?.urlCanonical as string });
  }
  return out;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runSweep', () => {
  it('checks the due listings and counts each outcome kind', async () => {
    const [a, b, c, d] = listings(4);
    const script = new Script()
      .push(a?.url as string, { price: 10_000 })
      .push(b?.url as string, { fail: 'wall' })
      .push(c?.url as string, { fail: 'no_price' })
      .push(d?.url as string, { fail: 'not_found' });
    // A listing whose only watch is archived: not checked, its next_check_at cleared.
    const storeId = insertStore(tmp.db);
    const orphan = insertListing(tmp.db, clock, { storeId });
    follow(tmp.db, insertWatch(tmp.db, clock, { archived: true }), orphan);
    const reports: Record<string, unknown>[] = [];
    const counts = await runSweep(depsOf(tmp, clock, script.read), {
      report: (p) => reports.push(p),
    });
    expect(counts).toMatchObject({
      checked: 4,
      alertsRecorded: 0,
      errors: 0,
      untracked: 1,
      leftDue: 0,
    });
    expect(counts.outcomes).toMatchObject({
      read: 1,
      wall: 1,
      no_price: 1,
      not_found: 1,
      aborted: 0,
    });
    expect(checkRow(tmp.db, orphan)?.nextCheckAt).toBeNull();
    expect(script.calls).not.toContain(listingRow(tmp.db, orphan)?.urlCanonical);
    expect(reports.length).toBeGreaterThanOrEqual(4);
    // Not due again until their next check.
    const again = await runSweep(depsOf(tmp, clock, script.read));
    expect(again.checked).toBe(0);
  });

  it('bounded concurrency, and a slow store does not delay another store’s row', async () => {
    const all = listings(5);
    const slow = all[0] as { id: number; url: string };
    const gate = deferred<void>();
    let inFlight = 0;
    let most = 0;
    let seenWhileSlow = -1;
    const read = async (request: ReadRequest): Promise<ListingReadResult> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      try {
        if (request.url === slow.url) {
          await gate.promise;
        } else {
          await new Promise((r) => setTimeout(r, 5));
        }
        return resultOf({ price: 10_000 });
      } finally {
        inFlight -= 1;
      }
    };
    const run = runSweep(depsOf(tmp, clock, read), { concurrency: 2 });
    // Wait until every fast listing has its observation while the slow one is still reading.
    for (let i = 0; i < 200; i++) {
      const fast = all.slice(1).every((l) => observationsOf(tmp.db, l.id).length === 1);
      if (fast) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    seenWhileSlow = all.slice(1).filter((l) => observationsOf(tmp.db, l.id).length === 1).length;
    expect(observationsOf(tmp.db, slow.id)).toHaveLength(0);
    gate.resolve();
    const counts = await run;
    expect(seenWhileSlow).toBe(4);
    expect(most).toBe(2);
    expect(counts.outcomes.read).toBe(5);
  });

  it('stops cleanly on abort, leaving unchecked listings due', async () => {
    const all = listings(3);
    const controller = new AbortController();
    const started = deferred<void>();
    const read = async (_request: ReadRequest): Promise<ListingReadResult> => {
      started.resolve();
      await new Promise<void>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve()),
      );
      return {
        kind: 'failed',
        reason: 'fetch_failed',
        detail: 'aborted',
        fetch: { kind: 'network_error', rung: 'http', code: ABORT_CODE },
        methods: [],
        candidates: [],
      };
    };
    const run = runSweep(depsOf(tmp, clock, read), { concurrency: 1, signal: controller.signal });
    await started.promise;
    controller.abort();
    const counts = await run;
    expect(counts).toMatchObject({ checked: 1, leftDue: 3 });
    expect(counts.outcomes.aborted).toBe(1);
    for (const l of all) {
      expect(observationsOf(tmp.db, l.id)).toHaveLength(0);
      expect(listingRow(tmp.db, l.id)?.consecutiveErrors).toBe(0);
      expect(checkRow(tmp.db, l.id)).toMatchObject({ lastReadAt: null, lastError: null });
    }
  });

  it('counts the alerts its evaluations recorded', async () => {
    const [l] = listings(1);
    const url = l?.url as string;
    const script = new Script().push(
      url,
      { price: 10_000 },
      { price: 10_000 },
      { price: 10_000 },
      { price: 10_000 },
      { price: 9_500 },
      { price: 9_500 },
    );
    const total = { alerts: 0 };
    for (let i = 0; i < 6; i++) {
      const counts = await runSweep(depsOf(tmp, clock, script.read));
      total.alerts += counts.alertsRecorded;
      clock.advance(30 * MIN);
    }
    expect(total.alerts).toBe(1);
  });
});

describe('sweepJob', () => {
  it('is a minutely, network-gated job that returns the counts', async () => {
    const job = sweepJob(depsOf(tmp, clock, new Script().read));
    expect(job).toMatchObject({ name: 'sweep', cron: '* * * * *', networkGate: true });
    expect(job.deadlineMs).toBeGreaterThan(0);
    const detail = await job.handler({
      signal: new AbortController().signal,
      runId: 1,
      reason: 'slot',
      coalescedSlots: 1,
      startedAt: clock.iso(),
      report: () => {},
    });
    expect(detail).toMatchObject({ checked: 0, leftDue: 0 });
  });
});
