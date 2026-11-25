// The DNS gate in the runner: probe timings (delays between probes: 0, 3, 8, 18, 38, 68 s), the
// probe timeout, the skipped run and the 60 s retry that leaves the cadence alone.
import type { Database } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScheduler,
  type DnsProbe,
  type Scheduler,
  type SchedulerOptions,
} from '../../src/scheduler/index.ts';
import {
  advanceBy,
  advanceTo,
  at,
  FakeClock,
  FakeTimers,
  flush,
  heldHandler,
  jobOf,
  ms,
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
  clock = new FakeClock(at('09:30:00'));
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

/** A probe that records when each probe started, answering from `answers` (false when out). */
function scriptedProbe(answers: readonly (boolean | 'hang')[]) {
  const startedAt: number[] = [];
  const probe: DnsProbe = () => {
    const answer = answers[startedAt.length] ?? false;
    startedAt.push(clock.ms);
    if (answer === 'hang') return new Promise<boolean>(() => {});
    return Promise.resolve(answer);
  };
  return { probe, startedAt, offsets: () => startedAt.map((t) => (t - ms(at('09:30:00'))) / 1000) };
}

function make(probe: DnsProbe, extra: Partial<SchedulerOptions> = {}): Scheduler {
  scheduler = createScheduler({
    db,
    now: clock.now,
    timers,
    probe,
    onError: (error) => errors.push(error),
    ...extra,
  });
  return scheduler;
}

describe('the DNS gate', () => {
  it('probes at 0, 3, 8, 18, 38 and 68 s, then skips the run and retries 60 s later without moving the cadence', async () => {
    const dns = scriptedProbe([]);
    const sweep = quickHandler();
    const s = make(dns.probe);
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: sweep.handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('09:31:07')));
    expect(dns.offsets()).toEqual([0, 3, 8, 18, 38]);
    expect(runsOf(db, 'sweep')[0]?.status).toBe('running');

    await advanceTo(clock, [timers], ms(at('09:31:08')));
    expect(dns.offsets()).toEqual([0, 3, 8, 18, 38, 68]);
    expect(sweep.calls).toHaveLength(0);
    const [skipped] = runsOf(db, 'sweep');
    expect(skipped).toMatchObject({
      status: 'skipped',
      reason: 'boot',
      startedAt: at('09:30:00'),
      endedAt: at('09:31:08'),
    });
    expect(skipped?.detail).toMatchObject({
      error: 'no network: DNS did not resolve after 6 probes',
      retryAt: at('09:32:08'),
    });
    expect(skipped?.detail?.probes).toHaveLength(6);
    expect(jobOf(db, 'sweep')).toMatchObject({
      retryAt: at('09:32:08'),
      nextRunAt: at('10:00:00'),
    });
    expect(s.health()[0]?.skippedRuns).toBe(1);

    // The retry: still no network, so another skipped run and one new retry (replacing the old).
    await advanceTo(clock, [timers], ms(at('09:32:07')));
    expect(runsOf(db, 'sweep')).toHaveLength(1);
    await advanceTo(clock, [timers], ms(at('09:33:16')));
    expect(
      runsOf(db, 'sweep').map((r) => [
        r.status,
        r.reason,
        r.coalescedSlots,
        r.startedAt,
        r.endedAt,
      ]),
    ).toEqual([
      ['skipped', 'boot', 0, at('09:30:00'), at('09:31:08')],
      ['skipped', 'retry', 0, at('09:32:08'), at('09:33:16')],
    ]);
    expect(jobOf(db, 'sweep')).toMatchObject({
      retryAt: at('09:34:16'),
      nextRunAt: at('10:00:00'),
    });
    expect(s.health()[0]?.skippedRuns).toBe(2);
  });

  it('runs the job once DNS answers; the retry run clears the retry and the cadence is untouched', async () => {
    // Boot gate: six failures. Retry gate: fails, fails, then resolves on the third probe.
    const dns = scriptedProbe([false, false, false, false, false, false, false, false, true]);
    const sweep = quickHandler();
    const s = make(dns.probe);
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: sweep.handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('09:32:16')));
    expect(dns.offsets().slice(6)).toEqual([128, 131, 136]);
    expect(runsOf(db, 'sweep').map((r) => [r.status, r.reason, r.startedAt, r.endedAt])).toEqual([
      ['skipped', 'boot', at('09:30:00'), at('09:31:08')],
      ['completed', 'retry', at('09:32:08'), at('09:32:16')],
    ]);
    expect(sweep.calls.map((c) => c.reason)).toEqual(['retry']);
    expect(jobOf(db, 'sweep')).toMatchObject({ retryAt: null, nextRunAt: at('10:00:00') });
  });

  it('a probe that never answers counts as unresolved after 5 s, and the next delay runs from then', async () => {
    const dns = scriptedProbe(['hang', 'hang', 'hang', 'hang', 'hang', 'hang']);
    const s = make(dns.probe);
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: quickHandler().handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('09:32:00')));
    // Starts: 0; 5 + 3 = 8; 13 + 5 = 18; 23 + 10 = 33; 38 + 20 = 58; 63 + 30 = 93; the last times out at 98.
    expect(dns.offsets()).toEqual([0, 8, 18, 33, 58, 93]);
    expect(runsOf(db, 'sweep')[0]).toMatchObject({ status: 'skipped', endedAt: at('09:31:38') });
    expect(jobOf(db, 'sweep').retryAt).toBe(at('09:32:38'));
  });

  it('a caller during the gate joins the waiting run', async () => {
    const dns = scriptedProbe([false, true]);
    const sweep = heldHandler();
    const s = make(dns.probe);
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: sweep.handler,
    });
    s.start();
    await flush();
    const caller = s.trigger('sweep');
    expect(caller.joined).toBe(true);
    await advanceTo(clock, [timers], ms(at('09:30:03')));
    expect(sweep.calls).toHaveLength(1);
    sweep.resolve(0, { checked: 1 });
    expect(await caller.outcome).toMatchObject({
      status: 'completed',
      reason: 'boot',
      detail: { checked: 1 },
    });
    expect(runsOf(db, 'sweep')).toHaveLength(1);
  });

  it('stop() during the gate ends the run as stopped, not skipped, and leaves no open run', async () => {
    const dns = scriptedProbe([]);
    const s = make(dns.probe);
    s.register({
      name: 'sweep',
      cron: '*/30 * * * *',
      deadlineMs: 900_000,
      networkGate: true,
      handler: quickHandler().handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('09:30:10')));
    await s.stop();
    scheduler = undefined;
    expect(runsOf(db, 'sweep')).toEqual([
      expect.objectContaining({
        status: 'failed',
        endedAt: at('09:30:10'),
        detail: { error: 'stopped: the scheduler shut down before the run ended' },
      }),
    ]);
    expect(timers.size).toBe(0);
  });

  it('a job without the gate never probes', async () => {
    const dns = scriptedProbe([]);
    const s = make(dns.probe);
    s.register({
      name: 'outbox',
      cron: '* * * * *',
      deadlineMs: 60_000,
      networkGate: false,
      handler: quickHandler().handler,
    });
    s.start();
    await advanceTo(clock, [timers], ms(at('09:33:00')));
    expect(dns.startedAt).toEqual([]);
    expect(runsOf(db, 'outbox').map((r) => r.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
  });
});
