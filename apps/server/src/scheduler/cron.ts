// The one module that imports croner (S§3.3: own scheduler + croner for next-run times). A job's
// cadence is a croner pattern evaluated in UTC; the decision in packages/core sees it as a grid of
// slots.
import type { SlotGrid } from '@agentic-dasher/core';
import { Cron } from 'croner';

export interface CronGrid extends SlotGrid {
  /** The first slot strictly after `ms`. */
  firstAfter(ms: number): number;
  /** The first slot at or after `ms`. */
  firstAtOrAfter(ms: number): number;
}

/** Throws on a pattern croner refuses, or one with no slot after `fromMs`. */
export function cronGrid(pattern: string, fromMs: number): CronGrid {
  // No callback: croner only evaluates the pattern and starts no timer of its own.
  const cron = new Cron(pattern, { timezone: 'UTC' });
  const after = (ms: number): number => {
    const next = cron.nextRun(new Date(ms));
    if (next === null) throw new RangeError(`cron "${pattern}" has no slot after ${ms}`);
    return next.getTime();
  };
  after(fromMs);
  return {
    firstAfter: after,
    firstAtOrAfter: (ms) => after(ms - 1),
    due(nextRunAtMs, nowMs) {
      if (nowMs < nextRunAtMs) return { count: 0, nextMs: nextRunAtMs };
      // Walks the slots one by one: a week asleep on a 30 min cron is 336 steps. A pattern with
      // seconds after a long sleep is the slow case (about 30 µs a step).
      let count = 0;
      let slot = nextRunAtMs;
      while (slot <= nowMs) {
        count += 1;
        slot = after(slot);
      }
      return { count, nextMs: slot };
    },
  };
}

/** A one-off time: one slot, standing until a run has stood for it. */
export function oneOffGrid(spent: boolean): SlotGrid {
  return {
    due(nextRunAtMs, nowMs) {
      return { count: spent || nowMs < nextRunAtMs ? 0 : 1, nextMs: nextRunAtMs };
    },
  };
}
