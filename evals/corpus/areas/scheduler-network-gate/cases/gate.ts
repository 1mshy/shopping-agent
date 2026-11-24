import type { GateCase, GateInput, Probe } from '../contract.ts';

const SCH = 'pricewatch/src/pricewatch/scheduler.py';
const TS = 'pricewatch/tests/test_scheduler.py';
const TW = 'pricewatch/tests/test_wake_recover.py';
const SPEC_GATE = {
  how: 'spec',
  ref: 'S§5.8 Scheduler: "network-dependent jobs wait on a DNS gate (probes at 0/3/5/10/20/30 s), then retry in 60 s without moving the cadence"',
} as const;
const DELAYS = `${SCH}:72 NETWORK_PROBE_DELAYS = (0, 3, 5, 10, 20, 30), slept before each probe (101-117 network_ready)`;

const SETTLED_DELAYS = {
  how: 'ruling',
  ref: 'Settled by the orchestrator 2026-11-23, the owner may overrule (docs/progress.md): "probe timings are delays between probes as ported (offsets 0, 3, 8, 18, 38, 68 s)"',
} as const;

const START = '2026-11-17T09:30:00.000Z';
/** START plus whole seconds. */
const plus = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

const probe = (seconds: number, resolved: boolean): Probe => ({ at: plus(seconds), resolved });

function gate(probes: readonly Probe[], pendingRetryAt: string | null = null): GateInput {
  const last = probes[probes.length - 1];
  return {
    kind: 'gate',
    now: last ? last.at : START,
    gateStartedAt: START,
    probes,
    pendingRetryAt,
  };
}

/** Answers arriving at once: probes at 0, 3, 8, 18, 38 and 68 s (cumulative delays). */
const FAILED_AT = [0, 3, 8, 18, 38, 68] as const;
const failed = (n: number) => FAILED_AT.slice(0, n).map((s) => probe(s, false));

