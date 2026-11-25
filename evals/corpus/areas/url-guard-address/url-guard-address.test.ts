import { isIP } from 'node:net';
import { checkDestination as guardCheckDestination } from '@agentic-dasher/fetch';
import { FetchOutcome, RUNGS } from '@agentic-dasher/shared';
import { describe, expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { CheckDestination, GuardDecision } from './contract.ts';

/** The guard's decision function in packages/fetch (S§5.1). */
const checkDestination: CheckDestination = guardCheckDestination;

corpusTests(
  area,
  (c) => checkDestination(c.input),
  (c, actual: GuardDecision) => {
    if (!actual.pass) expect(FetchOutcome.parse(actual.outcome)).toEqual(actual.outcome);
    expect(actual).toEqual(c.expected);
  },
);

describe('url-guard-address case data', () => {
  test.each(area.cases.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    const { input, expected } = c;
    expect(RUNGS).toContain(input.rung);
    if (expected.pass) {
      expect(expected.connectTo.length).toBeGreaterThan(0);
      for (const a of expected.connectTo) expect(isIP(a)).not.toBe(0);
    } else {
      expect(FetchOutcome.safeParse(expected.outcome).success).toBe(true);
      expect(expected.outcome.rung).toBe(input.rung);
    }
    if (input.answer?.kind === 'addresses') {
      // A scoped address ("fe80::1%en0") is a valid answer to script.
      for (const a of input.answer.addresses) expect(isIP(a.split('%')[0] as string)).not.toBe(0);
    }
    expect(c.from.length).toBeGreaterThan(0);
    expect(c.established.length).toBeGreaterThan(0);
    // A divergence from the predecessor rests on the spec or on a ruling of 2026-11-23.
    if (c.divergence !== undefined) {
      expect(c.established.some((e) => e === 'spec' || e === 'ruling')).toBe(true);
    }
  });
});
