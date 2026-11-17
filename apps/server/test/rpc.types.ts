// Day-one check that Hono RPC inference survives TypeScript 7 (plan P0 workstream 1).
// Checked by `tsc` only (not a Vitest file). If this stops compiling, fall back to TS 6.x.
import type { HealthResponse } from '@shopping-agent/shared';
import { hc, type InferResponseType } from 'hono/client';
import type { AppType } from '../src/app.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const client = hc<AppType>('http://localhost');
type Health = InferResponseType<typeof client.api.health.$get>;

export type _Status = Expect<Equal<Health['status'], HealthResponse['status']>>;
export type _Db = Expect<Equal<Health['db'], HealthResponse['db']>>;
export type _Version = Expect<Equal<Health['version'], string>>;
