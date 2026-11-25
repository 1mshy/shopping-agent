// The auth routes (S§5.13), mounted at /api/auth behind the guard (guard.ts):
//
//   GET  /status    open: { passwordSet, signedIn }
//   POST /setup     open; sets the first password and signs in (201); 409 once a password exists
//   POST /login     open; throttled; 200 and the cookie, or 401 invalid_credentials, or 429
//   POST /logout    session; deletes the session row and clears the cookie
//   POST /password  session; { currentPassword, newPassword }; ends every other session
//
// The session token appears only in the Set-Cookie header of setup and login. The cookie is
// HttpOnly, SameSite=Strict, Path=/, Max-Age the session's absolute lifetime (the server enforces
// the sliding idle window itself, so the token is never re-sent), and Secure per auth.cookieSecure.
// Strict rather than Lax: the API is only ever called by the SPA from its own origin, where a Strict
// cookie is always sent; a link from a notification or a mail opens the SPA (static, open) and the
// SPA's own API calls then carry the cookie, so Strict costs nothing and also keeps the cookie off
// every cross-site top-level navigation.
import {
  ChangePasswordRequest,
  type CookieSecureMode,
  PasswordRequest,
} from '@agentic-dasher/shared';
import { type Context, Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { requestIsHttps, throttleKey } from './client.ts';
import { SESSION_COOKIE } from './guard.ts';
import { type AppEnv, apiError, jsonBody, sessionOf } from './http.ts';
import { ruleMessage } from './rules.ts';
import type { AuthService } from './types.ts';

/** Max-Age of the session cookie, in seconds: the server-side absolute session lifetime. */
export const COOKIE_MAX_AGE_S = 90 * 24 * 3600;

export interface AuthRoutesDeps {
  readonly auth: AuthService;
  /** The client's address for the throttle (client.ts clientAddress, honouring auth.trustProxy). */
  readonly clientAddress: (c: Context) => string;
  readonly cookieSecure: () => CookieSecureMode;
  readonly trustProxy: () => boolean;
}

const LOGIN_FAILED = 'the password was not accepted';

export function createAuthRoutes(deps: AuthRoutesDeps) {
  const { auth } = deps;

  function secure(c: Context): boolean {
    const mode = deps.cookieSecure();
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return requestIsHttps(c, deps.trustProxy());
  }

  function signIn(c: Context, token: string): void {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: secure(c),
      path: '/',
      maxAge: COOKIE_MAX_AGE_S,
    });
  }

  function retryAfter(c: Context, ms: number): void {
    c.header('Retry-After', String(Math.max(1, Math.ceil(ms / 1000))));
  }

  return new Hono<AppEnv>()
    .get('/status', (c) =>
      c.json({ passwordSet: auth.passwordSet(), signedIn: c.get('session') !== undefined }, 200),
    )
    .post('/setup', async (c) => {
      const body = PasswordRequest.safeParse(await jsonBody(c));
      if (!body.success) {
        return c.json(apiError('invalid', 'the body is { password }', ['password']), 400);
      }
      const result = await auth.setup(body.data.password);
      if (result.kind === 'already_set') {
        return c.json(apiError('already_set', 'the owner password is already set'), 409);
      }
      if (result.kind === 'invalid') {
        return c.json(apiError('invalid', ruleMessage(result.reason), ['password']), 400);
      }
      signIn(c, result.token);
      return c.json({ signedIn: true }, 201);
    })
    .post('/login', async (c) => {
      const body = PasswordRequest.safeParse(await jsonBody(c));
      if (!body.success) {
        return c.json(apiError('invalid', 'the body is { password }', ['password']), 400);
      }
      const result = await auth.login(body.data.password, throttleKey(deps.clientAddress(c)));
      if (result.kind === 'throttled') {
        retryAfter(c, result.retryAfterMs);
        return c.json(apiError('throttled', 'too many attempts; try again later'), 429);
      }
      if (result.kind === 'invalid_credentials') {
        return c.json(apiError('invalid_credentials', LOGIN_FAILED), 401);
      }
      signIn(c, result.token);
      return c.json({ signedIn: true }, 200);
    })
    .post('/logout', (c) => {
      auth.logout(sessionOf(c).id);
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ signedIn: false }, 200);
    })
    .post('/password', async (c) => {
      const body = ChangePasswordRequest.safeParse(await jsonBody(c));
      if (!body.success) {
        return c.json(
          apiError('invalid', 'the body is { currentPassword, newPassword }', [
            'currentPassword',
            'newPassword',
          ]),
          400,
        );
      }
      const result = await auth.changePassword(
        sessionOf(c),
        body.data.currentPassword,
        body.data.newPassword,
        throttleKey(deps.clientAddress(c)),
      );
      switch (result.kind) {
        case 'invalid':
          return c.json(apiError('invalid', ruleMessage(result.reason), ['newPassword']), 400);
        case 'throttled':
          retryAfter(c, result.retryAfterMs);
          return c.json(apiError('throttled', 'too many attempts; try again later'), 429);
        case 'invalid_credentials':
          // 403, not 401: the session is fine, the proof of the current password is not.
          return c.json(apiError('invalid_credentials', LOGIN_FAILED), 403);
        case 'changed':
          if (result.token === null) deleteCookie(c, SESSION_COOKIE, { path: '/' });
          else signIn(c, result.token);
          return c.json({ endedSessions: result.endedSessions }, 200);
      }
    });
}

export type AuthRoutes = ReturnType<typeof createAuthRoutes>;
