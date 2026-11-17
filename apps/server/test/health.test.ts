import { HealthResponse } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

function app(dbOk: boolean) {
  return createApp({
    version: '1.2.3',
    startedAt: 1_000,
    now: () => 3_500,
    dbOk: () => dbOk,
    rssBytes: () => 42,
  });
}

describe('GET /api/health', () => {
  it('reports ok with version, uptime and memory', async () => {
    const res = await app(true).request('/api/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body).toEqual({ status: 'ok', version: '1.2.3', uptimeS: 2.5, db: 'ok', rssBytes: 42 });
  });

  it('returns 503 degraded when the database is down', async () => {
    const res = await app(false).request('/api/health');
    expect(res.status).toBe(503);
    expect(HealthResponse.parse(await res.json())).toMatchObject({
      status: 'degraded',
      db: 'error',
    });
  });
});
