// The scheduler runner against a real SQLite file and a fake clock: registration and the boot
// catch-up, slots on time, joining, failures, the deadline, one-off jobs, stop() and health.
import type { Database } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScheduler,
  type Scheduler,
  type SchedulerOptions,
} from '../../src/scheduler/index.ts';
import {
  abortableHandler,
  advanceBy,
  advanceTo,
  at,
  FakeClock,
  FakeTimers,
  flush,
  heldHandler,
  jobOf,
  ms,
  openRunsOf,
  quickHandler,
  runsOf,
  tempDatabase,
} from './harness.ts';

let temp: ReturnType<typeof tempDatabase>;
let db: Database;
let clock: FakeClock;
let timers: FakeTimers;
let errors: unknown[];
let scheduler: Scheduler | undefined;

beforeEach(() => {
  temp = tempDatabase();
  db = temp.open();
  clock = new FakeClock(at('09:47:00'));
  timers = new FakeTimers(clock);
  errors = [];
  scheduler = undefined;
});

afterEach(async () => {
  if (scheduler) {
    const stopping = scheduler.stop();
    await advanceBy(clock, [timers], 10_000);
    await stopping;
  }
  temp.cleanup();
  expect(errors).toEqual([]);
});

function make(extra: Partial<SchedulerOptions> = {}): Scheduler {
  scheduler = createScheduler({
    db,
    now: clock.now,
    timers,
    probe: async () => true,
    onError: (error) => errors.push(error),
    ...extra,
  });
  return scheduler;
}

describe('registration and boot', () => {
  it('upserts the jobs and runs one boot catch-up per cadence, keeping the grid', async () => {
    const sweep = quickHandler();
    const daily = quickHandler();
    const once = quickHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: sweep.handler,
    });
    s.register({
      name: 'daily',
      cron: '40 7 * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: daily.handler,
    });
    s.register({
      name: 'once',
      at: at('15:00:00'),
      deadlineMs: 60_000,
      networkGate: false,
      handler: once.handler,
    });
    s.start();
    await flush();

    expect(jobOf(db, 'sweep')).toMatchObject({
      cron: '*/30 * * * *',
      nextRunAt: at('10:00:00'),
      deadlineMs: 900_000,
      networkGate: false,
      retryAt: null,
    });
    expect(jobOf(db, 'daily')).toMatchObject({
      nextRunAt: at('07:40:00', '18'),
      networkGate: true,
    });
    expect(jobOf(db, 'once')).toMatchObject({ cron: null, nextRunAt: at('15:00:00') });

    for (const name of ['sweep', 'daily']) {
      expect(runsOf(db, name)).toEqual([
        expect.objectContaining({
          status: 'completed',
          reason: 'boot',
          coalescedSlots: 0,
          startedAt: at('09:47:00'),
          endedAt: at('09:47:00'),
          detail: { reason: 'boot', slots: 0 },
        }),
      ]);
    }
    // A one-off job runs at its time, not at every start.
    expect(runsOf(db, 'once')).toEqual([]);
  });

  it('refuses a bad job definition', () => {
    const s = make();
    const handler = async () => undefined;
    expect(() =>
      s.register({ name: 'x', cron: 'nope', deadlineMs: 1, networkGate: false, handler }),
    ).toThrow();
    expect(() => s.register({ name: 'x', deadlineMs: 1, networkGate: false, handler })).toThrow(
      /exactly one/,
    );
    expect(() =>
      s.register({
        name: 'x',
        at: '2026-11-17T10:00:00Z',
        deadlineMs: 1,
        networkGate: false,
        handler,
      }),
    ).toThrow(/milliseconds/);
    expect(() =>
      s.register({ name: 'x', cron: '* * * * *', deadlineMs: 0, networkGate: false, handler }),
    ).toThrow(RangeError);
    s.register({ name: 'x', cron: '* * * * *', deadlineMs: 1, networkGate: false, handler });
    expect(() =>
      s.register({ name: 'x', cron: '* * * * *', deadlineMs: 1, networkGate: false, handler }),
    ).toThrow(/twice/);
    s.start();
    expect(() =>
      s.register({ name: 'y', cron: '* * * * *', deadlineMs: 1, networkGate: false, handler }),
    ).toThrow(/before start/);
  });
});

