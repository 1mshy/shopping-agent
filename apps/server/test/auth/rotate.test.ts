// From the auth review's finding 4: a password change kept the session token it was made with.
// A token that was in use while the old password stood is replaced along with the password.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  type Harness,
  harness,
  OTHER_PASSWORD,
  PASSWORD,
  setUp,
  tokenOf,
} from './harness.ts';

describe('changing the password', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.dispose());

  it('ends every session, the one that made the change included, and signs it in afresh', async () => {
    const first = await setUp(h);
    const login = await call(h.app, '/api/auth/login', { body: { password: PASSWORD } });
    const second = tokenOf(login) as string;

    const res = await call(h.app, '/api/auth/password', {
      cookie: first,
      body: { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ endedSessions: 1 });
    const fresh = tokenOf(res);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(first);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');

    expect((await call(h.app, '/api/settings', { cookie: first })).status).toBe(401);
    expect((await call(h.app, '/api/settings', { cookie: second })).status).toBe(401);
    expect((await call(h.app, '/api/settings', { cookie: fresh as string })).status).toBe(200);
  });

  it('keeps the session as it is when the change is refused', async () => {
    const token = await setUp(h);
    const res = await call(h.app, '/api/auth/password', {
      cookie: token,
      body: { currentPassword: 'not the current passphrase', newPassword: OTHER_PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(tokenOf(res)).toBeUndefined();
    expect((await call(h.app, '/api/settings', { cookie: token })).status).toBe(200);
  });
});
