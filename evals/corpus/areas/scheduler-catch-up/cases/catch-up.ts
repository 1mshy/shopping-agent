import type { CatchUpCase, CatchUpInput, SchedulerJob } from '../contract.ts';

const SCH = 'pricewatch/src/pricewatch/scheduler.py';
const SVC = 'pricewatch/src/pricewatch/service.py';
const TS = 'pricewatch/tests/test_scheduler.py';
const TV = 'pricewatch/tests/test_service.py';
const APS =
  'APScheduler 3.11.3 (the predecessor venv): schedulers/base.py:1191-1228, coalesce keeps run_times[-1:], next = trigger.get_next_fire_time(run_times[-1], now)';
const SPEC_SCHED = {
  how: 'spec',
  ref: 'S§5.8 Scheduler: "missed slots coalesce into one catch-up on resume, and boot schedules a catch-up; … a second caller of a running job joins it."',
} as const;

const at = (hhmmss: string, day = '17') => `2026-11-${day}T${hhmmss}.000Z`;

// The price sweep on the predecessor's default cadence, settings.py pw_check_cron "*/30 * * * *".
const sweep = (nextRunAt: string): SchedulerJob => ({
  name: 'price_sweep',
  everyMs: 1_800_000,
  nextRunAt,
  deadlineMs: 900_000,
  networkGate: true,
});

function woken(
  wake: CatchUpInput['wake'],
  now: string,
  job: SchedulerJob,
  more: Partial<CatchUpInput> = {},
): CatchUpInput {
  return { now, wake, job, running: null, pendingRetryAt: null, ...more };
}

const DEADLINE =
  'deadlineMs (15 min) does not decide this case (the deadline cases are run-at-its-deadline-times-out and run-just-inside-its-deadline-is-joined).';
const SETTLED_DEADLINE = {
  how: 'ruling',
  ref: 'Settled by the orchestrator 2026-11-23, the owner may overrule (docs/progress.md): "a job that reaches its deadline ends as timed out keeping its partial results"',
} as const;