describe('slots', () => {
  it('runs each slot once on time and never sleeps longer than maxSleepMs', async () => {
    const sweep = quickHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: sweep.handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('11:10:00')));

    expect(runsOf(db, 'sweep').map((r) => [r.reason, r.coalescedSlots, r.startedAt])).toEqual([
      ['boot', 0, at('09:47:00')],
      ['slot', 1, at('10:00:00')],
      ['slot', 1, at('10:30:00')],
      ['slot', 1, at('11:00:00')],
    ]);
    expect(jobOf(db, 'sweep').nextRunAt).toBe(at('11:30:00'));
    expect(Math.max(...timers.delays)).toBeLessThanOrEqual(30_000);
  });

  it('a timer that fires early, before its slot, runs nothing', async () => {
    const sweep = quickHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: sweep.handler,
    });
    s.start();
    await flush();
    clock.set(at('09:59:59'));
    timers.fireAll();
    s.wake();
    await flush();
    expect(runsOf(db, 'sweep')).toHaveLength(1);
    expect(jobOf(db, 'sweep').nextRunAt).toBe(at('10:00:00'));
  });

  it('a slot that comes due while the job runs waits for the run, then runs once', async () => {
    const sweep = heldHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 3_600_000,
      networkGate: false,
      handler: sweep.handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('10:40:00')));
    // The boot run holds the lock across the 10:00 and 10:30 slots: no second run started.
    expect(runsOf(db, 'sweep')).toHaveLength(1);
    expect(jobOf(db, 'sweep').nextRunAt).toBe(at('10:00:00'));
    sweep.resolve(0, { done: true });
    await flush();
    expect(
      runsOf(db, 'sweep').map((r) => [r.status, r.reason, r.coalescedSlots, r.startedAt]),
    ).toEqual([
      ['completed', 'boot', 0, at('09:47:00')],
      ['running', 'slot', 2, at('10:40:00')],
    ]);
    expect(jobOf(db, 'sweep').nextRunAt).toBe(at('11:00:00'));
  });
});

describe('callers', () => {
  it('a second caller of a running job joins it: one run, one promise, one result', async () => {
    const refresh = heldHandler();
    const s = make();
    s.register({
      name: 'refresh',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: refresh.handler,
    });
    s.start();
    await flush();
    const boot = runsOf(db, 'refresh')[0];
    const first = s.trigger('refresh');
    const second = s.trigger('refresh');
    expect(first.joined).toBe(true);
    expect(first.runId).toBe(boot?.id);
    expect(second.outcome).toBe(first.outcome);
    expect(openRunsOf(db, 'refresh')).toHaveLength(1);
    expect(refresh.calls).toHaveLength(1);

    refresh.resolve(0, { checked: 12 });
    const outcome = await first.outcome;
    expect(outcome).toMatchObject({
      runId: boot?.id,
      status: 'completed',
      reason: 'boot',
      detail: { checked: 12 },
    });
    expect(await second.outcome).toBe(outcome);

    // With nothing running, a caller starts a run of its own; the cadence does not move.
    const third = s.trigger('refresh');
    expect(third.joined).toBe(false);
    expect(runsOf(db, 'refresh').at(-1)).toMatchObject({
      reason: 'caller',
      coalescedSlots: 0,
      status: 'running',
    });
    expect(jobOf(db, 'refresh').nextRunAt).toBe(at('10:00:00'));
    refresh.resolve(1);
    expect(await third.outcome).toMatchObject({ status: 'completed', detail: null });
  });

  it('trigger names an unknown job or a stopped scheduler as an error', async () => {
    const s = make();
    s.register({
      name: 'a',
      cron: '0 * * * *',
      deadlineMs: 1_000,
      networkGate: false,
      handler: quickHandler().handler,
    });
    expect(() => s.trigger('a')).toThrow(/not running/);
    s.start();
    expect(() => s.trigger('b')).toThrow(/no job/);
    await s.stop();
    expect(() => s.trigger('a')).toThrow(/not running/);
  });
});

