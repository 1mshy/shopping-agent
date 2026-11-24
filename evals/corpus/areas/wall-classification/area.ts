import { defineArea } from '../../harness.ts';
import { notWallCases } from './cases/not-walls.ts';
import { statusCases } from './cases/status.ts';
import { wallCases } from './cases/walls.ts';
import type { WallCase } from './contract.ts';

export const area = defineArea<WallCase>({
  id: 'wall-classification',
  status: 'pending',
  sources: [
    'Predecessor: hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit ' +
      '51db126, working tree as it stood on 2026-11-18 (uncommitted files present; the owner confirmed it ' +
      'as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/fetch.py: CHALLENGE_MARKERS (lines 58-65), Page.looks_blocked ' +
      '(300-336), _title_and_visible (339-349), _needs_a_person (352-359), store_answered (184-195), ' +
      '_usable (1200-1201), get_or_render (1203-1259)',
    'pricewatch/tests/test_fetch.py, test_retail_reliability.py, test_browser_mode.py, ' +
      'test_amazon.py (wall cases), test_recipes.py::test_a_wall_on_the_replay_is_reported_as_a_wall, ' +
      'test_canada.py::test_verify_reports_a_walled_homepage_as_blocked',
    'pricewatch/tests/fixtures/ (24 saved pages, none a wall; displayed/walmart.html reduced here)',
    'scripts/browser-lab/harness/lab/classify.py classify(): vendor names, run offline',
    'reports/2026-09-19-retailer-reliability.md, reports/2026-10-16-browser-access.md',
    'docs/progress.md 2026-11-23 "Settled by the orchestrator": bare 403, 401, in-house vendors',
  ],
  cases: [...statusCases, ...wallCases, ...notWallCases],
});
