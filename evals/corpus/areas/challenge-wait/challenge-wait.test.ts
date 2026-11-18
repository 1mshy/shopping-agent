import { describe, expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { StatusAfterWait, WorthWaiting } from './contract.ts';

/** Phase 1 replaces these stubs with the browser rung's wait rules in packages/fetch. */
const worthWaiting: WorthWaiting = () => notImplemented('challenge wait (worthWaiting)');
const statusAfterWait: StatusAfterWait = () => notImplemented('challenge wait (statusAfterWait)');

corpusTests(
  area,
  (c): boolean | number => {
    if (c.input.decide === 'worth_waiting') return worthWaiting(c.input.page);
    const { decide: _, ...input } = c.input;
    return statusAfterWait(input);
  },
  (c, actual) => {
    expect(actual).toBe(c.expected);
  },
);

describe('challenge-wait case data', () => {
  test.each(area.cases.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    if (c.input.decide === 'worth_waiting') {
      expect(c.input.page.rung).toBe('browser');
      expect(typeof c.expected).toBe('boolean');
    } else {
      expect(Number.isInteger(c.expected)).toBe(true);
      expect(c.input.first).not.toEqual(c.input.current);
    }
    expect(c.established.length).toBeGreaterThan(0);
    if (c.divergence !== undefined) expect(c.established).toContain('spec');
  });
});
