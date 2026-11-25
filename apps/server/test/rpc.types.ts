// Day-one check that Hono RPC inference survives TypeScript 7 (plan P0 workstream 1), extended to
// the assembled app: an open route, a protected sub-app (settings), the auth routes and a sub-app
// handed in through `deps.routes` (notify). Checked by `tsc` only (not a Vitest file). If this stops
// compiling, fall back to TS 6.x.
import type { HealthResponse, SettingSource } from '@agentic-dasher/shared';
import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import type { AppType } from '../src/app.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const client = hc<AppType>('http://localhost');
type Health = InferResponseType<typeof client.api.health.$get>;

export type _Status = Expect<Equal<Health['status'], HealthResponse['status']>>;
export type _Db = Expect<Equal<Health['db'], HealthResponse['db']>>;
export type _Version = Expect<Equal<Health['version'], string>>;

// A protected route: GET /api/settings.
type Settings = InferResponseType<typeof client.api.settings.$get, 200>;
type SettingItem = Settings['settings'][number];
export type _SettingKey = Expect<Equal<SettingItem['key'], string>>;
export type _SettingSource = Expect<Equal<SettingItem['source'], SettingSource | null>>;
export type _SettingSecret = Expect<Equal<SettingItem['secret'], boolean>>;

// A protected route with a parameter: PUT /api/settings/:key.
type PutSetting = InferRequestType<(typeof client.api.settings)[':key']['$put']>;
export type _PutParam = Expect<Equal<PutSetting['param'], { key: string }>>;

// The open auth routes.
type Status = InferResponseType<typeof client.api.auth.status.$get>;
export type _AuthStatus = Expect<Equal<Status, { passwordSet: boolean; signedIn: boolean }>>;
type Setup = InferResponseType<typeof client.api.setup.$get>;
export type _SetupSteps = Expect<Equal<Setup, { password: boolean; locale: boolean }>>;

// A sub-app handed in through deps.routes keeps its types: GET /api/channels.
type Channels = InferResponseType<typeof client.api.channels.$get>;
export type _ChannelHasSecret = Expect<Equal<Channels['channels'][number]['hasSecret'], boolean>>;

// The watch routes, handed in the same way: POST /api/refresh.
type Watches = InferResponseType<typeof client.api.watches.$get, 200>;
export type _WatchesIsKnown = Expect<Equal<unknown extends Watches ? false : true, true>>;
