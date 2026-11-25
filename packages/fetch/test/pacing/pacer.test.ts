// The pacer on a fake clock: one in flight per host, the jittered interval between starts, arrival
// order, the pool, deadlines, aborts, Retry-After and a stored next start that is absurdly far.
import { describe, expect, it } from 'vitest';
import {
  type Admission,
  createPacer,
  jitteredGap,
  MAX_HOST_PAUSE_MS,
  memoryPacingStore,
  type PacerDeps,
  type PacingSlot,
  type PacingStore,
} from '../../src/pacing/index.ts';
import { FakeClock, sequence } from './clock.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const HOUR = 3_600_000;

function setup(extra: Partial<PacerDeps> = {}) {
  const clock = new FakeClock(T0);
  const store = memoryPacingStore();
  const pacer = createPacer({
    store,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    ...extra,
  });
  return { clock, store, pacer };
}

const open = (deadline = T0 + HOUR, signal = new AbortController().signal) => ({
  deadline,
  signal,
});

/** Runs the fake clock until `pending` settles. */
async function drive<T>(clock: FakeClock, pending: Promise<T>): Promise<T> {
  await clock.runAll();
  return pending;
}

function slotOf(admission: Admission): PacingSlot {
  if (admission.kind !== 'granted') throw new Error(`expected a slot, got ${admission.kind}`);
  return admission.slot;
}

describe('jitteredGap', () => {
  it('is 2.5 s times a multiplier in 0.85-1.3', () => {
    expect(jitteredGap(() => 0)).toBe(2_125);
    expect(jitteredGap(() => 0.5)).toBe(2_688);
    expect(jitteredGap(() => 0.999_999)).toBe(3_250);
    for (let i = 0; i < 1_000; i++) {
      const gap = jitteredGap(Math.random);
      expect(gap).toBeGreaterThanOrEqual(2_125);
      expect(gap).toBeLessThanOrEqual(3_250);
    }
  });

  it('refuses a random source outside [0, 1)', () => {
    expect(() => jitteredGap(() => 1)).toThrow(RangeError);
    expect(() => jitteredGap(() => -0.1)).toThrow(RangeError);
    expect(() => jitteredGap(() => Number.NaN)).toThrow(RangeError);
  });
});

