// The Host check (DNS rebinding) and the cross-site refusal on every method. From the auth
// review's findings 1 and 3: the server compared Origin with an origin built from the request's
// own Host header and never asked whether that host was one of its own, so a page whose name was
// pointed at this server's address passed every CSRF rule and could claim an install that had no
// password yet.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostAllowed, parseAllowedHosts } from '../../src/auth/host.ts';
import { call, type Harness, harness, PASSWORD, setUp } from './harness.ts';

describe('hostAllowed', () => {
  const none: readonly string[] = [];

  it('accepts addresses, localhost, single-label and local-only names', () => {
    for (const host of [
      'localhost',
      'localhost:8080',
      'app.localhost:8080',
      '127.0.0.1:8080',
      '192.168.1.20',
      '[::1]:8080',
      '[fd00::20]',
      'nas',
      'nas:8080',
      'dasher.local',
      'Dasher.LAN:8080',
      'box.home.arpa',
      'core.internal',
      'pi.home',
    ]) {
      expect(hostAllowed(host, none), host).toBe(true);
    }
  });

  it('refuses a public name unless it is listed', () => {
    for (const host of [
      'evil.example:8080',
      'evil.example',
      '192.168.1.20.evil.example',
      'localhost.evil.example',
      'dasher.local.evil.example:8080',
      'box.tailnet.ts.net',
    ]) {
      expect(hostAllowed(host, none), host).toBe(false);
    }
    expect(hostAllowed('dasher.example.org:8443', ['dasher.example.org'])).toBe(true);
    expect(hostAllowed('DASHER.example.org.', ['Dasher.Example.org'])).toBe(true);
    expect(hostAllowed('other.example.org', ['dasher.example.org'])).toBe(false);
    // A leading dot lists every name under a domain, and not the look-alike beside it.
    expect(hostAllowed('box.tailnet.ts.net', ['.tailnet.ts.net'])).toBe(true);
    expect(hostAllowed('eviltailnet.ts.net', ['.tailnet.ts.net'])).toBe(false);
  });

  it('refuses a host that is not a host', () => {
    for (const host of [
      '',
      ' ',
      'a b',
      'user@localhost',
      'localhost/path',
      'local host:80',
      '[::1',
      ':8080',
    ]) {
      expect(hostAllowed(host, none), JSON.stringify(host)).toBe(false);
    }
    expect(hostAllowed(undefined, none)).toBe(false);
  });
});

describe('the guard refuses a host that is not its own', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.dispose());

  it('a rebinding page cannot claim an install that has no password', async () => {
    const origin = 'http://evil.example:8080';
    const res = await call(h.app, '/api/auth/setup', { origin, body: { password: PASSWORD } });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(h.auth.passwordSet()).toBe(false);
    // The owner, at the server's address, still can.
    const own = await call(h.app, '/api/auth/setup', {
      origin: 'http://192.168.1.20:8080',
      body: { password: PASSWORD },
    });
    expect(own.status).toBe(201);
  });

  it('refuses every /api route under such a name, open ones and reads included', async () => {
    const token = await setUp(h);
    const origin = 'http://evil.example:8080';
    for (const [path, body] of [
      ['/api/auth/login', { password: PASSWORD }],
      ['/api/auth/status', undefined],
      ['/api/health', undefined],
      ['/api/settings', undefined],
    ] as const) {
      const res = await call(h.app, path, { origin, cookie: token, ...(body ? { body } : {}) });
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    }
  });

  it('answers for a listed name', async () => {
    h.dispose();
    h = harness({ allowedHosts: ['dasher.example.org'] });
    const res = await call(h.app, '/api/auth/setup', {
      origin: 'https://dasher.example.org',
      body: { password: PASSWORD },
    });
    expect(res.status).toBe(201);
  });

  it('with a trusted proxy, judges the host the browser addressed', async () => {
    const token = await setUp(h);
    const put = await call(h.app, '/api/settings/auth.trustProxy', {
      method: 'PUT',
      cookie: token,
      body: { value: true },
    });
    expect(put.status).toBe(200);
    const refused = await call(h.app, '/api/auth/status', {
      headers: { 'X-Forwarded-Host': 'evil.example' },
    });
    expect(refused.status).toBe(403);
    const fine = await call(h.app, '/api/auth/status', {
      headers: { 'X-Forwarded-Host': '192.168.1.20:8080' },
    });
    expect(fine.status).toBe(200);
  });
});

