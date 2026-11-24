import { defineArea } from '../../harness.ts';
import { statusAfterWaitCases } from './cases/status-after-wait.ts';
import { worthWaitingCases } from './cases/worth-waiting.ts';
import type { ChallengeWaitCase } from './contract.ts';

export const area = defineArea<ChallengeWaitCase>({
  id: 'challenge-wait',
  status: 'pending',
  sources: [
    'Predecessor: hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit ' +
      '51db126, working tree as it stood on 2026-11-18 (uncommitted files present; the owner confirmed it ' +
      'as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/fetch.py: _CHALLENGE_STATUSES (line 77), _needs_a_person (352-359), ' +
      '_may_still_clear (362-369), Fetcher.render (1084-1157), Fetcher._settled (1159-1197)',
    'pricewatch/tests/test_browser_mode.py (the render tests, lines 329-462)',
    'reports/2026-10-16-browser-access.md (lines 64, 153, 392: the wait and why captchas skip it)',
  ],
  cases: [...worthWaitingCases, ...statusAfterWaitCases],
});
