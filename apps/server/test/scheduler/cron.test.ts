// The cron grid the runner hands to the core decision (croner, UTC), and the one-off grid.
import { planRun } from '@agentic-dasher/core';
import { describe, expect, it } from 'vitest';
import { cronGrid, oneOffGrid } from '../../src/scheduler/cron.ts';
import { at, ms } from './harness.ts';

describe('cronGrid', () => {
  const halfHourly = cronGrid('*/30 * * * *', ms(at('09:00:00')));

  it('counts the slots from next_run_at to now and gives the first slot after now', () => {
    expect(halfHourly.due(ms(at('09:30:00')), ms(at('09:29:59')))).toEqual({
      count: 0,
      nextMs: ms(at('09:30:00')),
    });
    expect(halfHourly.due(ms(at('09:30:00')), ms(at('11:47:00')))).toEqual({
      count: 5,
      nextMs: ms(at('12:00:00')),
    });
    expect(halfHourly.due(ms(at('09:30:00')), ms(at('12:00:00')))).toEqual({
      count: 6,
      nextMs: ms(at('12:30:00')),
    });
  });

  it('finds the first slot after, and at or after, an instant', () => {
    expect(halfHourly.firstAfter(ms(at('09:30:00')))).toBe(ms(at('10:00:00')));
    expect(halfHourly.firstAtOrAfter(ms(at('09:30:00')))).toBe(ms(at('09:30:00')));
    expect(halfHourly.firstAtOrAfter(ms(at('09:30:00')) + 1)).toBe(ms(at('10:00:00')));
  });

  it('evaluates in UTC, across days', () => {
    const daily = cronGrid('40 7 * * *', ms(at('09:00:00')));
    expect(daily.firstAfter(ms(at('09:00:00')))).toBe(ms(at('07:40:00', '18')));
    expect(daily.due(ms(at('07:40:00', '15')), ms(at('09:00:00')))).toEqual({
      count: 3,
      nextMs: ms(at('07:40:00', '18')),
    });
  });

  it('gives the core decision the same answers as the corpus grid for a fixed cron', () => {
    const decision = planRun(
      {
        now: at('11:47:00'),
        wake: 'tick',
        nextRunAt: at('09:30:00'),
        deadlineMs: 900_000,
        running: null,
        pendingRetryAt: null,
      },
      halfHourly,
    );
    expect(decision).toEqual({
      action: 'run',
      because: 'slot',
      coalescedSlots: 5,
      nextRunAt: at('12:00:00'),
      retryCleared: false,
    });
  });

  it('refuses a pattern croner cannot read', () => {
    expect(() => cronGrid('every half hour', 0)).toThrow();
  });
});

describe('oneOffGrid', () => {
  it('has one slot until a run has stood for it', () => {
    const slot = ms(at('10:00:00'));
    expect(oneOffGrid(false).due(slot, slot - 1)).toEqual({ count: 0, nextMs: slot });
    expect(oneOffGrid(false).due(slot, slot + 3_600_000)).toEqual({ count: 1, nextMs: slot });
    expect(oneOffGrid(true).due(slot, slot + 3_600_000)).toEqual({ count: 0, nextMs: slot });
  });
});
