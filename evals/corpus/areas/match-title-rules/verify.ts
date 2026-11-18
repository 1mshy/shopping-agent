// The run and verify halves shared by the matcher areas' tests.
import { expect } from 'vitest';
import { notImplemented } from '../../harness.ts';
import { checkCase, checkOutput, type MatchCase, type MatchOutput } from './contract.ts';

/** The subject: S§5.4 tiers 1-2. Phase 1 replaces the stub with `packages/core` matching. */
export function runMatcher(c: MatchCase): MatchOutput {
  checkCase(c);
  return notImplemented('matcher tiers 1-2 (packages/core/matching, S§5.4)');
}

/** The answer keeps the output contract and its relation is one the case accepts. */
export function verifyMatch(c: MatchCase, actual: MatchOutput): void {
  expect(checkOutput(c, actual)).toContain(actual.relation);
}
