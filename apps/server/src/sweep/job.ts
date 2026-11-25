// The sweep as a scheduler job (S§5.8): every minute, the listings due now are checked with bounded
// concurrency. Each check writes its own rows as soon as it ends ("incremental writes"), so a slow
// store never delays another's. Hosts are paced by the fetcher, not here. On the job's AbortSignal
// no new check starts, checks in flight end as aborted (their listings stay due), and the run
// returns its counts; `context.report` carries the counts so far after every check, so a run that
// reaches its deadline keeps them.
import { type Database, schema } from '@agentic-dasher/db';
import { READ_FAILURE_CAUSES, type ReadFailureCause } from '@agentic-dasher/shared';
import { and, asc, isNotNull, lte, not, sql } from 'drizzle-orm';
import type { JobDefinition } from '../scheduler/index.ts';
import { type CheckResult, checkListing, type SweepDeps } from './check.ts';
import { errorSummary, stderrLogger } from './log.ts';
import { iso } from './policy.ts';
import { immediate, trackedSql } from './rows.ts';

export const SWEEP_JOB_NAME = 'sweep';
/** Checks in flight at once (different hosts proceed in parallel; one host is paced by the fetcher). */
export const DEFAULT_SWEEP_CONCURRENCY = 8;
/** Listings taken per run; the rest stay due for the next minute. */
export const DEFAULT_SWEEP_BATCH = 200;
/** Under the next slot's interval would be wrong for a 200-listing batch: 10 minutes. */
export const DEFAULT_SWEEP_DEADLINE_MS = 10 * 60_000;

export interface SweepCounts {
  /** Listings a check was started for. */
  checked: number;
  /** Per outcome kind: `read`, each READ_FAILURE_CAUSES value, `deferred`, `aborted`, `skipped`. */
  outcomes: Record<string, number>;
  /** Events recorded by evaluations in this run (new events only). */
  alertsRecorded: number;
  /** Observations a previous check left unevaluated and this run evaluated. */
  resumed: number;
  /** Checks that threw (a database error); their listings are left as they were. */
  errors: number;
  /** Listings no active watch tracks any more, whose next_check_at was cleared. */
  untracked: number;
  /** Listings still due when the run ended. */
  leftDue: number;
}

export interface SweepRunOptions {
  readonly signal?: AbortSignal;
  readonly report?: (partial: Record<string, unknown>) => void;
  readonly concurrency?: number;
  readonly batch?: number;
}

function emptyCounts(): SweepCounts {
  const outcomes: Record<string, number> = { read: 0, deferred: 0, aborted: 0, skipped: 0 };
  for (const cause of READ_FAILURE_CAUSES) outcomes[cause] = 0;
  return {
    checked: 0,
    outcomes,
    alertsRecorded: 0,
    resumed: 0,
    errors: 0,
    untracked: 0,
    leftDue: 0,
  };
}

/** Listings due at `nowIso` and tracked by an active watch, oldest due first. */
export function dueListingIds(db: Database, nowIso: string, limit: number): number[] {
  const lc = schema.listingCheck;
  return db.orm
    .select({ id: lc.listingId })
    .from(lc)
    .where(and(isNotNull(lc.nextCheckAt), lte(lc.nextCheckAt, nowIso), trackedSql(lc.listingId)))
    .orderBy(asc(lc.nextCheckAt), asc(lc.listingId))
    .limit(limit)
    .all()
    .map((r) => r.id);
}

/** Clears next_check_at of listings no active watch tracks (S§4.1: null while untracked). */
export function clearUntracked(db: Database): number {
  const lc = schema.listingCheck;
  return immediate(db, () =>
    db.orm
      .update(lc)
      .set({ nextCheckAt: null })
      .where(and(isNotNull(lc.nextCheckAt), not(trackedSql(lc.listingId))))
      .run(),
  ).changes;
}

function countDue(db: Database, nowIso: string): number {
  const lc = schema.listingCheck;
  const row = db.orm
    .select({ n: sql<number>`count(*)` })
    .from(lc)
    .where(and(isNotNull(lc.nextCheckAt), lte(lc.nextCheckAt, nowIso), trackedSql(lc.listingId)))
    .get();
  return row?.n ?? 0;
}

function tally(counts: SweepCounts, result: CheckResult): void {
  const o = result.outcome;
  const key = o.kind === 'failed' ? o.cause : o.kind;
  counts.outcomes[key] = (counts.outcomes[key] ?? 0) + 1;
  const evaluations = [...result.resumed, ...(o.kind === 'read' ? o.evaluations : [])];
  if (result.resumed.length > 0) counts.resumed += 1;
  for (const e of evaluations) {
    if (e.price?.created) counts.alertsRecorded += 1;
    if (e.restock?.created) counts.alertsRecorded += 1;
  }
}

/** One sweep: the due listings, checked with bounded concurrency. */
export async function runSweep(
  deps: SweepDeps,
  options: SweepRunOptions = {},
): Promise<SweepCounts> {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.logger ?? stderrLogger;
  const signal = options.signal ?? new AbortController().signal;
  const counts = emptyCounts();
  counts.untracked = clearUntracked(db);
  const startIso = iso(now());
  const due = dueListingIds(db, startIso, options.batch ?? DEFAULT_SWEEP_BATCH);
  const report = () => options.report?.({ ...counts, outcomes: { ...counts.outcomes } });

  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < due.length) {
      const listingId = due[next++] as number;
      counts.checked += 1;
      try {
        tally(counts, await checkListing(deps, listingId, { signal }));
      } catch (error) {
        counts.errors += 1;
        log({
          level: 'error',
          event: 'check_error',
          at: iso(now()),
          listingId,
          error: errorSummary(error),
        });
      }
      report();
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? DEFAULT_SWEEP_CONCURRENCY, due.length));
  await Promise.all(Array.from({ length: width }, worker));
  counts.leftDue = countDue(db, iso(now()));
  report();
  return counts;
}

export interface SweepJobOptions {
  readonly cron?: string;
  readonly deadlineMs?: number;
  readonly concurrency?: number;
  readonly batch?: number;
}

/** The sweep as a JobDefinition: every minute, behind the DNS gate. */
export function sweepJob(deps: SweepDeps, options: SweepJobOptions = {}): JobDefinition {
  return {
    name: SWEEP_JOB_NAME,
    cron: options.cron ?? '* * * * *',
    deadlineMs: options.deadlineMs ?? DEFAULT_SWEEP_DEADLINE_MS,
    networkGate: true,
    handler: async (context) => {
      const counts = await runSweep(deps, {
        signal: context.signal,
        report: (partial) => context.report(partial),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        ...(options.batch !== undefined ? { batch: options.batch } : {}),
      });
      return { ...counts };
    },
  };
}

export type { ReadFailureCause };
