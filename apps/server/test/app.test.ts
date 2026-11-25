// The assembled app: what is open, what is protected, the cookie, CSRF and the auth routes over
// HTTP, on a real temporary database.
import { AuthStatusResponse } from '@agentic-dasher/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_BODY_LIMIT_BYTES } from '../src/app.ts';
import { checkCsrf, OPEN_ROUTES, openAccess, SESSION_COOKIE } from '../src/auth/index.ts';
import {
  call,
  type Harness,
  harness,
  OTHER_PASSWORD,
  PASSWORD,
  setUp,
  tokenOf,
} from './auth/harness.ts';

let h: Harness;
afterEach(() => h?.dispose());

function routeTable(app: Harness['app']): { method: string; path: string }[] {
  const seen = new Map<string, { method: string; path: string }>();
  for (const route of app.routes) {
    if (route.method === 'ALL') continue; // middleware
    seen.set(`${route.method} ${route.path}`, { method: route.method, path: route.path });
  }
  return [...seen.values()];
}

function concrete(path: string): string {
  return path.replace(/:key\b/g, 'market.currency').replace(/:[A-Za-z]+/g, '1');
}

describe('every route is on the allow-list or needs a session', () => {
  it('walks the route table: everything not in OPEN_ROUTES answers 401 without a cookie', async () => {
    h = harness();
    await setUp(h); // a password exists, so the until-setup route is closed too
    const table = routeTable(h.app);
    const protectedRoutes = table.filter((r) => openAccess(r.method, r.path) === null);

    // Not vacuous: the table holds the routes this unit and the notify unit mount.
    const names = table.map((r) => `${r.method} ${r.path}`);
    for (const expected of [
      'GET /api/settings',
      'PUT /api/settings/:key',
      'DELETE /api/settings/:key',
      'POST /api/auth/logout',
      'POST /api/auth/password',
      'GET /api/channels',
      'POST /api/channels/:id/test',
      'GET /api/watches',
      'POST /api/watches',
      'GET /api/listings/:id/history',
      'POST /api/refresh',
      'GET /api/notifications',
    ]) {
      expect(names).toContain(expected);
    }
    // Every allow-list entry names a real route: no stale entries.
    for (const open of OPEN_ROUTES) expect(names).toContain(`${open.method} ${open.path}`);
    expect(protectedRoutes.length).toBe(table.length - OPEN_ROUTES.length);

    for (const route of protectedRoutes) {
      const path = concrete(route.path);
      const bare = await h.app.request(path, { method: route.method });
      expect(bare.status, `${route.method} ${route.path} bare`).toBe(401);
      // Same-origin headers and a body do not stand in for a session.
      const dressed = await call(h.app, path, {
        method: route.method,
        body: route.method === 'GET' ? undefined : { value: 'x' },
      });
      expect(dressed.status, `${route.method} ${route.path} dressed`).toBe(401);
      expect(await dressed.json()).toEqual({
        error: { code: 'unauthenticated', message: 'sign in first', fields: [] },
      });
    }
  });

  it('answers 401 for an unknown /api path without a session, 404 with one', async () => {
    h = harness();
    const token = await setUp(h);
    expect((await call(h.app, '/api/nothing-here')).status).toBe(401);
    expect((await call(h.app, '/api/health/')).status).toBe(401);
    expect((await call(h.app, '/api/nothing-here', { cookie: token })).status).toBe(404);
  });

  it('a protected route answers with a valid session', async () => {
    h = harness();
    const token = await setUp(h);
    expect((await call(h.app, '/api/settings', { cookie: token })).status).toBe(200);
    expect((await call(h.app, '/api/channels', { cookie: token })).status).toBe(200);
    expect((await call(h.app, '/api/watches', { cookie: token })).status).toBe(200);
  });
});

describe('GET /api/auth/status', () => {
  it('says only whether a password is set and whether this request is signed in', async () => {
    h = harness();
    let res = await call(h.app, '/api/auth/status');
    expect(await res.json()).toEqual({ passwordSet: false, signedIn: false });
    const token = await setUp(h);
    res = await call(h.app, '/api/auth/status');
    expect(AuthStatusResponse.parse(await res.json())).toEqual({
      passwordSet: true,
      signedIn: false,
    });
    res = await call(h.app, '/api/auth/status', { cookie: token });
    expect(await res.json()).toEqual({ passwordSet: true, signedIn: true });
  });
});

