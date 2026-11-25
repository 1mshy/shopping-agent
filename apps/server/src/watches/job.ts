// The `watch-lookup` job: the durable work a saved watch waits for (S§2.9). Every minute it runs
// the queued lookups that are due (a new watch's, or a retry after a transient failure).
import type { JobDefinition } from '../scheduler/index.ts';
import type { WatchService } from './service.ts';

export const WATCH_LOOKUP_JOB_NAME = 'watch-lookup';

export interface WatchLookupJobOptions {
  readonly watches: WatchService;
  /** croner syntax, UTC. Every minute by default. */
  readonly cron?: string;
  readonly deadlineMs?: number;
}

/**
 * A product watch's lookup needs no network; a name's asks the discovery source, which does, so
 * the job waits on the DNS gate.
 */
export function watchLookupJob(options: WatchLookupJobOptions): JobDefinition {
  const { watches, cron = '* * * * *', deadlineMs = 5 * 60_000 } = options;
  return {
    name: WATCH_LOOKUP_JOB_NAME,
    cron,
    deadlineMs,
    networkGate: true,
    handler: async ({ signal }) => watches.runDueLookups(signal),
  };
}
