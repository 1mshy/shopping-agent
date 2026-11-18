import { defineArea } from '../../harness.ts';
import { comparableCases } from './cases/comparable.ts';
import { dropCases } from './cases/drop.ts';
import { repeatCases } from './cases/repeat.ts';
import { targetCases } from './cases/target.ts';
import type { PriceAlertCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner has not yet confirmed this is the reference copy';

export const area = defineArea<PriceAlertCase>({
  id: 'alert-price-rules',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _reasons (1172), _should_notify (1191), _best_offer (1143), _evaluate_trackers (1258)',
    'pricewatch/tests/test_service.py: alert rules, one currency per watch, undelivered alert, concurrent evaluations',
    'pricewatch/tests/test_watch_intake.py: test_failed_sweep_preserves_history_but_never_alerts_on_stale_price, test_sold_out_discount_does_not_trigger_price_alert',
    'README.md "Alerts" (680-726) and the wake-recovery notes (1176-1190)',
    'docs/spec.md S§5.8 Alert rules, S§2 invariants 10 and 11',
  ],
  cases: [...targetCases, ...dropCases, ...comparableCases, ...repeatCases],
});
