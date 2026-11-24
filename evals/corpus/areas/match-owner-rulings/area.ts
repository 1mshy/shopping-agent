// The owner's matching rulings as fixed cases (S§5.4: "combo counts both ways, Plus counts the
// query's way, a size in place of a model is not a clash"), the ruling of 2026-11-23 (a name
// suffix that changes the line or the material makes a different product, never exact), and the
// hand reviews' rule and labels.
// A future change must not flip one of these without the owner.
import { defineArea } from '../../harness.ts';
import { PREDECESSOR } from '../match-title-rules/evidence.ts';
import { combo } from './cases/combo.ts';
import { plusAndSize } from './cases/plus-and-size.ts';
import { reviews } from './cases/reviews.ts';
import type { MatchCase } from './contract.ts';

export const area = defineArea<MatchCase>({
  id: 'match-owner-rulings',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'reports/2026-10-23-matching.md (the rulings and the failure classes)',
    'reports/2026-10-14-web-discovery.md ("Review of the additions", the Phase 1 hand check)',
    'scripts/eval/2026-10-23-phase5-review.json, scripts/eval/2026-10-23-matching-review.json',
    'reports/2026-10-23-phase5-evaluation.json, reports/2026-10-23-matching-eval.json (the titles ' +
      'behind the review labels)',
    'pricewatch/src/pricewatch/matching.py (comments that record the rulings)',
    'pricewatch/tests/test_matching.py, test_recipes.py, test_title_check.py (the rows that pin ' +
      'the rulings)',
  ],
  cases: [...combo, ...plusAndSize, ...reviews],
});
