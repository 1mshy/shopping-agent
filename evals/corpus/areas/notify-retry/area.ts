import { defineArea } from '../../harness.ts';
import { retryCases } from './cases/retry.ts';
import type { NotifyRetryCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner confirmed it as the reference copy on 2026-11-23';

export const area = defineArea<NotifyRetryCase>({
  id: 'notify-retry',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/notify/__init__.py: RETRY_DELAYS, MAX_RETRY_DELAY, _deferred_until (31-35), transient (38-41), dispatch (52-88)',
    'pricewatch/src/pricewatch/notify/base.py: DeliveryError Retry-After parsing (9-26), check_response (29-33)',
    'pricewatch/tests/test_notify.py: dispatch and Retry-After tests (107-203)',
    'README.md wake-recovery notes (1183-1190); reports/2026-09-18-reliability.md (503 then 200 in the freeze test)',
    'docs/spec.md S§5.11 Retry policy, S§4.4 delivery',
  ],
  cases: retryCases,
});