export const catchUpCases: readonly CatchUpCase[] = [
  {
    id: 'missed-slots-coalesce-into-one-catch-up',
    what: 'Waking 2 h 17 min late runs the sweep once for the five missed slots, and keeps the grid',
    input: woken('tick', at('11:47:00'), sweep(at('09:30:00'))),
    expected: {
      action: 'run',
      because: 'slot',
      coalescedSlots: 5,
      nextRunAt: at('12:00:00'),
      retryCleared: false,
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:54 test_scheduled_jobs_run_a_missed_slot_once_instead_of_dropping_it (misfire_grace_time None, coalesce True, max_instances 1)`,
      },
      { how: 'function-reading', ref: `${SCH}:79-85 _CATCH_UP` },
      {
        how: 'offline-run',
        ref: `${APS}: next 09:30, now 11:47 → 5 run times, one run (11:30), next 12:00`,
      },
      SPEC_SCHED,
    ],
    notes: `Slots 09:30, 10:00, 10:30, 11:00, 11:30. reports/2026-09-18-reliability.md: a 12 s Docker freeze across several 5 s ticks gave exactly one catch-up. ${DEADLINE}`,
  },
  {
    id: 'on-time-slot-runs-once',
    what: 'A tick just after its slot runs once and moves to the next slot',
    input: woken('tick', at('09:30:05'), sweep(at('09:30:00'))),
    expected: {
      action: 'run',
      because: 'slot',
      coalescedSlots: 1,
      nextRunAt: at('10:00:00'),
      retryCleared: false,
    },
    from: [
      { how: 'offline-run', ref: `${APS}: next 09:30, now 09:30:05 → 1 run time, next 10:00` },
    ],
    notes: DEADLINE,
  },
  {
    id: 'not-due-before-the-slot',
    what: 'One second before its slot the job waits',
    input: woken('tick', at('09:29:59'), sweep(at('09:30:00'))),
    expected: { action: 'wait', nextRunAt: at('09:30:00') },
    from: [{ how: 'offline-run', ref: `${APS}: next 09:30, now 09:29:59 → no run time` }],
    notes: DEADLINE,
  },
  {
    id: 'wake-exactly-on-a-slot-counts-that-slot',
    what: 'Waking exactly at 12:00 after missing 09:30-11:30 stands for six slots, and the next is 12:30',
    input: woken('tick', at('12:00:00'), sweep(at('09:30:00'))),
    expected: {
      action: 'run',
      because: 'slot',
      coalescedSlots: 6,
      nextRunAt: at('12:30:00'),
      retryCleared: false,
    },
    from: [
      {
        how: 'offline-run',
        ref: `${APS}: next 09:30, now 12:00:00 → 6 run times, one run (12:00), next 12:30`,
      },
    ],
    notes: DEADLINE,
  },
  {
    id: 'boot-runs-a-catch-up-with-nothing-missed',
    what: 'Process start runs the job once at once, even before its next slot, and keeps the slot',
    input: woken('boot', at('09:47:00'), sweep(at('10:00:00'))),
    expected: {
      action: 'run',
      because: 'boot',
      coalescedSlots: 0,
      nextRunAt: at('10:00:00'),
      retryCleared: false,
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:131 test_startup_runs_a_catchup_without_waiting_for_cron (one sweep at start; the cron job still scheduled)`,
      },
      {
        how: 'function-reading',
        ref: `${SCH}:378-382 start (cron job plus a "date" recovery job that runs now)`,
      },
      SPEC_SCHED,
    ],
    notes: `The predecessor's in-memory store forgot missed slots across a restart, so it always caught up on boot. ${DEADLINE}`,
  },
  {
    id: 'boot-after-missed-slots-runs-once',
    what: 'Booting after missed slots runs once in all, not a boot catch-up plus a slot catch-up',
    input: woken('boot', at('11:47:00'), sweep(at('09:30:00'))),
    expected: {
      action: 'run',
      because: 'boot',
      coalescedSlots: 5,
      nextRunAt: at('12:00:00'),
      retryCleared: false,
    },
    from: [
      SPEC_SCHED,
      {
        how: 'spec',
        ref: 'S§6 Sleep/restart gate: "overdue jobs run once"; plan Phase 1 exit, freeze test: "exactly one catch-up per job"',
      },
    ],
    specDerived: true,
    notes: `Added: a persisted next_run_at (S§5.8 "own, SQLite-backed") that is overdue at boot, which the predecessor never had (its job store was in memory). Slots 09:30-11:30 are 5; one run stands for them and for the boot catch-up. ${DEADLINE}`,
  },
  {
    id: 'second-caller-joins-the-running-job',
    what: 'A refresh asked for while the sweep runs joins that run instead of starting another',
    input: woken('caller', at('09:30:10'), sweep(at('10:00:00')), {
      running: { runId: 41, startedAt: at('09:30:00') },
    }),
    expected: { action: 'join', runId: 41 },
    from: [
      {
        how: 'test-assertion',
        ref: `${TV}:539 test_a_full_sweep_in_flight_is_joined_not_repeated (second == first, each listing read once)`,
      },
      {
        how: 'test-assertion',
        ref: `${TV}:571 test_disconnecting_first_caller_does_not_cancel_shared_sweep (calls == [None])`,
      },
      {
        how: 'function-reading',
        ref: `${SVC}:1015-1041 refresh_offers (asyncio.shield of the in-flight task)`,
      },
      SPEC_SCHED,
    ],
    notes: `After a wake the scheduler's catch-up and the host hook's POST /api/refresh arrived within seconds of each other (service.py:1019-1022). ${DEADLINE}`,
  },
  {
    id: 'retry-firing-while-the-job-runs-joins-it',
    what: 'A pending retry that fires while the daily check runs joins it; the check is not run twice',
    input: {
      now: at('07:41:00'),
      wake: 'retry',
      job: {
        name: 'recipe_check',
        everyMs: 86_400_000,
        nextRunAt: at('07:40:00', '18'),
        deadlineMs: 900_000,
        networkGate: true,
      },
      running: { runId: 77, startedAt: at('07:40:00') },
      pendingRetryAt: at('07:41:00'),
    },
    expected: { action: 'join', runId: 77 },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:183 test_the_daily_check_and_a_pending_retry_never_run_at_once (started == [True])`,
      },
      SPEC_SCHED,
    ],
    divergence:
      'The predecessor skipped the second start and returned at once (scheduler.py:182-184 "this start is skipped"; the test asserts it returns within 2 s while the first is blocked), and APScheduler skips a slot that fires while max_instances is reached. S§5.8 says a second caller joins the running job. Both run the check once.',
    notes:
      'Daily cadence 07:40 UTC (RECIPE_CHECK_CRON "40 7 * * *"); the 07:40 slot is running, so next_run_at is the next day\'s.',
  },
  {
    id: 'retry-does-not-move-the-cadence',
    what: 'The 60 s retry after a postponed sweep runs once and leaves the half-hour grid alone',
    input: woken('retry', at('09:31:08'), sweep(at('10:00:00')), {
      pendingRetryAt: at('09:31:08'),
    }),
    expected: {
      action: 'run',
      because: 'retry',
      coalescedSlots: 0,
      nextRunAt: at('10:00:00'),
      retryCleared: true,
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${TS}:155 test_network_outage_keeps_a_retry_scheduled_until_success (one retry job; the cron job untouched)`,
      },
      {
        how: 'function-reading',
        ref: `${SCH}:120-125 retry_sweep ("Keep a missed sweep pending without changing the user's regular cadence": a separate "date" job)`,
      },
      {
        how: 'spec',
        ref: 'S§5.8 Scheduler: network-dependent jobs "retry in 60 s without moving the cadence"',
      },
    ],
    notes: `The 09:30 slot was consumed by the attempt whose gate gave up at 09:30:08 (scheduler-network-gate), leaving a retry at 09:31:08. ${DEADLINE}`,
  },
  {
    id: 'retry-and-due-slot-run-once',
    what: 'A retry still pending when the next slot comes due is covered by that one run',
    input: woken('tick', at('10:00:30'), sweep(at('10:00:00')), { pendingRetryAt: at('09:59:00') }),
    expected: {
      action: 'run',
      because: 'slot',
      coalescedSlots: 1,
      nextRunAt: at('10:30:00'),
      retryCleared: true,
    },
    from: [
      {
        how: 'function-reading',
        ref: `${SCH}:136-144 sweep (a completed sweep removes the recovery job)`,
      },
      {
        how: 'function-reading',
        ref: `${SVC}:1027-1028 refresh_offers (a second full sweep joins the first)`,
      },
      SPEC_SCHED,
    ],
    specDerived: true,
    notes: `Added: a retry and a slot both due at one wake. In the predecessor they were two APScheduler jobs, and the second sweep joined the first through refresh_offers; the spec's "coalesce into one" and S§6 "overdue jobs run once" give one run. ${DEADLINE}`,
  },
  {
    id: 'run-at-its-deadline-times-out',
    what: 'A sweep that has run for its full 15 min deadline ends as timed out, keeping what it read',
    input: woken('caller', at('09:45:00'), sweep(at('10:00:00')), {
      running: { runId: 41, startedAt: at('09:30:00') },
    }),
    expected: { action: 'time_out', runId: 41, runStatus: 'timed_out', keepPartialResults: true },
    from: [
      SETTLED_DEADLINE,
      {
        how: 'spec',
        ref: 'S§5.8 Scheduler: "every job has an overlap lock, a deadline and a run row"',
      },
    ],
    specDerived: true,
    notes:
      "Added for the detail settled on 2026-11-23. now − startedAt = 09:45:00 − 09:30:00 = 900000 ms = deadlineMs: the deadline is reached, so the run ends `timed_out` instead of being joined, and the observations it already wrote stay (S§2.8 partial results). The predecessor's APScheduler jobs had no deadline (none was read).",
  },
  {
    id: 'run-just-inside-its-deadline-is-joined',
    what: 'One second before its deadline the sweep is still joined',
    input: woken('caller', at('09:44:59'), sweep(at('10:00:00')), {
      running: { runId: 41, startedAt: at('09:30:00') },
    }),
    expected: { action: 'join', runId: 41 },
    from: [SETTLED_DEADLINE, SPEC_SCHED],
    specDerived: true,
    notes:
      'Added beside run-at-its-deadline-times-out: now − startedAt = 899000 ms < 900000 ms, so the run is still within its deadline and a second caller joins it.',
  },
];
