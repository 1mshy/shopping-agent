import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import { runMatcher, verifyMatch } from './verify.ts';

corpusTests(area, runMatcher, verifyMatch);
