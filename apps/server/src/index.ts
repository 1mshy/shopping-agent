import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ensureDefaultProfile, migrate, openDatabase } from '@agentic-dasher/db';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

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

const api = createApp({
  version: config.version,
  startedAt,
  migrationLevel: migration.level,
  dbOk: () => db.ping(),
  rssBytes: () => process.memoryUsage.rss(),
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
