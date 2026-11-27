import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ensureDefaultProfile, migrate, openDatabase } from '@agentic-dasher/db';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { createApp } from './app.ts';
import { type AppEnv, createAuthService, sessionOf } from './auth/index.ts';
import { loadConfig } from './config.ts';
import { createDirectoryDiscovery } from './directory/discover.ts';
import { createChannelService, createNotifyRoutes } from './notify/index.ts';
import { ownerOnlyDir, prepareDatabaseFile } from './ops/files.ts';
import { AVAILABLE_RUNGS, createRuntime } from './runtime.ts';
import { createSecretBox, KEY_FILE_NAME, loadOrCreateKey } from './secrets/index.ts';
import { createSettingsService, userMarket } from './settings/index.ts';
import { createWatchRoutes, createWatchService, watchLookupJob } from './watches/index.ts';

const startedAt = Date.now();
const config = loadConfig();
if (config.rejectedAllowedHosts.length > 0) {
  console.warn(
    `ALLOWED_HOSTS: ${config.rejectedAllowedHosts.length} entr${config.rejectedAllowedHosts.length === 1 ? 'y is' : 'ies are'} not a host name and ignored: ${config.rejectedAllowedHosts.map((e) => JSON.stringify(e.slice(0, 80))).join(', ')}`,
  );
}
if (config.allowedHosts.length > 0) {
  console.info(
    `answering for the host names ${config.allowedHosts.join(', ')} besides addresses and local names`,
  );
}

// The data directory and the database are for the user the server runs as (S§5.13).
ownerOnlyDir(config.dataDir);
const databaseFile = join(config.dataDir, 'agentic-dasher.db');
if (!prepareDatabaseFile(databaseFile)) {
  console.warn(
    'the database file could not be made owner-only; check who can read the data directory',
  );
}
const db = openDatabase(databaseFile);
// Migrations run at start-up (S§5.14). A database written by a newer build, or one whose recorded
// migrations differ from this build's, stops the start with the runner's error.
const migration = migrate(db);
ensureDefaultProfile(db);
if (migration.applied.length > 0) {
  console.info(`applied migrations ${migration.applied.join(', ')}; level ${migration.level}`);
}

// Secrets at rest (S§5.13): SECRET_KEY, else the key file in the data directory (created now on a
// first start). The key itself is never logged.
const secretKey = loadOrCreateKey({ dataDir: config.dataDir, env: process.env });
if (secretKey.source === 'created') {
  console.info(
    `created a new secrets key file (${KEY_FILE_NAME}) in the data directory; keep it with the database's backups`,
  );
}
const secrets = createSecretBox(secretKey.key);
const now = Date.now;

const settings = createSettingsService({ db, secrets, env: process.env });
for (const view of settings.list()) {
  // Names the variable, never its value (it may be a secret).
  if (view.problem === 'env_invalid') {
    console.warn(`setting ${view.key}: ${view.env} does not hold a valid value and is ignored`);
  }
}
const auth = createAuthService({ db, now });
auth.sweepExpired();
const channels = createChannelService({ db, secrets, now });

const background = createRuntime({
  deniedNetworks: config.deniedNetworks,
  db,
  dataDir: config.dataDir,
  secrets,
  market: () => userMarket(settings),
  robotsMode: () => settings.get('fetch.robots'),
  now,
});
const watches = createWatchService({
  db,
  now,
  market: () => userMarket(settings),
  discover: createDirectoryDiscovery({ db, now, fetcher: background.fetcher }),
  onListingsDue: () => {
    background.refresh();
  },
});
background.scheduler.register(watchLookupJob({ watches }));

/** `POST /api/refresh`: idempotent, because a running sweep is joined (S§5.8). */
function refresh(): { runId: number; joined: boolean } {
  const { runId, joined } = background.refresh();
  return { runId, joined };
}

const api = createApp({
  version: config.version,
  startedAt,
  migrationLevel: migration.level,
  dbOk: () => db.ping(),
  rssBytes: () => process.memoryUsage.rss(),
  now,
  rungs: AVAILABLE_RUNGS,
  allowedHosts: config.allowedHosts,
  jobs: () =>
    background.jobs().map((job) => ({
      name: job.name,
      running: job.running,
      nextRunAt: job.nextRunAt,
      lastRun:
        job.lastRun === null
          ? null
          : {
              status: job.lastRun.status,
              startedAt: job.lastRun.startedAt,
              endedAt: job.lastRun.endedAt,
            },
      skippedRuns: job.skippedRuns,
    })),
  auth,
  settings,
  routes: {
    notify: createNotifyRoutes({
      channels,
      profileId: (c) => sessionOf(c as Context<AppEnv>).profileId,
    }),
    watches: createWatchRoutes({
      db,
      watches,
      refresh,
      jobs: () => background.jobs(),
      now,
      marketCountry: () => settings.get('market.country') ?? null,
      profileId: (c) => sessionOf(c as Context<AppEnv>).profileId,
    }),
  },
});

const app = new Hono().route('/', api);

// Static SPA (production image). In development Vite serves the UI and proxies /api here.
const indexHtml = join(config.webRoot, 'index.html');
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8');
  app.use('/*', serveStatic({ root: relative(process.cwd(), config.webRoot) }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(html)));
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.info(
    `agentic-dasher ${config.version} listening on :${info.port} (ready in ${Date.now() - startedAt} ms)`,
  );
  // After the port answers, so start-to-healthy does not wait on the boot catch-up of the jobs.
  background.start();
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  // The scheduler first: it aborts running jobs and ends their rows, then the database closes.
  void background
    .stop()
    .catch((error: unknown) => {
      console.error(
        `stopping the scheduler: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