export const gateCases: readonly GateCase[] = [
  {
    id: 'first-probe-is-made-at-once',
    what: 'The gate probes DNS as soon as the run reaches it',
    input: gate([]),
    expected: { action: 'probe', at: START },
    from: [{ how: 'function-reading', ref: DELAYS }, SPEC_GATE],
  },
  {
    id: 'resolved-first-probe-runs-the-job',
    what: 'When DNS answers on the first probe, the job runs with no wait',
    input: gate([probe(0, true)]),
    expected: { action: 'run' },
    from: [
      {
        how: 'function-reading',
        ref: `${SCH}:104-116 network_ready (return True on the first resolved probe)`,
      },
      SPEC_GATE,
    ],
  },
  {
    id: 'after-a-failed-probe-wait-three-seconds',
    what: 'A failed first probe is followed by one three seconds later',
    input: gate(failed(1)),
    expected: { action: 'probe', at: plus(3) },
    from: [{ how: 'function-reading', ref: DELAYS }, SPEC_GATE],
  },
  {
    id: 'probe-waits-follow-the-delay-list',
    what: 'After failures at 0, 3 and 8 s the next probe is 10 s after the third',
    input: gate(failed(3)),
    expected: { action: 'probe', at: plus(18) },
    from: [{ how: 'function-reading', ref: DELAYS }, SPEC_GATE, SETTLED_DELAYS],
    notes:
      'The delays 3, 5, 10 are slept between probes, so probes fall at 0, 3, 8, 18 s (0 + 3 = 3, 3 + 5 = 8, 8 + 10 = 18); read as offsets from the start they would fall at 0, 3, 5, 10 s. The orchestrator settled on 2026-11-23 that they are delays as ported (the owner may overrule).',
  },
  {
    id: 'a-slow-failed-probe-pushes-the-next-one',
    what: 'A probe that times out after 5 s is followed by the next delay after its timeout, not after its start',
    input: gate([probe(5, false)]),
    expected: { action: 'probe', at: plus(8) },
    from: [
      {
        how: 'function-reading',
        ref: `${SCH}:56 NETWORK_PROBE_TIMEOUT = 5 and 104-113 (wait_for timeout, then the next iteration sleeps its delay)`,
      },
    ],
    specSilent: true,
    notes:
      'The probe started at 0 s and timed out at 5 s; the next is 3 s later, at 8 s. S§5.8 gives no probe timeout.',
  },
  {
    id: 'dns-back-on-the-third-probe-runs-the-job',
    what: 'Two failed probes then a resolved one: the job runs',
    input: gate([probe(0, false), probe(3, false), probe(8, true)]),
    expected: { action: 'run' },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:63 test_network_ready_waits_out_a_dns_blackout (gaierror, gaierror, [] → True)`,
      },
      SPEC_GATE,
    ],
    notes: 'The test sets every delay to 0; the 3 and 8 s here are the real delays.',
  },
  {
    id: 'five-failed-probes-leave-one-to-go',
    what: 'After five failed probes the gate makes a sixth, 30 s later',
    input: gate(failed(5)),
    expected: { action: 'probe', at: plus(68) },
    from: [{ how: 'function-reading', ref: DELAYS }, SPEC_GATE, SETTLED_DELAYS],
    notes: 'Probes at 0, 3, 8, 18, 38 s; the sixth is 38 + 30 = 68 s.',
  },
  {
    id: 'six-failed-probes-postpone-for-sixty-seconds',
    what: 'DNS still down after the sixth probe: the run is skipped and retried 60 s later',
    input: gate(failed(6)),
    expected: { action: 'postpone', runStatus: 'skipped', retryAt: plus(128) },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:77 test_network_ready_gives_up_when_dns_stays_down (→ False)`,
      },
      {
        how: 'test-assertion',
        ref: `${TS}:92 test_sweep_is_skipped_without_network_and_says_so (no refresh, last_skipped_at set)`,
      },
      {
        how: 'test-assertion',
        ref: `${TS}:155 test_network_outage_keeps_a_retry_scheduled_until_success (recovery_sweep_at set)`,
      },
      {
        how: 'function-reading',
        ref: `${SCH}:57 RECOVERY_DELAY_SECONDS = 60, 120-135 retry_sweep and sweep`,
      },
      SPEC_GATE,
    ],
    notes: 'Last probe at 68 s; retry at 68 + 60 = 128 s after the gate started.',
  },
  {
    id: 'postponed-retry-replaces-the-pending-one',
    what: 'A retry that again finds no network leaves one new retry, not two',
    input: gate(failed(6), START),
    expected: { action: 'postpone', runStatus: 'skipped', retryAt: plus(128) },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:155 test_network_outage_keeps_a_retry_scheduled_until_success (after two offline sweeps len(get_jobs()) == 1)`,
      },
      {
        how: 'test-assertion',
        ref: `${TS}:215 test_a_daily_recipe_check_without_network_is_postponed_not_dropped (one retry job after two offline checks)`,
      },
      { how: 'function-reading', ref: `${SCH}:123 retry_sweep (replace_existing=True)` },
    ],
    notes: "This run is the pending retry (due at the gate's start).",
  },
  {
    id: 'failed-run-retries-in-sixty-seconds',
    what: 'A run that failed with the network up is retried 60 s later, not dropped',
    input: { kind: 'run_ended', now: plus(40), status: 'failed', pendingRetryAt: null },
    expected: { action: 'retry_later', retryAt: plus(100) },
    from: [
      { how: 'function-reading', ref: `${SCH}:145-147 sweep (except: log, retry_sweep())` },
      {
        how: 'test-assertion',
        ref: `${TW}:57 test_failed_refresh_does_not_consume_catchup (catch_up_pending stays True)`,
      },
      { how: 'spec', ref: 'S§2 invariant 12: "nothing is silently dropped"' },
    ],
    notes:
      'The wake-recover test is the host agent\'s version of the same rule (its contract "moves in-process", S§7).',
  },
  {
    id: 'completed-run-clears-the-pending-retry',
    what: 'Once a run completes, the pending retry is dropped',
    input: { kind: 'run_ended', now: plus(40), status: 'completed', pendingRetryAt: plus(60) },
    expected: { action: 'done', retryCleared: true },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:155 test_network_outage_keeps_a_retry_scheduled_until_success (recovery_sweep_at None after the online sweep)`,
      },
      {
        how: 'test-assertion',
        ref: `${TS}:215 test_a_daily_recipe_check_without_network_is_postponed_not_dropped (retry job gone after the check)`,
      },
      {
        how: 'test-assertion',
        ref: `${TW}:42 test_dns_blackout_is_retried_next_interval_even_with_healthy_containers (catch_up_pending False after success, no further refresh)`,
      },
      { how: 'function-reading', ref: `${SCH}:141-144 sweep (remove_job(_RECOVERY_JOB_ID))` },
    ],
  },
];
