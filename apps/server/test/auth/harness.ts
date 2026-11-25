// Shared by the auth, settings and app tests: the assembled app on a real temporary SQLite file,
// a fake clock, cheap argon2 parameters, and request helpers. Nothing here talks to the network.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Database, ensureDefaultProfile, migrate, openDatabase } from '@agentic-dasher/db';
import type { Context } from 'hono';
import { createApp } from '../../src/app.ts';
import {
  type AppEnv,
  type Argon2Params,
  createAuthService,
  createLoginThrottle,
  type LoginThrottle,
  sessionOf,
  type ThrottleOptions,
} from '../../src/auth/index.ts';
import { createChannelService, createNotifyRoutes } from '../../src/notify/index.ts';
import { createSecretBox } from '../../src/secrets/index.ts';
import {
  createSettingsService,
  SETTING_DEFINITIONS,
  type SettingDefinitions,
  userMarket,
} from '../../src/settings/index.ts';
import { createWatchRoutes, createWatchService } from '../../src/watches/index.ts';

export const T0 = Date.parse('2026-11-25T09:30:00.000Z');

/** Cheap argon2id parameters for tests (the real ones are measured once in password.test.ts). */
export const CHEAP: Argon2Params = {
  memoryKiB: 64,
  passes: 1,
  parallelism: 1,
  tagBytes: 32,
  saltBytes: 16,
};

export const PASSWORD = 'correct horse battery staple';
export const OTHER_PASSWORD = 'a different long passphrase';

export class Clock {
  t: number;
  constructor(t = T0) {
    this.t = t;
  }
  readonly now = () => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

export class TempDb {
  readonly dir = mkdtempSync(join(tmpdir(), 'dasher-auth-'));
  readonly file = join(this.dir, 'agentic-dasher.db');
  readonly db: Database;
  constructor() {
    this.db = openDatabase(this.file);
    migrate(this.db);
    ensureDefaultProfile(this.db);
  }
  dispose(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const TEST_KEY = Buffer.alloc(32, 7);

/** A recognisable stand-in for a secret setting's value (not a real credential). */
export const TEMP_SECRET = 'test-secret-value-0123456789abcdef';

export interface Harness {
  readonly temp: TempDb;
  readonly db: Database;
  readonly clock: Clock;
  readonly auth: ReturnType<typeof createAuthService>;
  readonly settings: ReturnType<typeof createSettingsService>;
  readonly app: ReturnType<typeof createApp>;
  dispose(): void;
}

export interface HarnessOptions {
  readonly env?: Record<string, string | undefined>;
  readonly argon2?: Argon2Params;
  readonly throttle?: Omit<ThrottleOptions, 'now'>;
  readonly dbOk?: () => boolean;
  readonly definitions?: SettingDefinitions;
  /** Host names the app answers for besides addresses and local names (ALLOWED_HOSTS). */
  readonly allowedHosts?: readonly string[];
}

export function harness(options: HarnessOptions = {}): Harness {
  const temp = new TempDb();
  const { db } = temp;
  const clock = new Clock();
  const secrets = createSecretBox(TEST_KEY);
  const throttle: LoginThrottle = createLoginThrottle({ now: clock.now, ...options.throttle });
  const auth = createAuthService({ db, now: clock.now, argon2: options.argon2 ?? CHEAP, throttle });
  const settings = createSettingsService({
    db,
    secrets,
    env: options.env ?? {},
    definitions: (options.definitions ?? SETTING_DEFINITIONS) as typeof SETTING_DEFINITIONS,
  });
  const channels = createChannelService({ db, secrets, now: clock.now });
  const app = createApp({
    version: '1.2.3',
    startedAt: T0 - 2_500,
    migrationLevel: 2,
    now: clock.now,
    dbOk: options.dbOk ?? (() => db.ping()),
    rssBytes: () => 42,
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    auth,
    settings,
    routes: {
      notify: createNotifyRoutes({
        channels,
        profileId: (c) => sessionOf(c as Context<AppEnv>).profileId,
      }),
      watches: createWatchRoutes({
        db,
        watches: createWatchService({ db, now: clock.now, market: () => userMarket(settings) }),
        refresh: () => ({ runId: 1, joined: false }),
        now: clock.now,
        profileId: (c) => sessionOf(c as Context<AppEnv>).profileId,
      }),
    },
  });
  return { temp, db, clock, auth, settings, app, dispose: () => temp.dispose() };
}

/** Headers of a same-origin JSON request from the SPA at http://localhost. */
export const SAME_ORIGIN: Record<string, string> = {
  Origin: 'http://localhost',
  'Content-Type': 'application/json',
};

/** Node's request bindings, so the app sees a socket address. */
export function fromAddress(remoteAddress: string) {
  return { incoming: { socket: { remoteAddress } } };
}

export interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly headers?: Record<string, string>;
  readonly address?: string;
  /** Defaults to http://localhost. */
  readonly origin?: string;
}

/** One request to the app. A body is sent as JSON with same-origin headers unless overridden. */
export function call(app: Harness['app'], path: string, options: CallOptions = {}) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const base = options.origin ?? 'http://localhost';
  const headers: Record<string, string> = {};
  if (method !== 'GET' && method !== 'HEAD') {
    Object.assign(headers, SAME_ORIGIN, { Origin: base });
  }
  if (options.cookie !== undefined) headers.Cookie = `dasher_session=${options.cookie}`;
  Object.assign(headers, options.headers ?? {});
  for (const [k, v] of Object.entries(headers)) if (v === '') delete headers[k];
  return app.request(
    `${base}${path}`,
    {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    fromAddress(options.address ?? '192.0.2.10'),
  );
}

/** The session token of a Set-Cookie answer, or undefined. */
export function tokenOf(res: Response): string | undefined {
  const header = res.headers.get('set-cookie') ?? '';
  const match = /(?:^|,\s*)dasher_session=([^;]*)/.exec(header);
  return match?.[1] === '' ? undefined : match?.[1];
}

/** Sets the owner password through the API and returns the session token. */
export async function setUp(h: Harness, password = PASSWORD): Promise<string> {
  const res = await call(h.app, '/api/auth/setup', { body: { password } });
  if (res.status !== 201) throw new Error(`setup answered ${res.status}`);
  const token = tokenOf(res);
  if (token === undefined) throw new Error('setup set no cookie');
  return token;
}
