import { defineArea } from '../../harness.ts';
import { gateCases } from './cases/gate.ts';
import type { GateCase } from './contract.ts';

const PREDECESSOR =
  'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db12684598a1c662f6e4292ba273c2b528592a (51db126), working tree with uncommitted files as read on 2026-11-18; the owner has not yet confirmed this is the reference copy';

export const area = defineArea<GateCase>({
  id: 'scheduler-network-gate',
  status: 'pending',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/scheduler.py: NETWORK_PROBE_TIMEOUT, RECOVERY_DELAY_SECONDS, NETWORK_PROBE_DELAYS (56-72), network_ready (101-117), retry_sweep (120-125), sweep (128-147), check_recipes (175-205)',
    'pricewatch/tests/test_scheduler.py: network_ready, skipped sweep, outage retry, recipe postponement',
    'pricewatch/tests/test_wake_recover.py: test_dns_blackout_is_retried_next_interval_even_with_healthy_containers, test_failed_refresh_does_not_consume_catchup',
    'reports/2026-09-18-reliability.md ("an unavailable DNS resolver causes a bounded wait and a retry sixty seconds later, without moving the normal cron")',
    'docs/spec.md S§5.8 Scheduler, S§2 invariant 12',
  ],
  cases: gateCases,
});
