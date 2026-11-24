import { defineArea } from '../../harness.ts';
import { staleCases } from './cases/stale.ts';
import type { StaleReadCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<StaleReadCase>({
  id: 'stale-read',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _upsert_offer (711-757), _best_offer (1143), list_tracked (1367-1420), price_history (1423-1478)',
    'pricewatch/tests/test_service.py: test_upsert_failure_keeps_last_price_and_counts_errors, test_upsert_records_price_points_only_on_change, test_list_trackers_reports_the_currency_and_counts_foreign_listings',
    'pricewatch/tests/test_watch_intake.py: test_failed_sweep_preserves_history_but_never_alerts_on_stale_price, test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying, test_sold_out_discount_does_not_trigger_price_alert',
    'pricewatch/tests/test_restock.py: test_a_read_that_says_nothing_about_stock_keeps_the_last_known_state',
    'reports/2026-11-13-shopping-agent-proposal.md:186 and :201 (stale-price and stale-as-current failures named for the regression corpus); reports/2026-11-16-shopping-agent-research.md:373-377 ("stale reads never alert")',
    'docs/spec.md S§2 invariant 10, S§4.1 failed-read rule, S§6 critical regressions',
  ],
  cases: staleCases,
});
