import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ensureDefaultProfile, migrate, openDatabase } from '@agentic-dasher/db';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { createApp } from './app.ts';
import { type AppEnv, createAuthService, sessionOf } from './auth/index.ts';
import { loadConfig } from './config.ts';
import { createChannelService, createNotifyRoutes } from './notify/index.ts';
import { createSecretBox, KEY_FILE_NAME, loadOrCreateKey } from './secrets/index.ts';
import { createSettingsService, userMarket } from './settings/index.ts';
import { createWatchRoutes, createWatchService } from './watches/index.ts';

const startedAt = Date.now();
const config = loadConfig();

mkdirSync(config.dataDir, { recursive: true });
const db = openDatabase(join(config.dataDir, 'agentic-dasher.db'));
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

const watches = createWatchService({ db, now, market: () => userMarket(settings) });

// Runtime (fetcher, scheduler, sweep, outbox, backup, watch lookup): NOT started here yet; the
// orchestrator wires ./runtime.ts createRuntime after this unit. Until then POST /api/refresh
// answers 500 (the error below), and the watch routes get no `jobs` health and no `onListingsDue`.
// Wiring: replace `refresh` with the scheduler's trigger, pass `jobs: () => scheduler.health()`,
// start the runtime after the server listens and stop it in shutdown().
function refresh(): never {
  throw new Error('the scheduler is not started in this build yet');
}

const api = createApp({
  version: config.version,
  startedAt,
  migrationLevel: migration.level,
  dbOk: () => db.ping(),
  rssBytes: () => process.memoryUsage.rss(),
  now,
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
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
