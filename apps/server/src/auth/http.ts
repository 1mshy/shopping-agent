// HTTP pieces shared by the auth, settings and setup routes. Node-free.
import type { ApiErrorCode } from '@agentic-dasher/shared';
import type { Context } from 'hono';
import type { SessionInfo } from './types.ts';

/** The Hono environment of the API: the session middleware sets `session` on a signed-in request. */
export interface AppEnv {
  Variables: { session: SessionInfo };
}

/** A refusal body: `{ error: { code, message, fields } }`. Fields are paths, never values. */
export function apiError(code: ApiErrorCode, message: string, fields: readonly string[] = []) {
  return { error: { code, message, fields: [...fields] } };
}

/** The session of a request the guard let through as signed in. */
export function sessionOf(c: Context<AppEnv>): SessionInfo {
  const session = c.get('session');
  // Unreachable behind the guard on a protected route; a programming error otherwise.
  if (session === undefined) throw new Error('no session on a protected route');
  return session;
}

/** Reads a JSON body; null when it is not JSON. */
export async function jsonBody(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
