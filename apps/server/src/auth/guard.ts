// The session and CSRF middleware in front of every /api route (S§5.13: "Every API route except
// /api/health and static assets needs a session or an API token"; API tokens are Phase 7).
//
// Protection is the default. OPEN_ROUTES below is the one allow-list: a route not on it answers 401
// without a valid session, whatever order routes are mounted in, because this middleware runs
// first for every /api request (app.ts) and decides from the method and path alone. An unknown
// /api path without a session is also a 401, so the API's shape is not probed without signing in.
//
// CSRF, for every request whose method is not GET, HEAD or OPTIONS (open routes included, so a
// cross-site page cannot log the browser into an attacker's session or race the setup):
//   1. Origin, when present, must equal the request's own origin (scheme, host and port, as the
//      server or, with auth.trustProxy, the proxy saw them). `Origin: null` is refused.
//   2. Without Origin, Sec-Fetch-Site must be `same-origin` or `none` (typed by the user). A request
//      with neither header is refused: every browser this app supports sends one of them.
//   3. The request must carry `Content-Type: application/json` or a non-empty `X-Requested-With`
//      header. An HTML form can send neither, and a cross-site fetch that adds either needs a CORS
//      preflight, which this server never grants (it sends no CORS headers).
// The session cookie is also SameSite=Strict (routes.ts), so a cross-site request carries no session
// in the first place; these checks are the second line, and the one that also covers the open
// routes. A page in the Phase 6 browser add-on is cross-origin to the app and is refused by rule 1
// or 2, besides having no session cookie (S§5.13 last sentence).
//
// Two rules hold for every method, reads included:
//   a. the host the request names must be one this server answers for (host.ts): an address, a
//      local name, or a name listed in ALLOWED_HOSTS. Without it rule 1 proves nothing, because
//      the "own origin" is read from the request (DNS rebinding);
//   b. a request that says it comes from another site (an Origin that is not the own origin, or a
//      Sec-Fetch-Site other than `same-origin` and `none`) is refused, so a context that browsers
//      let past the same-origin policy (an extension page with host permission) cannot read the
//      API with the owner's cookie. The always-open routes are exempt: they hold nothing private,
//      and `/api/health` stays reachable by a link from anywhere.
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { requestHosts, requestOrigin } from './client.ts';
import { hostAllowed, hostNameOf } from './host.ts';
import { type AppEnv, apiError } from './http.ts';
import type { AuthService, SessionInfo } from './types.ts';

/** The session cookie's name. */
export const SESSION_COOKIE = 'dasher_session';

export type OpenAccess = 'always' | 'until_password_set';

export interface OpenRoute {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly open: OpenAccess;
}

/** The only API routes reachable without a session. Everything else under /api needs one. */
export const OPEN_ROUTES: readonly OpenRoute[] = [
  { method: 'GET', path: '/api/health', open: 'always' },
  { method: 'GET', path: '/api/auth/status', open: 'always' },
  // Answers 409 forever once a password exists (routes.ts), so a second visitor cannot claim it.
  { method: 'POST', path: '/api/auth/setup', open: 'always' },
  { method: 'POST', path: '/api/auth/login', open: 'always' },
  // The first-run wizard's progress is readable before the owner exists, and only then.
  { method: 'GET', path: '/api/setup', open: 'until_password_set' },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The allow-list entry for a request, if any (HEAD is served by the GET route). */
export function openAccess(method: string, path: string): OpenAccess | null {
  const asRoute = method === 'HEAD' ? 'GET' : method;
  return OPEN_ROUTES.find((r) => r.method === asRoute && r.path === path)?.open ?? null;
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: string };

/** The CSRF rule above, for one request. */
export function checkCsrf(
  headers: { get(name: string): string | null },
  ownOrigin: string | null,
): CsrfVerdict {
  const origin = headers.get('origin');
  if (origin !== null) {
    let normalized: string | null = null;
    try {
      normalized = origin === 'null' ? null : new URL(origin).origin;
    } catch {
      normalized = null;
    }
    if (normalized === null || ownOrigin === null || normalized !== ownOrigin) {
      return { ok: false, reason: 'cross-origin request' };
    }
  } else {
    const site = headers.get('sec-fetch-site')?.toLowerCase();
    if (site !== 'same-origin' && site !== 'none') {
      return { ok: false, reason: 'the request names no same origin (Origin or Sec-Fetch-Site)' };
    }
  }
  const type = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const requestedWith = headers.get('x-requested-with')?.trim();
  if (type !== 'application/json' && !requestedWith) {
    return {
      ok: false,
      reason: 'a state-changing request needs a JSON body or the X-Requested-With header',
    };
  }
  return { ok: true };
}

/** Rule b: true when the request's own headers say another site sent it. */
export function saysCrossSite(
  headers: { get(name: string): string | null },
  ownOrigin: string | null,
): boolean {
  const origin = headers.get('origin');
  if (origin !== null) {
    let normalized: string | null = null;
    try {
      normalized = origin === 'null' ? null : new URL(origin).origin;
    } catch {
      normalized = null;
    }
    if (normalized === null || ownOrigin === null || normalized !== ownOrigin) return true;
  }
  const site = headers.get('sec-fetch-site')?.toLowerCase();
  return site !== undefined && site !== 'same-origin' && site !== 'none';
}

export interface GuardDeps {
  readonly auth: AuthService;
  /** Host names answered besides addresses and local names (ALLOWED_HOSTS); see host.ts. */
  readonly allowedHosts?: readonly string[];
  /** Whether to read X-Forwarded-* (the setting auth.trustProxy), read per request. */
  readonly trustProxy: () => boolean;
}

/** The middleware. Mount it first on /api/*. */
export function createGuard(deps: GuardDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method;
    const open = openAccess(method, c.req.path);
    const trustProxy = deps.trustProxy();

    const refused = requestHosts(c, trustProxy).find(
      (host) => !hostAllowed(host, deps.allowedHosts ?? []),
    );
    if (refused !== undefined) {
      // The name is said back (as parsed, so only a host name's characters) so the owner knows
      // what to list.
      const name = hostNameOf(refused)?.slice(0, 100);
      return c.json(
        apiError(
          'forbidden',
          `this server does not answer for ${name === undefined ? 'that host name' : `the host name ${name}`}: open it by its address, or list the name in ALLOWED_HOSTS`,
        ),
        403,
      );
    }

    const token = getCookie(c, SESSION_COOKIE);
    let session: SessionInfo | null = null;
    if (token !== undefined) {
      try {
        session = deps.auth.authenticate(token);
        if (session === null) deleteCookie(c, SESSION_COOKIE, { path: '/' });
      } catch (error) {
        // A broken database must not turn /api/health into a 500: an always-open route goes on
        // as signed out. Every other route fails as it would have.
        if (open !== 'always') throw error;
      }
    }
    if (session !== null) c.set('session', session);

    const allowed =
      session !== null ||
      open === 'always' ||
      (open === 'until_password_set' && !deps.auth.passwordSet());
    if (!allowed) {
      return c.json(apiError('unauthenticated', 'sign in first'), 401);
    }

    const ownOrigin = requestOrigin(c, trustProxy);
    if (!SAFE_METHODS.has(method)) {
      const verdict = checkCsrf(c.req.raw.headers, ownOrigin);
      if (!verdict.ok) return c.json(apiError('forbidden', verdict.reason), 403);
    } else if (open !== 'always' && saysCrossSite(c.req.raw.headers, ownOrigin)) {
      return c.json(apiError('forbidden', 'cross-site request'), 403);
    }
    return next();
  };
}
