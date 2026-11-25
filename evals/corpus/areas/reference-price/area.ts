import { defineArea } from '../../harness.ts';
import { referenceCases } from './cases/reference.ts';
import type { ReferenceCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<ReferenceCase>({
  id: 'reference-price',
  status: 'implemented',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _initial_baselines (321-332), _discover_product (377-405), _attach_web_listings (426-444), track_query (532-575), set_tracker reset_baseline (1588-1591)',
    'pricewatch/tests/test_service.py: condition guards (163-190), one currency per watch (311-320)',
    'pricewatch/tests/test_watch_intake.py: test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying, test_url_adopts_actual_currency_including_after_restart',
    'reports/2026-11-16-shopping-agent-research.md:378-382 ("Baseline hygiene")',
    'docs/spec.md S§5.8 Reference price and Intake',
    'docs/progress.md 2026-11-23 "Owner rulings on the Phase 1 questions" (user price wins, median recomputed, unknown condition left out) and "Settled by the orchestrator" (even-count median)',
  ],
  cases: referenceCases,
});
