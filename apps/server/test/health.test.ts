import { HealthResponse } from '@agentic-dasher/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { type Harness, harness } from './auth/harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

// The harness assembles the whole app (version 1.2.3, started 2.5 s before its clock, level 2,
// 42 bytes of RSS) on a temporary database. /api/health is open: no cookie, no headers.
function app(dbOk: boolean) {
  h = harness({ dbOk: () => dbOk });
  return h.app;
}

describe('GET /api/health', () => {
  it('reports ok with version, uptime and memory', async () => {
    const res = await app(true).request('/api/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({
      status: 'ok',
      version: '1.2.3',
      uptimeS: 2.5,
      db: 'ok',
      migrationLevel: 2,
      rssBytes: 42,
    });
  });

  it('returns 503 degraded when the database is down', async () => {
    const res = await app(false).request('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json())).toMatchObject({
      status: 'degraded',
      db: 'error',
    });
  });

  it('answers without a session even once a password is set', async () => {
    h = harness();
    await h.auth.setup('correct horse battery staple');
    expect((await h.app.request('/api/health')).status).toBe(200);
    const body = (await (await h.app.request('/api/health')).json()) as object;
    expect(Object.keys(body).sort()).toEqual([
      'db',
      'migrationLevel',
      'rssBytes',
      'status',
      'uptimeS',
      'version',
    ]);
  });
});
