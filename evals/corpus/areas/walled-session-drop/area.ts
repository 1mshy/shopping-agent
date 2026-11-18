import { defineArea } from '../../harness.ts';
import { sessionDropCases } from './cases/session-drop.ts';
import type { SessionDropCase } from './contract.ts';

export const area = defineArea<SessionDropCase>({
  id: 'walled-session-drop',
  status: 'pending',
  sources: [
    'Predecessor: hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit ' +
      '51db126, working tree as it stood on 2026-11-18 (uncommitted files present; the owner has not ' +
      'yet confirmed this is the reference copy)',
    'pricewatch/src/pricewatch/fetch.py: _site_cookie_pattern (lines 408-415), _SharedProfile.forget ' +
      '(433-452), Fetcher._forget_context (1068-1082), Fetcher.render (1134-1144)',
    'pricewatch/tests/test_browser_mode.py (cookie scope and render tests), ' +
      'test_retail_reliability.py::test_a_walled_render_starts_the_next_visit_from_a_fresh_session',
    'reports/2026-10-16-browser-access.md line 64',
  ],
  cases: sessionDropCases,
});