describe('createPacer', () => {
  it('starts a host with no row at once, and a start sets its next start', async () => {
    const { pacer, store, clock } = setup();
    const slot = slotOf(await pacer.acquire('shop.test', open()));
    expect(clock.now()).toBe(T0);
    expect(store.rows.get('shop.test')).toBeUndefined();
    slot.started();
    expect(store.rows.get('shop.test')).toBe(T0 + 2_688);
    slot.started();
    expect(store.rows.get('shop.test')).toBe(T0 + 2_688);
    slot.release();
    expect(pacer.nextStart('shop.test')).toBe(T0 + 2_688);
  });

  it('keeps one request in flight per host, even once the interval has passed', async () => {
    const { pacer, clock } = setup();
    const first = slotOf(await pacer.acquire('shop.test', open()));
    first.started();
    let second: Admission | undefined;
    void pacer.acquire('shop.test', open()).then((a) => {
      second = a;
    });
    await clock.advance(10_000);
    expect(second).toBeUndefined();
    first.release();
    await clock.flush();
    expect(second?.kind).toBe('granted');
    expect(clock.now()).toBe(T0 + 10_000);
  });

  it('spaces 50 concurrent requests by the jittered interval, in arrival order', async () => {
    const randoms = Array.from({ length: 50 }, (_, i) => (i * 0.37) % 1);
    const { pacer, clock } = setup({ random: sequence(randoms) });
    const starts: { index: number; at: number }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const all = Array.from({ length: 50 }, async (_, index) => {
      const slot = slotOf(await pacer.acquire('shop.test', open()));
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      starts.push({ index, at: clock.now() });
      slot.started();
      await clock.sleep(400, new AbortController().signal);
      inFlight--;
      slot.release();
    });
    await clock.runAll();
    await Promise.all(all);
    expect(starts.map((s) => s.index)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(maxInFlight).toBe(1);
    for (let i = 1; i < starts.length; i++) {
      const gap = (starts[i]?.at ?? 0) - (starts[i - 1]?.at ?? 0);
      expect(gap).toBe(jitteredGap(() => randoms[i - 1] ?? 0));
      expect(gap).toBeGreaterThanOrEqual(2_125);
    }
  });

  it('does not let one host wait on another', async () => {
    const { pacer, clock } = setup();
    const a = slotOf(await pacer.acquire('a.test', open()));
    a.started();
    const b = await pacer.acquire('b.test', open());
    expect(b.kind).toBe('granted');
    expect(clock.now()).toBe(T0);
  });

  it('bounds the hosts in flight with the pool, first come first served', async () => {
    const { pacer, clock } = setup({ maxHosts: 2 });
    const a = slotOf(await pacer.acquire('a.test', open()));
    slotOf(await pacer.acquire('b.test', open()));
    const order: string[] = [];
    void pacer.acquire('c.test', open()).then((x) => {
      order.push('c');
      slotOf(x).release();
    });
    void pacer.acquire('d.test', open()).then((x) => {
      order.push('d');
      slotOf(x).release();
    });
    await clock.advance(5_000);
    expect(order).toEqual([]);
    a.release();
    await clock.flush();
    expect(order).toEqual(['c', 'd']);
  });

  it('leaves the next start alone when the request never reached the network', async () => {
    const { pacer, store, clock } = setup();
    slotOf(await pacer.acquire('shop.test', open())).release();
    expect(store.rows.size).toBe(0);
    slotOf(await pacer.acquire('shop.test', open())).release();
    expect(clock.now()).toBe(T0);
  });

  it('refuses at once a request whose host opens only at or after its deadline', async () => {
    const { pacer, store, clock } = setup();
    store.write('shop.test', T0 + 5_000);
    expect(await pacer.acquire('shop.test', open(T0 + 5_000))).toEqual({
      kind: 'closed',
      until: T0 + 5_000,
    });
    expect(clock.pending).toBe(0);
    expect(clock.now()).toBe(T0);
    const slot = slotOf(await drive(clock, pacer.acquire('shop.test', open(T0 + 5_001))));
    expect(clock.now()).toBe(T0 + 5_000);
    slot.release();
  });

  it('gives up a queued request at its deadline, and the queue goes on', async () => {
    const { pacer, clock } = setup();
    const first = slotOf(await pacer.acquire('shop.test', open()));
    first.started();
    const results: Admission[] = [];
    void pacer.acquire('shop.test', open(T0 + 1_000)).then((a) => results.push(a));
    let third: Admission | undefined;
    void pacer.acquire('shop.test', open()).then((a) => {
      third = a;
    });
    await clock.advance(1_000);
    expect(results).toEqual([{ kind: 'closed', until: T0 + 2_688 }]);
    first.release();
    await clock.runAll();
    expect(third?.kind).toBe('granted');
    expect(clock.now()).toBe(T0 + 2_688);
  });

  it('gives up on abort, while queued and while waiting for the next start', async () => {
    const { pacer, store, clock } = setup();
    const first = slotOf(await pacer.acquire('shop.test', open()));
    first.started();
    const queued = new AbortController();
    let a: Admission | undefined;
    void pacer.acquire('shop.test', open(T0 + HOUR, queued.signal)).then((x) => {
      a = x;
    });
    await clock.flush();
    queued.abort();
    await clock.flush();
    expect(a).toEqual({ kind: 'aborted' });
    first.release();

    const waiting = new AbortController();
    let b: Admission | undefined;
    void pacer.acquire('shop.test', open(T0 + HOUR, waiting.signal)).then((x) => {
      b = x;
    });
    await clock.advance(1_000);
    waiting.abort();
    await clock.flush();
    expect(b).toEqual({ kind: 'aborted' });
    expect(clock.pending).toBe(0);
    expect(store.rows.get('shop.test')).toBe(T0 + 2_688);
    expect(await pacer.acquire('shop.test', open(T0, AbortSignal.abort()))).toEqual({
      kind: 'aborted',
    });
  });

  it('pushes the next start to the later of the interval and a Retry-After, bounded', async () => {
    const { pacer, store } = setup();
    const slot = slotOf(await pacer.acquire('shop.test', open()));
    slot.started();
    slot.pause(1_000);
    expect(store.rows.get('shop.test')).toBe(T0 + 2_688);
    slot.pause(30_000);
    expect(store.rows.get('shop.test')).toBe(T0 + 30_000);
    slot.pause(10 * HOUR);
    expect(store.rows.get('shop.test')).toBe(T0 + MAX_HOST_PAUSE_MS);
    slot.release();
  });

  it('bounds a stored next start absurdly far ahead, and writes the bound back', async () => {
    const { pacer, store, clock } = setup();
    store.write('shop.test', T0 + 10 * 365 * 24 * HOUR);
    expect(pacer.nextStart('shop.test')).toBe(T0 + MAX_HOST_PAUSE_MS);
    expect(store.rows.get('shop.test')).toBe(T0 + MAX_HOST_PAUSE_MS);
    const slot = slotOf(await drive(clock, pacer.acquire('shop.test', open(T0 + 2 * HOUR))));
    expect(clock.now()).toBe(T0 + MAX_HOST_PAUSE_MS);
    slot.release();
  });

  it('waits for the stored next start after a restart (a new pacer on the same store)', async () => {
    const { pacer, store, clock } = setup();
    const slot = slotOf(await pacer.acquire('shop.test', open()));
    slot.started();
    slot.release();
    const restarted = createPacer({
      store,
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0,
    });
    let granted: Admission | undefined;
    void restarted.acquire('shop.test', open()).then((a) => {
      granted = a;
    });
    await clock.advance(2_687);
    expect(granted).toBeUndefined();
    await clock.advance(1);
    expect(granted?.kind).toBe('granted');
  });

  it('keeps pacing in memory when a store write fails, and reports it', async () => {
    const memory = memoryPacingStore();
    const errors: unknown[] = [];
    const failing: PacingStore = {
      read: (host) => memory.read(host),
      write: () => {
        throw new Error('disk full');
      },
    };
    const { pacer, clock } = setup({ store: failing, onStoreError: (e) => errors.push(e) });
    const slot = slotOf(await pacer.acquire('shop.test', open()));
    expect(() => slot.started()).not.toThrow();
    slot.release();
    expect(errors).toHaveLength(1);
    slotOf(await drive(clock, pacer.acquire('shop.test', open()))).release();
    expect(clock.now()).toBe(T0 + 2_688);
  });

  it('hands the host back when the store cannot be read while it holds the turn', async () => {
    let reads = 0;
    const memory = memoryPacingStore();
    const flaky: PacingStore = {
      read: (host) => {
        reads++;
        // The first read is the early check; the second is made holding the host's turn.
        if (reads === 2) throw new Error('database is locked');
        return memory.read(host);
      },
      write: (host, at) => memory.write(host, at),
    };
    const { pacer } = setup({ store: flaky });
    await expect(pacer.acquire('shop.test', open())).rejects.toThrow('database is locked');
    expect((await pacer.acquire('shop.test', open())).kind).toBe('granted');
  });
});