describe('POST /api/auth/setup', () => {
  it('sets the password once, signs the caller in, and answers 409 forever after', async () => {
    h = harness();
    const res = await call(h.app, '/api/auth/setup', { body: { password: PASSWORD } });
    expect(res.status).toBe(201);
    const token = tokenOf(res);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const text = await res.text();
    expect(text).toBe('{"signedIn":true}');

    const again = await call(h.app, '/api/auth/setup', { body: { password: OTHER_PASSWORD } });
    expect(again.status).toBe(409);
    expect(tokenOf(again)).toBeUndefined();
    // Signed in or not, it stays closed.
    const signedIn = await call(h.app, '/api/auth/setup', {
      body: { password: OTHER_PASSWORD },
      cookie: token,
    });
    expect(signedIn.status).toBe(409);
    expect(
      (await call(h.app, '/api/auth/login', { body: { password: OTHER_PASSWORD } })).status,
    ).toBe(401);
  });

  it('of two concurrent setup requests exactly one wins', async () => {
    h = harness();
    const [a, b] = await Promise.all([
      call(h.app, '/api/auth/setup', { body: { password: PASSWORD } }),
      call(h.app, '/api/auth/setup', { body: { password: OTHER_PASSWORD } }),
    ]);
    expect([a?.status, b?.status].sort()).toEqual([201, 409]);
  });

  it('refuses a short password with the rule, and a body that is not { password }', async () => {
    h = harness();
    const short = await call(h.app, '/api/auth/setup', { body: { password: 'too short' } });
    expect(short.status).toBe(400);
    const body = await short.text();
    expect(body).toContain('at least 15 characters');
    expect(body).not.toContain('too short');
    expect((await call(h.app, '/api/auth/setup', { body: { pass: PASSWORD } })).status).toBe(400);
    expect((await call(h.app, '/api/auth/status')).status).toBe(200);
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, SameSite=Strict, Path=/, 90 days, and not Secure over plain HTTP', async () => {
    h = harness();
    const res = await call(h.app, '/api/auth/setup', { body: { password: PASSWORD } });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; `));
    expect(cookie).toContain('Max-Age=7776000');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
  });

  it('is Secure over HTTPS', async () => {
    // A public name is answered only when listed (ALLOWED_HOSTS; auth/host.ts).
    h = harness({ allowedHosts: ['dasher.example'] });
    const res = await call(h.app, '/api/auth/setup', {
      body: { password: PASSWORD },
      origin: 'https://dasher.example',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('is Secure behind a trusted HTTPS proxy, and only when the proxy is trusted', async () => {
    h = harness({ env: { AUTH_TRUST_PROXY: 'true' } });
    const res = await call(h.app, '/api/auth/setup', {
      body: { password: PASSWORD },
      headers: { 'X-Forwarded-Proto': 'https', Origin: 'https://localhost' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toContain('Secure');

    const untrusted = harness();
    try {
      const plain = await call(untrusted.app, '/api/auth/setup', {
        body: { password: PASSWORD },
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      expect(plain.status).toBe(201);
      expect(plain.headers.get('set-cookie')).not.toContain('Secure');
    } finally {
      untrusted.dispose();
    }
  });

  it('follows auth.cookieSecure = always', async () => {
    h = harness({ env: { AUTH_COOKIE_SECURE: 'always' } });
    const res = await call(h.app, '/api/auth/setup', { body: { password: PASSWORD } });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('is cleared when it no longer opens a session', async () => {
    h = harness();
    await setUp(h);
    const res = await call(h.app, '/api/settings', { cookie: 'A'.repeat(43) });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^dasher_session=; Max-Age=0; Path=\//);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right password; a wrong one gets the same answer as no password at all', async () => {
    h = harness();
    const before = await call(h.app, '/api/auth/login', { body: { password: PASSWORD } });
    expect(before.status).toBe(401);
    const beforeBody = await before.json();

    await setUp(h);
    const wrong = await call(h.app, '/api/auth/login', { body: { password: OTHER_PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(beforeBody);
    expect(tokenOf(wrong)).toBeUndefined();

    const ok = await call(h.app, '/api/auth/login', { body: { password: PASSWORD } });
    expect(ok.status).toBe(200);
    const token = tokenOf(ok);
    expect(await ok.text()).toBe('{"signedIn":true}');
    expect((await call(h.app, '/api/settings', { cookie: token })).status).toBe(200);
  });

  it('is throttled per address with Retry-After, and other addresses go on', async () => {
    h = harness();
    await setUp(h);
    for (let i = 0; i < 6; i++) {
      const res = await call(h.app, '/api/auth/login', {
        body: { password: OTHER_PASSWORD },
        address: '198.51.100.1',
      });
      expect(res.status).toBe(401);
    }
    const locked = await call(h.app, '/api/auth/login', {
      body: { password: PASSWORD },
      address: '198.51.100.1',
    });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('1');
    expect(tokenOf(locked)).toBeUndefined();
    const elsewhere = await call(h.app, '/api/auth/login', {
      body: { password: PASSWORD },
      address: '198.51.100.2',
    });
    expect(elsewhere.status).toBe(200);
    h.clock.advance(1_000);
    const later = await call(h.app, '/api/auth/login', {
      body: { password: PASSWORD },
      address: '198.51.100.1',
    });
    expect(later.status).toBe(200);
  });

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    h = harness();
    await setUp(h);
    for (let i = 0; i < 6; i++) {
      await call(h.app, '/api/auth/login', {
        body: { password: OTHER_PASSWORD },
        headers: { 'X-Forwarded-For': `203.0.113.${i}` },
      });
    }
    // All six came from the one socket address, whatever they claimed.
    const res = await call(h.app, '/api/auth/login', {
      body: { password: PASSWORD },
      headers: { 'X-Forwarded-For': '203.0.113.99' },
    });
    expect(res.status).toBe(429);
  });

  it('refuses a body over 4 KiB', async () => {
    h = harness();
    await setUp(h);
    const res = await call(h.app, '/api/auth/login', {
      body: { password: 'x'.repeat(AUTH_BODY_LIMIT_BYTES) },
    });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    h = harness();
    const token = await setUp(h);
    const res = await call(h.app, '/api/auth/logout', {
      method: 'POST',
      cookie: token,
      headers: { 'Content-Type': '', 'X-Requested-With': 'fetch' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^dasher_session=; Max-Age=0/);
    expect((await call(h.app, '/api/settings', { cookie: token })).status).toBe(401);
  });
});

describe('POST /api/auth/password', () => {
  it('needs the current password and ends every other session', async () => {
    h = harness();
    const mine = await setUp(h);
    const other = tokenOf(await call(h.app, '/api/auth/login', { body: { password: PASSWORD } }));

    const wrong = await call(h.app, '/api/auth/password', {
      cookie: mine,
      body: { currentPassword: OTHER_PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()) as unknown).toMatchObject({
      error: { code: 'invalid_credentials' },
    });

    const res = await call(h.app, '/api/auth/password', {
      cookie: mine,
      body: { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ endedSessions: 1 });
    expect((await call(h.app, '/api/settings', { cookie: mine })).status).toBe(200);
    expect((await call(h.app, '/api/settings', { cookie: other })).status).toBe(401);
  });
});

describe('CSRF', () => {
  async function signedIn() {
    h = harness();
    return setUp(h);
  }

  function put(token: string, headers: Record<string, string>) {
    return call(h.app, '/api/settings/fetch.robots', {
      method: 'PUT',
      cookie: token,
      body: { value: 'report' },
      headers,
    });
  }

  it('accepts a same-origin JSON request', async () => {
    const token = await signedIn();
    expect((await put(token, {})).status).toBe(200);
  });

  it('accepts Sec-Fetch-Site same-origin or none when Origin is absent', async () => {
    const token = await signedIn();
    for (const site of ['same-origin', 'none']) {
      const res = await put(token, { Origin: '', 'Sec-Fetch-Site': site });
      expect(res.status, site).toBe(200);
    }
  });

  it('refuses a cross-site Origin, Origin null, and another port or scheme', async () => {
    const token = await signedIn();
    for (const origin of [
      'https://evil.example',
      'null',
      'http://localhost:8081',
      'https://localhost',
      'not a url',
    ]) {
      const res = await put(token, { Origin: origin });
      expect(res.status, origin).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
    }
  });

  it('refuses a request with neither Origin nor a same-origin Sec-Fetch-Site', async () => {
    const token = await signedIn();
    expect((await put(token, { Origin: '' })).status).toBe(403);
    expect((await put(token, { Origin: '', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await put(token, { Origin: '', 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
  });

  it('refuses a form content type and text/plain (what a cross-site form can send)', async () => {
    const token = await signedIn();
    for (const type of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'text/plain',
      '',
    ]) {
      const res = await put(token, { 'Content-Type': type });
      expect(res.status, type).toBe(403);
    }
    // The custom header a form cannot send stands in for the JSON type.
    expect((await put(token, { 'Content-Type': '', 'X-Requested-With': 'fetch' })).status).toBe(
      200,
    );
  });

  it('covers the open routes too: a cross-site page cannot set up or log in', async () => {
    h = harness();
    const setup = await call(h.app, '/api/auth/setup', {
      body: { password: PASSWORD },
      headers: { Origin: 'https://evil.example' },
    });
    expect(setup.status).toBe(403);
    expect((await call(h.app, '/api/auth/status')).status).toBe(200);
    expect(await (await call(h.app, '/api/auth/status')).json()).toMatchObject({
      passwordSet: false,
    });
    await setUp(h);
    const login = await call(h.app, '/api/auth/login', {
      body: { password: PASSWORD },
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(login.status).toBe(403);
  });

  it('checkCsrf is the rule the comment states', () => {
    const headers = (h: Record<string, string>) => new Headers(h);
    const own = 'http://dasher.lan:8080';
    expect(checkCsrf(headers({ origin: own, 'content-type': 'application/json' }), own)).toEqual({
      ok: true,
    });
    expect(
      checkCsrf(headers({ origin: 'HTTP://DASHER.LAN:8080', 'x-requested-with': 'x' }), own).ok,
    ).toBe(true);
    expect(checkCsrf(headers({ origin: own }), own).ok).toBe(false);
    expect(checkCsrf(headers({ 'content-type': 'application/json' }), own).ok).toBe(false);
    expect(checkCsrf(headers({ origin: own, 'content-type': 'application/json' }), null).ok).toBe(
      false,
    );
  });
});

describe('/api/health', () => {
  it('stays open and answers even when a stale cookie comes with it', async () => {
    h = harness();
    const res = await call(h.app, '/api/health', { cookie: 'A'.repeat(43) });
    expect(res.status).toBe(200);
  });
});
