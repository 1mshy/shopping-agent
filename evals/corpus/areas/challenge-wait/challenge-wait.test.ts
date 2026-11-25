import {
  statusAfterWait as fetchStatusAfterWait,
  worthWaiting as fetchWorthWaiting,
} from '@agentic-dasher/fetch';
import { describe, expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { StatusAfterWait, WorthWaiting } from './contract.ts';

/** The browser rung's wait rules in packages/fetch (S§5.1 ladder step 3). */
const worthWaiting: WorthWaiting = fetchWorthWaiting;
const statusAfterWait: StatusAfterWait = fetchStatusAfterWait;

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
