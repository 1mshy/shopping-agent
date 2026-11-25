// The sweep engine (S§5.8): one listing's check, alert evaluation after each read, the sweep job.
// No model anywhere (S§2 invariant 4).
export {
  type CheckOptions,
  type CheckOutcome,
  type CheckResult,
  checkListing,
  type ReadListingFn,
  type SweepDeps,
} from './check.ts';
export {
  type EvaluationContext,
  evaluateObservation,
  type HeldReason,
  type RuleResult,
  type WatchEvaluation,
} from './evaluate.ts';
export {
  CODE_ONLY_VERSIONS,
  identityOf,
  type ListingIdentityVerdict,
  listingIdentityOf,
  type VerdictVersions,
} from './identity.ts';
export {
  DEFAULT_SWEEP_BATCH,
  DEFAULT_SWEEP_CONCURRENCY,
  DEFAULT_SWEEP_DEADLINE_MS,
  dueListingIds,
  runSweep,
  SWEEP_JOB_NAME,
  type SweepCounts,
  type SweepJobOptions,
  type SweepRunOptions,
  sweepJob,
} from './job.ts';
export { type SweepLogger, type SweepLogRecord, stderrLogger } from './log.ts';
export * from './policy.ts';
export {
  type AlertState,
  type ListingState,
  listingState,
  type WatchListingState,
  type WatchState,
  watchState,
} from './state.ts';
