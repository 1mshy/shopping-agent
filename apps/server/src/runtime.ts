// The server's background runtime: the one fetcher of the process, and the scheduler with its
// jobs (S§5.8). Built once at start-up and stopped at shutdown. Nothing here calls a model
// (S§2 invariant 4): the sweep, alert evaluation and delivery are code only.
import { join } from 'node:path';
import type { Database } from '@agentic-dasher/db';
import {
  CookieJars,
  classifyResponse,
  createFetcher,
  createHttpNetwork,
  dropsSession,
  type Fetcher,
  type HttpNetwork,
  type OwnNetwork,
  type RobotsMode,
  sessionSite,
  sqlitePacingStore,
  sqlitePlaybookStore,
} from '@agentic-dasher/fetch';
import type { Market } from '@agentic-dasher/sources';
import { OUTBOX_JOB_NAME, outboxJob } from './notify/index.ts';
import { BACKUP_JOB_NAME, backupJob } from './ops/backup.ts';
import {
  createScheduler,
  type JobDefinition,
  type JobHealth,
  type Scheduler,
  type SchedulerOptions,
  type TriggerResult,
} from './scheduler/index.ts';
import type { SecretBox } from './secrets/index.ts';
import { SWEEP_JOB_NAME, type SweepDeps, sweepJob } from './sweep/index.ts';

/** The fetch rungs this build has (S§5.8 health). The browser rung arrives with its add-on. */
export const AVAILABLE_RUNGS = ['api', 'http'] as const;

export interface RuntimeOptions {
  readonly db: Database;
  /** The data directory; backups go to `<dataDir>/backups`. */
  readonly dataDir: string;
  readonly secrets: SecretBox;
  /** The user's market from settings; null until the locale step is done. */
  readonly market: () => Market | null;
  /** The robots setting (default `ignore`, owner decision 4). */
  readonly robotsMode: () => RobotsMode;
  /** The check interval setting in ms; null for the default. */
  readonly checkIntervalMs?: () => number | null;
  readonly now?: () => number;
  /** For tests: a scripted network instead of the real one. */
  readonly network?: HttpNetwork;
  readonly deniedNetworks?: readonly OwnNetwork[];
  /** For tests: the scheduler's timers and probe. */
  readonly scheduler?: Partial<Pick<SchedulerOptions, 'timers' | 'probe'>>;
  /** Further jobs (the watch lookup); registered beside the built-in ones. */
  readonly jobs?: (context: { readonly fetcher: Fetcher }) => readonly JobDefinition[];
  /** Further sweep dependencies (a logger, scripted reads in tests). */
  readonly sweep?: Partial<Omit<SweepDeps, 'db' | 'fetcher' | 'market'>>;
  readonly onError?: (error: unknown, context: string) => void;
}

export interface Runtime {
  readonly fetcher: Fetcher;
  readonly scheduler: Scheduler;
  /** Registers the jobs' rows, ends runs a dead process left, and schedules the boot catch-up. */
  start(): void;
  stop(): Promise<void>;
  /** `POST /api/refresh`: a sweep now. A sweep already running is joined, so it is idempotent. */
  refresh(): TriggerResult;
  /** Per job: last and next run, skipped runs (S§5.8 health, Diagnostics). */
  jobs(): readonly JobHealth[];
}

export const JOB_NAMES = [SWEEP_JOB_NAME, OUTBOX_JOB_NAME, BACKUP_JOB_NAME] as const;

/**
 * The process's fetcher with the HTTP rung's session drop: a walled answer clears that site's
 * cookies (S§5.1 Sessions), so the bot manager's verdict does not stick to the next request.
 *
 * The site that was asked is forgotten (S§5.1: its hosts, and its parent-domain cookies held
 * elsewhere), which covers a redirect that stayed inside that site. A wall answered by another
 * site after a redirect clears nothing there: a page chooses where it redirects, and must not be
 * able to end the session of a shop it names (the fetch reviews of 2026-11-25). The price is that
 * a third-party wall's own cookie stays until it expires or its jar is dropped.
 */
export function fetcherWithSessionDrop(fetcher: Fetcher, jars: CookieJars): Fetcher {
  return {
    ...fetcher,
    async get(request) {
      const result = await fetcher.get(request);
      if (dropsSession(result.outcome)) {
        const asked = sessionSite(request.url);
        if (asked !== null) jars.forget(asked);
      }
      return result;
    },
  };
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const now = options.now ?? Date.now;
  const onError =
    options.onError ??
    ((error: unknown, context: string) => {
      console.error(`${context}: ${error instanceof Error ? error.message : String(error)}`);
    });

  const jars = new CookieJars();
  const fetcher = fetcherWithSessionDrop(
    createFetcher({
      network: options.network ?? createHttpNetwork({ now }),
      jars,
      classify: classifyResponse,
      ...(options.deniedNetworks ? { deniedNetworks: options.deniedNetworks } : {}),
      pacing: sqlitePacingStore(options.db),
      playbook: sqlitePlaybookStore(options.db),
      robotsMode: options.robotsMode,
      now,
      onStoreError: (error) => onError(error, 'fetch store'),
    }),
    jars,
  );

  const scheduler = createScheduler({
    db: options.db,
    now,
    ...options.scheduler,
    onError: (error) => onError(error, 'scheduler'),
  });

  scheduler.register(
    sweepJob({
      ...options.sweep,
      db: options.db,
      fetcher,
      now,
      market: options.market,
      ...(options.checkIntervalMs ? { checkIntervalMs: options.checkIntervalMs } : {}),
    }),
  );
  scheduler.register(outboxJob({ db: options.db, secrets: options.secrets, now, onError }));
  scheduler.register(backupJob({ db: options.db, dir: join(options.dataDir, 'backups'), now }));
  for (const job of options.jobs?.({ fetcher }) ?? []) scheduler.register(job);

  return {
    fetcher,
    scheduler,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
    refresh: () => scheduler.trigger(SWEEP_JOB_NAME),
    jobs: () => scheduler.health(),
  };
}