// From the review of the Host check itself (2026-11-25): what it missed.
describe('the Host check, second pass', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.dispose());

  it('with a trusted proxy, a client cannot vouch for its own host with X-Forwarded-Host', async () => {
    const token = await setUp(h);
    await call(h.app, '/api/settings/auth.trustProxy', {
      method: 'PUT',
      cookie: token,
      body: { value: true },
    });
    // A rebinding page reaches the server directly under its own name and adds the header itself.
    const res = await call(h.app, '/api/auth/status', {
      origin: 'http://evil.example:8080',
      headers: { 'X-Forwarded-Host': '192.168.1.20:8080', 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(res.status).toBe(403);
    // A real proxy: an upstream name the server answers for, and the public name forwarded.
    h.dispose();
    h = harness({ allowedHosts: ['dasher.example.org'], env: { AUTH_TRUST_PROXY: 'true' } });
    const proxied = await call(h.app, '/api/auth/status', {
      origin: 'http://core:8080',
      headers: { 'X-Forwarded-Host': 'dasher.example.org' },
    });
    expect(proxied.status).toBe(200);
  });

  it('names the refused host, so the owner knows what to list', async () => {
    const res = await call(h.app, '/api/auth/status', { origin: 'http://nas.fritz.box:8080' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('nas.fritz.box');
    expect(body.error.message).toContain('ALLOWED_HOSTS');
  });

  it('answers for .test and .localdomain names, which the public DNS cannot carry', () => {
    expect(hostAllowed('dasher.test:8080', [])).toBe(true);
    expect(hostAllowed('nas.localdomain', [])).toBe(true);
    // fritz.box is under a public top-level domain: it must be listed.
    expect(hostAllowed('nas.fritz.box', [])).toBe(false);
    expect(hostAllowed('nas.fritz.box', parseAllowedHosts('.fritz.box').names)).toBe(true);
  });

  it('reads ALLOWED_HOSTS entries as people write them', () => {
    const parsed = parseAllowedHosts(
      ' dasher.example.com:8443, *.ts.net  .Example.ORG. bücher.example , bad/name,http://x.example/ ',
    );
    expect(parsed.names).toEqual([
      'dasher.example.com',
      '.ts.net',
      '.example.org',
      'xn--bcher-kva.example',
    ]);
    expect(parsed.rejected).toEqual(['bad/name', 'http://x.example/']);
    expect(hostAllowed('dasher.example.com:8443', parsed.names)).toBe(true);
    expect(hostAllowed('nas.tail1.ts.net', parsed.names)).toBe(true);
    expect(hostAllowed('xn--bcher-kva.example', parsed.names)).toBe(true);
    expect(parseAllowedHosts(undefined)).toEqual({ names: [], rejected: [] });
  });
});

describe('the guard refuses a cross-site request on any method', () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = harness();
    token = await setUp(h);
  });
  afterEach(() => h.dispose());

  it('a read with a session and another origin is refused', async () => {
    const cases: Record<string, string>[] = [
      { Origin: 'chrome-extension://abcdefghijklmnop', 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'http://evil.example' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const headers of cases) {
      for (const path of ['/api/settings', '/api/channels', '/api/watches']) {
        const res = await call(h.app, path, { cookie: token, headers });
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(403);
      }
    }
  });

  it('a same-origin read, a typed address and a client with no browser headers still pass', async () => {
    const cases: Record<string, string>[] = [
      {},
      { 'Sec-Fetch-Site': 'same-origin' },
      { 'Sec-Fetch-Site': 'none' },
      { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of cases) {
      const res = await call(h.app, '/api/settings', { cookie: token, headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
    }
  });

  it('health stays open to a link from anywhere', async () => {
    const res = await call(h.app, '/api/health', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });
});
