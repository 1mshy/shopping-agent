// The auth service as the HTTP layer sees it. Kept free of Node imports: the routes and the session
// middleware depend on this interface only, and service.ts implements it.
import type { PasswordRuleFailure } from './rules.ts';

/** A signed-in request's session. Never the token. */
export interface SessionInfo {
  readonly id: number;
  readonly profileId: number;
}

export type SetupResult =
  | { readonly kind: 'created'; readonly token: string; readonly session: SessionInfo }
  | { readonly kind: 'already_set' }
  | { readonly kind: 'invalid'; readonly reason: PasswordRuleFailure };

export type LoginResult =
  | { readonly kind: 'ok'; readonly token: string; readonly session: SessionInfo }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'throttled'; readonly retryAfterMs: number };

export type ChangePasswordResult =
  | { readonly kind: 'changed'; readonly endedSessions: number }
  | { readonly kind: 'invalid'; readonly reason: PasswordRuleFailure }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'throttled'; readonly retryAfterMs: number };

export interface AuthService {
  /** Whether the owner password is set. */
  passwordSet(): boolean;
  /**
   * The session a cookie token opens, or null (unknown, malformed or expired; an expired row is
   * deleted). Renews the session's idle window (sliding expiry).
   */
  authenticate(token: string): SessionInfo | null;
  /** Sets the first password and signs the caller in; `already_set` once a password exists. */
  setup(password: string): Promise<SetupResult>;
  /** Checks the password under the throttle for `client` (an address key) and opens a session. */
  login(password: string, client: string): Promise<LoginResult>;
  /** Ends one session (deletes its row). */
  logout(sessionId: number): void;
  /** Changes the password (the current one is required) and ends every other session. */
  changePassword(
    session: SessionInfo,
    currentPassword: string,
    newPassword: string,
    client: string,
  ): Promise<ChangePasswordResult>;
  /** Deletes expired session rows; returns how many. */
  sweepExpired(): number;
}
