// Queries over `job` and `job_run` (S§4.4; migration 0002's design note in docs/progress.md). The
// overlap lock is the job's open run: the partial unique index job_run_open_idx allows one row
// with ended_at NULL per job, so inserting a running row is taking the lock and ending the row is
// releasing it. The scheduler runs every read-decide-write step in an IMMEDIATE transaction, so
// two processes on one database file decide one after the other.
import { type Database, schema } from '@agentic-dasher/db';
import type { JobRunReason, JobRunStatus } from '@agentic-dasher/shared';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';

const { job, jobRun } = schema;

export type JobRow = typeof job.$inferSelect;
export type RunRow = typeof jobRun.$inferSelect;
export type Detail = Record<string, unknown>;

/**
 * Runs `fn` in a `BEGIN IMMEDIATE` transaction: the write lock is taken before the first read, so
 * no other connection can change the job between this decision's read and its write.
 */
export function immediate<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
  return result;
}

export function jobByName(db: Database, name: string): JobRow | undefined {
  return db.orm.select().from(job).where(eq(job.name, name)).get();
}

export function jobById(db: Database, id: number): JobRow | undefined {
  return db.orm.select().from(job).where(eq(job.id, id)).get();
}

export function insertJob(db: Database, values: Omit<typeof job.$inferInsert, 'id'>): number {
  const row = db.orm.insert(job).values(values).returning({ id: job.id }).get();
  if (!row) throw new Error(`job ${values.name} was not inserted`);
  return row.id;
}

export function updateJob(
  db: Database,
  id: number,
  values: Partial<Omit<typeof job.$inferInsert, 'id' | 'name'>>,
): void {
  db.orm.update(job).set(values).where(eq(job.id, id)).run();
}

/** The job's open run (its lock holder), if any. */
export function openRunOf(db: Database, jobId: number): RunRow | undefined {
  return db.orm
    .select()
    .from(jobRun)
    .where(and(eq(jobRun.jobId, jobId), isNull(jobRun.endedAt)))
    .get();
}

export function openRuns(db: Database): RunRow[] {
  return db.orm.select().from(jobRun).where(isNull(jobRun.endedAt)).all();
}

export function runById(db: Database, id: number): RunRow | undefined {
  return db.orm.select().from(jobRun).where(eq(jobRun.id, id)).get();
}

/** Takes the job's lock: refused by job_run_open_idx while another run of the job is open. */
export function insertRun(
  db: Database,
  values: {
    jobId: number;
    startedAt: string;
    reason: JobRunReason;
    coalescedSlots: number;
    detail: Detail;
  },
): number {
  const row = db.orm
    .insert(jobRun)
    .values({ ...values, status: 'running', endedAt: null })
    .returning({ id: jobRun.id })
    .get();
  if (!row) throw new Error(`run of job ${values.jobId} was not inserted`);
  return row.id;
}

/** Ends an open run (releasing the lock). False when it had already ended. */
export function endRun(
  db: Database,
  id: number,
  status: Exclude<JobRunStatus, 'running'>,
  endedAt: string,
  detail: Detail | null,
): boolean {
  const result = db.orm
    .update(jobRun)
    .set({ status, endedAt, detail })
    .where(and(eq(jobRun.id, id), isNull(jobRun.endedAt)))
    .run();
  return result.changes === 1;
}

/** Replaces an open run's detail (partial results, the owner's heartbeat). */
export function setOpenRunDetail(db: Database, id: number, detail: Detail): void {
  db.orm
    .update(jobRun)
    .set({ detail })
    .where(and(eq(jobRun.id, id), isNull(jobRun.endedAt)))
    .run();
}

/** Stamps the heartbeat on every open run this scheduler instance owns. */
export function heartbeat(db: Database, instance: string, at: string): void {
  db.orm.run(
    sql`update job_run set detail_json = json_set(detail_json, '$.heartbeatAt', ${at})
        where ended_at is null and json_extract(detail_json, '$.instance') = ${instance}`,
  );
}

/** True when a run has stood for the one-off slot at `slotAt` (it counted that slot). */
export function oneOffSpent(db: Database, jobId: number, slotAt: string): boolean {
  const row = db.orm
    .select({ id: jobRun.id })
    .from(jobRun)
    .where(
      and(eq(jobRun.jobId, jobId), gte(jobRun.coalescedSlots, 1), gte(jobRun.startedAt, slotAt)),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export function lastRunOf(db: Database, jobId: number): RunRow | undefined {
  return db.orm
    .select()
    .from(jobRun)
    .where(eq(jobRun.jobId, jobId))
    .orderBy(desc(jobRun.startedAt), desc(jobRun.id))
    .limit(1)
    .get();
}

export function skippedRunsOf(db: Database, jobId: number): number {
  const row = db.orm
    .select({ n: count() })
    .from(jobRun)
    .where(and(eq(jobRun.jobId, jobId), eq(jobRun.status, 'skipped')))
    .get();
  return row?.n ?? 0;
}
