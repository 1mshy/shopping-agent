// The HTTP surface of /api. Runtime dependencies (database-backed services, sub-apps) are passed
// in, so `apps/web` can import `AppType` for the Hono RPC client and tests can assemble the app on
// a temporary database.
//
// Assembly, in order:
//   1. the session and CSRF middleware (auth/guard.ts) on every /api request. It runs first, and
//      its OPEN_ROUTES allow-list is the only way a route is reachable without a session, so a
//      route mounted anywhere below is protected by default;
//   2. request-body limits;
//   3. /api/health (open; output unchanged), the auth routes, the first-run status;
//   4. the protected sub-apps: settings, then `deps.routes` (notify's channels, the watches). A
//      further sub-app adds its own field to ProtectedRoutes and one `.route` line below.
import type { CookieSecureMode, HealthJob, HealthResponse, Rung } from '@agentic-dasher/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { clientAddress } from './auth/client.ts';
import { createGuard } from './auth/guard.ts';
import { type AppEnv, apiError } from './auth/http.ts';
import { createAuthRoutes } from './auth/routes.ts';
import type { AuthService } from './auth/types.ts';
import type { NotifyRoutes } from './notify/routes.ts';
import { createSettingsRoutes, createSetupRoutes } from './settings/routes.ts';
import type { SettingsService } from './settings/service.ts';
import type { WatchRoutes } from './watches/routes.ts';

/** The largest request body any /api route reads. */
export const API_BODY_LIMIT_BYTES = 64 * 1024;
/** The largest body of an auth route (a password is at most 256 characters). */
export const AUTH_BODY_LIMIT_BYTES = 4 * 1024;

/**
 * The feature sub-apps mounted under /api behind the session middleware. Each is a typed Hono
 * sub-app, so the RPC client (apps/web) sees its routes through `AppType`. To add one: a readonly
 * field here typed by its factory's return type, and a `.route('/', deps.routes.<field>)` line in
 * createApp; its paths are relative to /api. Nothing else is needed for it to be protected.
 */
export interface ProtectedRoutes {
  /** Channels: /api/channels… (notify/routes.ts, createNotifyRoutes). */
  readonly notify: NotifyRoutes;
  /**
   * Watches, listings, refresh, the in-app feed and diagnostics: /api/watches…, /api/listings…,
   * /api/refresh, /api/notifications, /api/diagnostics/… (watches/routes.ts, createWatchRoutes).
   */
  readonly watches: WatchRoutes;
}

export interface AppDeps {
  version: string;
  startedAt: number;
  /** The database's migration level after start-up ran the migrations (S§5.14). */
  migrationLevel: number;
  dbOk: () => boolean;
  rssBytes: () => number;
  now?: () => number;
  /** The fetch rungs this build can use; none when the runtime is not built (tests). */
  rungs?: readonly Rung[];
  /** The scheduler's jobs, for health; absent when the runtime is not built (tests). */
  jobs?: () => readonly HealthJob[];
  /** Owner password and sessions (auth/service.ts). */
  auth: AuthService;
  /** Settings (settings/service.ts). */
  settings: SettingsService;
  routes: ProtectedRoutes;
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const { auth, settings } = deps;
  const trustProxy = () => settings.get('auth.trustProxy');
  const cookieSecure = (): CookieSecureMode => settings.get('auth.cookieSecure');
  const tooLarge = bodyLimit({
    maxSize: API_BODY_LIMIT_BYTES,
    onError: (c) => c.json(apiError('payload_too_large', 'the request body is too large'), 413),
  });
  const authTooLarge = bodyLimit({
    maxSize: AUTH_BODY_LIMIT_BYTES,
    onError: (c) => c.json(apiError('payload_too_large', 'the request body is too large'), 413),
  });

  return (
    new Hono<AppEnv>()
      .basePath('/api')
      .use('*', createGuard({ auth, trustProxy }))
      .use('*', tooLarge)
      .use('/auth/*', authTooLarge)
      .get('/health', (c) => {
        const db = deps.dbOk() ? 'ok' : 'error';
        const body: HealthResponse = {
          status: db === 'ok' ? 'ok' : 'degraded',
          version: deps.version,
          uptimeS: Math.max(0, (now() - deps.startedAt) / 1000),
          db,
          migrationLevel: deps.migrationLevel,
          rssBytes: deps.rssBytes(),
          rungs: [...(deps.rungs ?? [])],
          jobs: [...(deps.jobs?.() ?? [])],
        };
        return c.json(body, db === 'ok' ? 200 : 503);
      })
      .route(
        '/auth',
        createAuthRoutes({
          auth,
          clientAddress: (c) => clientAddress(c, trustProxy()),
          cookieSecure,
          trustProxy,
        }),
      )
      .route(
        '/setup',
        createSetupRoutes({
          passwordSet: () => auth.passwordSet(),
          isSet: (key) => settings.isSet(key),
        }),
      )
      // Protected from here on (and above, except what OPEN_ROUTES lists).
      .route('/settings', createSettingsRoutes(settings))
      .route('/', deps.routes.notify)
      .route('/', deps.routes.watches)
  );
}

export type AppType = ReturnType<typeof createApp>;