describe('a handler that throws', () => {
  it('fails its run with the error text, retries in 60 s without moving the cadence, and the scheduler keeps going', async () => {
    let attempts = 0;
    const other = quickHandler();
    const s = make();
    s.register({
      name: 'flaky',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('store directory unreachable');
        return { ok: true };
      },
    });
    s.register({
      name: 'other',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: other.handler,
    });
    s.start();
    await flush();

    expect(runsOf(db, 'flaky')).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'boot',
        detail: { error: 'store directory unreachable' },
      }),
    ]);
    expect(jobOf(db, 'flaky')).toMatchObject({
      retryAt: at('09:48:00'),
      nextRunAt: at('10:00:00'),
    });
    expect(runsOf(db, 'other')).toEqual([expect.objectContaining({ status: 'completed' })]);

    await advanceTo(clock, [timers], ms(at('09:48:00')));
    expect(
      runsOf(db, 'flaky').map((r) => [r.status, r.reason, r.coalescedSlots, r.startedAt]),
    ).toEqual([
      ['failed', 'boot', 0, at('09:47:00')],
      ['completed', 'retry', 0, at('09:48:00')],
    ]);
    expect(jobOf(db, 'flaky')).toMatchObject({ retryAt: null, nextRunAt: at('10:00:00') });

    await advanceTo(clock, [timers], ms(at('10:00:00')));
    expect(runsOf(db, 'flaky').at(-1)).toMatchObject({
      reason: 'slot',
      coalescedSlots: 1,
      status: 'completed',
    });
    expect(runsOf(db, 'other').at(-1)).toMatchObject({
      reason: 'slot',
      coalescedSlots: 1,
      status: 'completed',
    });
  });

  it('the run that stands for the retry drops it when it starts, so a timed-out retry leaves none', async () => {
    let attempts = 0;
    const s = make();
    s.register({
      name: 'flaky',
      cron: '*/30 * * * *',
      deadlineMs: 5_000,
      networkGate: false,
      handler: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('first try fails'));
        return new Promise(() => {});
      },
    });
    s.start();
    await flush();
    expect(jobOf(db, 'flaky').retryAt).toBe(at('09:48:00'));
    await advanceTo(clock, [timers], ms(at('09:48:00')));
    expect(openRunsOf(db, 'flaky')).toEqual([expect.objectContaining({ reason: 'retry' })]);
    expect(jobOf(db, 'flaky').retryAt).toBeNull();
    await advanceTo(clock, [timers], ms(at('09:48:05')));
    expect(runsOf(db, 'flaky').map((r) => r.status)).toEqual(['failed', 'timed_out']);
    expect(jobOf(db, 'flaky')).toMatchObject({ retryAt: null, nextRunAt: at('10:00:00') });
  });

  it('a handler that throws synchronously fails the same way', async () => {
    const s = make();
    s.register({
      name: 'sync',
      cron: '0 * * * *',
      deadlineMs: 1_000,
      networkGate: false,
      handler: () => {
        throw new TypeError('bad input');
      },
    });
    s.start();
    await flush();
    expect(runsOf(db, 'sync')).toEqual([
      expect.objectContaining({ status: 'failed', detail: { error: 'bad input' } }),
    ]);
  });
});

describe('the deadline', () => {
  it('times out a run whose handler never settles, keeps its partial results and releases the lock', async () => {
    const stuck = heldHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 600_000,
      networkGate: false,
      handler: stuck.handler,
    });
    s.start();
    await flush();
    const context = stuck.calls[0];
    if (!context) throw new Error('the handler was not called');
    context.report({ checked: 3, of: 40 });
    expect(openRunsOf(db, 'sweep')[0]?.detail).toMatchObject({ partial: { checked: 3, of: 40 } });
    const joined = s.trigger('sweep');

    await advanceTo(clock, [timers], ms(at('09:56:59')));
    expect(openRunsOf(db, 'sweep')).toHaveLength(1);
    expect(context.signal.aborted).toBe(false);

    await advanceTo(clock, [timers], ms(at('09:57:00')));
    expect(runsOf(db, 'sweep')).toEqual([
      expect.objectContaining({
        status: 'timed_out',
        startedAt: at('09:47:00'),
        endedAt: at('09:57:00'),
        detail: { error: 'deadline of 600000 ms reached', partial: { checked: 3, of: 40 } },
      }),
    ]);
    expect(context.signal.aborted).toBe(true);
    expect((context.signal.reason as Error).name).toBe('DeadlineReached');
    expect(await joined.outcome).toMatchObject({ status: 'timed_out', endedAt: at('09:57:00') });
    // The next slot is kept and no retry is left; the lock is free for the next run.
    expect(jobOf(db, 'sweep')).toMatchObject({ nextRunAt: at('10:00:00'), retryAt: null });
    const next = s.trigger('sweep');
    expect(next.joined).toBe(false);
    expect(openRunsOf(db, 'sweep')).toHaveLength(1);
    // The abandoned handler settling late changes nothing.
    stuck.resolve(0, { late: true });
    await flush();
    expect(runsOf(db, 'sweep')[0]?.status).toBe('timed_out');
  });

  it('a report after the deadline is ignored', async () => {
    const stuck = heldHandler();
    const s = make();
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 1_000,
      networkGate: false,
      handler: stuck.handler,
    });
    s.start();
    await advanceBy(clock, [timers], 1_000);
    stuck.calls[0]?.report({ checked: 9 });
    expect(runsOf(db, 'sweep')[0]?.detail).toEqual({ error: 'deadline of 1000 ms reached' });
  });
});

