import { corpusTests } from '../../harness.ts';
import { runMatcher, verifyMatch } from '../match-title-rules/verify.ts';
import { area } from './area.ts';

corpusTests(area, runMatcher, verifyMatch);
