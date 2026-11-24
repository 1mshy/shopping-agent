import { defineArea } from '../../harness.ts';
import { gatingCases } from './cases/gating.ts';
import type { DeliveryGatingCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<DeliveryGatingCase>({
  id: 'alert-delivery-gating',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _evaluate_trackers (1289-1347)',
    'pricewatch/tests/test_service.py: test_an_undelivered_alert_keeps_the_watch_armed_for_the_next_sweep, test_with_no_channel_configured_the_hit_is_recorded_once',
    'pricewatch/tests/test_restock.py: test_restock_fires_once_per_return_and_again_after_the_next_cycle',
    'reports/2026-11-16-shopping-agent-research.md: "a failed push used up the 12 h cooldown" (2026-09-09 dark-wake pushes)',
    'docs/spec.md S§2 invariant 11, S§4.4 notification_event and delivery, S§5.11',
    'docs/progress.md 2026-11-23 "Owner rulings on the Phase 1 questions" (in-app acceptance does not stamp) and "Settled by the orchestrator" (the cooldown is per watch)',
  ],
  cases: gatingCases,
});