describe('one-off jobs', () => {
  it('runs once at its time and never again, across a restart', async () => {
    const once = quickHandler();
    const s = make();
    s.register({
      name: 'once',
      at: at('10:15:00'),
      deadlineMs: 60_000,
      networkGate: false,
      handler: once.handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('12:00:00')));
    expect(runsOf(db, 'once').map((r) => [r.reason, r.coalescedSlots, r.startedAt])).toEqual([
      ['slot', 1, at('10:15:00')],
    ]);
    expect(s.health()[0]).toMatchObject({ name: 'once', nextRunAt: null, running: false });
    await s.stop();
    scheduler = undefined;

    const again = make();
    again.register({
      name: 'once',
      at: at('10:15:00'),
      deadlineMs: 60_000,
      networkGate: false,
      handler: once.handler,
    });
    again.start();
    await advanceBy(clock, [timers], 3_600_000);
    expect(runsOf(db, 'once')).toHaveLength(1);
  });
});

describe('stop()', () => {
  it('aborts running handlers, waits for them within the grace and leaves no open run', async () => {
    const polite = abortableHandler();
    const deaf = heldHandler();
    const s = make({ stopGraceMs: 2_000 });
    s.register({
      name: 'polite',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: polite.handler,
    });
    s.register({
      name: 'deaf',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: false,
      handler: deaf.handler,
    });
    s.start();
    await flush();
    deaf.calls[0]?.report({ checked: 1 });
    const joined = s.trigger('deaf');

    const stopping = s.stop();
    await flush();
    // The polite handler stopped at once; the deaf one is waited for until the grace runs out.
    expect(runsOf(db, 'polite')[0]).toMatchObject({
      status: 'failed',
      endedAt: at('09:47:00'),
      detail: { error: 'stopped: the scheduler shut down before the run ended' },
    });
    expect(openRunsOf(db, 'deaf')).toHaveLength(1);
    await advanceBy(clock, [timers], 2_000);
    await stopping;
    expect(runsOf(db, 'deaf')[0]).toMatchObject({
      status: 'failed',
      endedAt: at('09:47:02'),
      detail: {
        error: 'stopped: the scheduler shut down before the run ended',
        partial: { checked: 1 },
      },
    });
    expect(await joined.outcome).toMatchObject({ status: 'failed' });
    expect(timers.size).toBe(0);
    expect(jobOf(db, 'deaf')).toMatchObject({ nextRunAt: at('10:00:00') });
  });
});

describe('health', () => {
  it('reports per job the last run, the next run and the skipped runs', async () => {
    const sweep = heldHandler();
    const s = make({ probe: async () => false });
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: sweep.handler,
    });
    s.start();
    await advanceBy(clock, [timers], 68_000);
    expect(s.health()).toEqual([
      {
        name: 'sweep',
        cron: '*/30 * * * *',
        nextRunAt: at('10:00:00'),
        retryAt: at('09:49:08'),
        running: false,
        lastRun: {
          id: 1,
          status: 'skipped',
          reason: 'boot',
          startedAt: at('09:47:00'),
          endedAt: at('09:48:08'),
        },
        skippedRuns: 1,
      },
    ]);
  });
});
