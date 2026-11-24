import { defineArea } from '../../harness.ts';
import { restockCases } from './cases/restock.ts';
import type { RestockCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<RestockCase>({
  id: 'alert-restock',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _upsert_offer (711, stock transitions 729-738), _restocked_offer (1206), _evaluate_trackers (1276-1283), set_tracker (1582-1586)',
    'pricewatch/tests/test_restock.py',
    'README.md "Alerts" (716-726)',
    'docs/spec.md S§5.8 Alert rules, S§2 invariant 10',
  ],
  cases: restockCases,
});
