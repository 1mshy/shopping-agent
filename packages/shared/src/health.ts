import { z } from 'zod';
import { Timestamp } from './common.ts';
import { JobRunStatus, Rung } from './vocab.ts';

/** One scheduled job in health: counts and times only (S§5.8). */
export const HealthJob = z.object({
  name: z.string(),
  running: z.boolean(),
  /** The earliest slot not yet run. */
  nextRunAt: Timestamp.nullable(),
  lastRun: z
    .object({ status: JobRunStatus, startedAt: Timestamp, endedAt: Timestamp.nullable() })
    .nullable(),
  /** Runs skipped because the network was not there (the DNS gate). */
  skippedRuns: z.number().int().nonnegative(),
});
export type HealthJob = z.infer<typeof HealthJob>;

/** Response of `GET /api/health`. Public: the only API route without auth (S§5.13). */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeS: z.number().nonnegative(),
  db: z.enum(['ok', 'error']),
  /** The highest applied migration (S§5.14 Upgrades). */
  migrationLevel: z.number().int().nonnegative(),
  rssBytes: z.number().int().nonnegative(),
  /** The fetch rungs this build can use (S§5.8). */
  rungs: z.array(Rung),
  /** Last and next runs and skipped runs per scheduled job; empty until the scheduler runs. */
  jobs: z.array(HealthJob),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
