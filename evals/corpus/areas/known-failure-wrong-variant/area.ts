// Known failure "wrong variant" (plan P0 workstream 3; S§6 lists it as a critical regression),
// its matching half: a listing of another configuration, capacity, size or pack count accepted as
// the product. The reading half (another variant's price attached to the right listing, S§5.2
// "Variant coupling") belongs to the Phase 1 readers unit.
import { defineArea } from '../../harness.ts';
import { PREDECESSOR } from '../match-title-rules/evidence.ts';
import { wrongVariant } from './cases/wrong-variant.ts';
import type { MatchCase } from './contract.ts';

export const area = defineArea<MatchCase>({
  id: 'known-failure-wrong-variant',
  status: 'implemented',
  sources: [
    PREDECESSOR,
    'reports/2026-10-14-web-discovery.md and .json (the Phase 1 run and its hand check)',
    'reports/2026-10-23-phase5-evaluation.json, scripts/eval/2026-10-23-phase5-review.json',
    'reports/2026-10-23-matching-eval.json, reports/2026-10-23-matching.md',
    'docs/plans/2026-10-14-browser-agent-progress.md',
    'pricewatch/src/pricewatch/matching.py (run offline to state which failures 51db126 fixed)',
  ],
  cases: wrongVariant,
});
