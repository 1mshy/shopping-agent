import { planSessionDrop as fetchPlanSessionDrop } from '@agentic-dasher/fetch';
import { FetchOutcome } from '@agentic-dasher/shared';
import { describe, expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { PlanSessionDrop } from './contract.ts';

/** The browser client's session-drop rule in packages/fetch (S§5.1 Sessions). */
const planSessionDrop: PlanSessionDrop = fetchPlanSessionDrop;

corpusTests(
  area,
  (c) => planSessionDrop(c.input),
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);

describe('walled-session-drop case data', () => {
  test.each(area.cases.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    const { input, expected } = c;
    expect(FetchOutcome.safeParse(input.outcome).success).toBe(true);
    expect(() => new URL(input.pageUrl)).not.toThrow();
    // What is cleared is drawn from the jar, in jar order, and only a wall clears anything.
    expect(input.jar.filter((d) => expected.cookieDomains.includes(d))).toEqual(
      expected.cookieDomains,
    );
    if (input.outcome.kind !== 'wall') expect(expected).toEqual({ cookieDomains: [], origins: [] });
    for (const o of expected.origins) expect(new URL(o).origin).toBe(o);
    expect(c.established.length).toBeGreaterThan(0);
    if (c.divergence !== undefined) expect(c.established).toContain('spec');
  });
});
