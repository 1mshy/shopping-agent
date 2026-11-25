import { defineArea } from '../../harness.ts';
import { intakeCases } from './cases/intake.ts';
import type { IntakeCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<IntakeCase>({
  id: 'watch-intake',
  status: 'implemented',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/service.py: _watch_input (161-179), add_watch (248-318), _missing_condition (86-93)',
    'pricewatch/tests/test_watch_intake.py',
    'pricewatch/tests/test_restock.py: test_a_watch_with_no_condition_is_refused_before_any_store_is_read, test_rest_refuses_a_conditionless_watch_with_422',
    'reports/2026-11-16-shopping-agent-research.md:363-367 ("Save first, research after")',
    'docs/spec.md S§5.8 Intake, S§2 invariant 9',
  ],
  cases: intakeCases,
});
