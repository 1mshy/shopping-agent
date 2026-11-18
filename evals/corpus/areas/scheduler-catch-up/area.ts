import { defineArea } from '../../harness.ts';
import { catchUpCases } from './cases/catch-up.ts';
import type { CatchUpCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner has not yet confirmed this is the reference copy';

export const area = defineArea<CatchUpCase>({
  id: 'scheduler-catch-up',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/scheduler.py: _CATCH_UP (79-85), retry_sweep (120-125), sweep (128-147), check_recipes (175-205), start (365-392)',
    'pricewatch/src/pricewatch/service.py: refresh_offers (1015-1041)',
    'pricewatch/tests/test_scheduler.py, pricewatch/tests/test_service.py (joined sweeps)',
    'pricewatch/.venv APScheduler 3.11.3 schedulers/base.py:1191-1228 (library behaviour the predecessor relied on, run offline)',
    'reports/2026-09-18-reliability.md (12 s freeze, exactly one catch-up)',
    'docs/spec.md S§5.8 Scheduler, S§2 invariant 12, S§4.4 job and job_run, S§6 sleep/restart gate',
  ],
  cases: catchUpCases,
});
