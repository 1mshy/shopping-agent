import { matchListing } from '@agentic-dasher/core';
import { corpusTests } from '../../harness.ts';
import { verifyMatch } from '../match-title-rules/verify.ts';
import { area } from './area.ts';
import { checkCase, type MatchCase, type MatchInput, type MatchOutput } from './contract.ts';

/** The subject: S§5.4 tiers 1-2 (packages/core matching), typed against this area's contract. */
const subject: (input: MatchInput) => MatchOutput = matchListing;

function runMatcher(c: MatchCase): MatchOutput {
  checkCase(c);
  return subject(c.input);
}

corpusTests(area, runMatcher, verifyMatch);
