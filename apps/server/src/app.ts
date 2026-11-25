// The HTTP surface. Kept free of Node-only imports so `apps/web` can import `AppType`
// for the Hono RPC client; runtime dependencies are passed in.
import type { HealthResponse } from '@agentic-dasher/shared';
import { Hono } from 'hono';

export interface AppDeps {
  version: string;
  startedAt: number;
  /** The database's migration level after start-up ran the migrations (S§5.14). */
  migrationLevel: number;
  dbOk: () => boolean;
  rssBytes: () => number;
  now?: () => number;
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;

  return new Hono().basePath('/api').get('/health', (c) => {
    const db = deps.dbOk() ? 'ok' : 'error';
    const body: HealthResponse = {
      status: db === 'ok' ? 'ok' : 'degraded',
      version: deps.version,
      uptimeS: Math.max(0, (now() - deps.startedAt) / 1000),
      db,
      migrationLevel: deps.migrationLevel,
      rssBytes: deps.rssBytes(),
    };
    return c.json(body, db === 'ok' ? 200 : 503);
  });
}

export type AppType = ReturnType<typeof createApp>;
