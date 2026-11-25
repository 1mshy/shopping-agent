// The scheduler's pure decisions beyond the corpus cases: the wakes the corpus does not pin, the
// grid arithmetic and the gate's bounds.
import { describe, expect, it } from 'vitest';
import {
  type CatchUpInput,
  everyGrid,
  NETWORK_PROBE_DELAYS_MS,
  networkGate,
  planJobRun,
  planRun,
  type SlotGrid,
} from '../../src/scheduler/index.ts';

const at = (hhmmss: string) => `2026-11-17T${hhmmss}.000Z`;
const job = (nextRunAt: string) => ({
  name: 'sweep',
  everyMs: 1_800_000,
  nextRunAt,
  deadlineMs: 900_000,
  networkGate: true,
});
const input = (more: Partial<CatchUpInput> & Pick<CatchUpInput, 'now'>): CatchUpInput => ({
  wake: 'tick',
  job: job(at('10:00:00')),
  running: null,
  pendingRetryAt: null,
  ...more,
});

describe('planJobRun', () => {
  it('a caller with nothing due runs once, standing for no slot, and keeps the cadence', () => {
    expect(planJobRun(input({ now: at('09:47:00'), wake: 'caller' }))).toEqual({
      action: 'run',
      because: 'caller',
      coalescedSlots: 0,
      nextRunAt: at('10:00:00'),
      retryCleared: false,
    });
  });

  it('a caller after missed slots stands for them and moves to the next slot', () => {
    expect(planJobRun(input({ now: at('11:01:00'), wake: 'caller' }))).toEqual({
      action: 'run',
      because: 'caller',
      coalescedSlots: 3,
      nextRunAt: at('11:30:00'),
      retryCleared: false,
    });
  });

  it('a retry that is not due yet waits, on a tick and on an early retry wake', () => {
    for (const wake of ['tick', 'retry'] as const) {
      expect(
        planJobRun(input({ now: at('09:40:00'), wake, pendingRetryAt: at('09:41:00') })),
      ).toEqual({ action: 'wait', nextRunAt: at('10:00:00') });
    }
  });

  it('a tick that finds only the retry due runs it as the retry', () => {
    expect(
      planJobRun(input({ now: at('09:41:00'), pendingRetryAt: at('09:41:00') })),
    ).toMatchObject({ action: 'run', because: 'retry', coalescedSlots: 0, retryCleared: true });
  });

  it('a retry wake that also finds a due slot runs once, for the slot', () => {
    expect(
      planJobRun(input({ now: at('10:00:10'), wake: 'retry', pendingRetryAt: at('09:59:00') })),
    ).toEqual({
      action: 'run',
      because: 'slot',
      coalescedSlots: 1,
      nextRunAt: at('10:30:00'),
      retryCleared: true,
    });
  });

  it('boot with a retry pending runs once and stands for the retry', () => {
    expect(
      planJobRun(input({ now: at('09:40:00'), wake: 'boot', pendingRetryAt: at('09:41:00') })),
    ).toMatchObject({ action: 'run', because: 'boot', coalescedSlots: 0, retryCleared: true });
  });

  it('every wake joins an open run inside its deadline and times out one past it', () => {
    const running = { runId: 9, startedAt: at('09:30:00') };
    for (const wake of ['tick', 'boot', 'caller', 'retry'] as const) {
      expect(planJobRun(input({ now: at('11:00:00'), wake, running }))).toEqual({
        action: 'time_out',
        runId: 9,
        runStatus: 'timed_out',
        keepPartialResults: true,
      });
      expect(planJobRun(input({ now: at('09:31:00'), wake, running }))).toEqual({
        action: 'join',
        runId: 9,
      });
    }
  });

  it('refuses a malformed timestamp instead of deciding on NaN', () => {
    expect(() => planJobRun(input({ now: 'later' }))).toThrow(RangeError);
  });
});

describe('everyGrid', () => {
  const grid = everyGrid(1_000);
  it('counts the slots at or before now and returns the first one after it', () => {
    expect(grid.due(10_000, 9_999)).toEqual({ count: 0, nextMs: 10_000 });
    expect(grid.due(10_000, 10_000)).toEqual({ count: 1, nextMs: 11_000 });
    expect(grid.due(10_000, 10_999)).toEqual({ count: 1, nextMs: 11_000 });
    expect(grid.due(10_000, 15_000)).toEqual({ count: 6, nextMs: 16_000 });
  });
  it('refuses a step that is not a positive integer', () => {
    expect(() => everyGrid(0)).toThrow(RangeError);
    expect(() => everyGrid(1.5)).toThrow(RangeError);
  });
});

describe('planRun on another grid', () => {
  it('takes the count and the next slot from the grid it is given (a cron)', () => {
    const cron: SlotGrid = {
      due: (next, now) => (now < next ? { count: 0, nextMs: next } : { count: 2, nextMs: now + 7 }),
    };
    expect(
      planRun(
        {
          now: at('10:00:00'),
          wake: 'tick',
          nextRunAt: at('08:00:00'),
          deadlineMs: 1,
          running: null,
          pendingRetryAt: null,
        },
        cron,
      ),
    ).toEqual({
      action: 'run',
      because: 'slot',
      coalescedSlots: 2,
      nextRunAt: '2026-11-17T10:00:00.007Z',
      retryCleared: false,
    });
  });
});

describe('networkGate', () => {
  const start = at('09:30:00');
  const plus = (s: number) => new Date(Date.parse(start) + s * 1000).toISOString();

  it('has six probes whose delays sum to 68 s', () => {
    expect(NETWORK_PROBE_DELAYS_MS).toHaveLength(6);
    expect(NETWORK_PROBE_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(68_000);
  });

  it('a resolved sixth probe still runs the job', () => {
    const probes = [0, 3, 8, 18, 38].map((s) => ({ at: plus(s), resolved: false }));
    probes.push({ at: plus(68), resolved: true });
    expect(
      networkGate({
        kind: 'gate',
        now: plus(68),
        gateStartedAt: start,
        probes,
        pendingRetryAt: null,
      }),
    ).toEqual({ action: 'run' });
  });

  it('a late wake postpones from the moment it decides, not from the last probe', () => {
    const probes = [0, 3, 8, 18, 38, 68].map((s) => ({ at: plus(s), resolved: false }));
    expect(
      networkGate({
        kind: 'gate',
        now: plus(500),
        gateStartedAt: start,
        probes,
        pendingRetryAt: null,
      }),
    ).toEqual({ action: 'postpone', runStatus: 'skipped', retryAt: plus(560) });
  });

  it('a completed run with no retry pending clears nothing', () => {
    expect(
      networkGate({ kind: 'run_ended', now: start, status: 'completed', pendingRetryAt: null }),
    ).toEqual({ action: 'done', retryCleared: false });
  });

  it('a failed run replaces a pending retry with one 60 s after now', () => {
    expect(
      networkGate({ kind: 'run_ended', now: start, status: 'failed', pendingRetryAt: plus(5) }),
    ).toEqual({ action: 'retry_later', retryAt: plus(60) });
  });
});
