// Owner password and sessions over the database (S§5.13, migration 0002 `owner_password` and
// `session`). One owner per install: the default profile's row in owner_password.
//
// Sessions: a random token in the cookie, its SHA-256 in the row. The idle window slides (each use
// moves expires_at to now + SESSION_IDLE_MS, written at most once per SESSION_RENEW_AFTER_MS) and
// never past created_at + SESSION_MAX_MS, so a stolen cookie that keeps being used still dies. The
// token never leaves this module except in the result of setup and login, which the route puts in
// the Set-Cookie header and nowhere else. Nothing here logs.
import { type Database, DEFAULT_PROFILE_ID, schema } from '@agentic-dasher/db';
import { and, eq, lte, ne } from 'drizzle-orm';
import { ARGON2_PARAMS, type Argon2Params, hashPassword, verifyPassword } from './password.ts';
import { checkNewPassword, hashable } from './rules.ts';
import { createLoginThrottle, type LoginThrottle } from './throttle.ts';
import { hashToken, newToken, TOKEN_FORM } from './token.ts';
import type {
  AuthService,
  ChangePasswordResult,
  LoginResult,
  SessionInfo,
  SetupResult,
} from './types.ts';

/** A session unused for this long ends. */
export const SESSION_IDLE_MS = 14 * 24 * 3_600_000;
/** No session lives longer than this from its login, however often it is used. */
export const SESSION_MAX_MS = 90 * 24 * 3_600_000;
/** The sliding renewal is written at most this often per session (one write per hour, not per request). */
export const SESSION_RENEW_AFTER_MS = 3_600_000;

export interface AuthServiceDeps {
  readonly db: Database;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** Hashing parameters for new hashes; tests pass cheap ones. */
  readonly argon2?: Argon2Params;
  readonly throttle?: LoginThrottle;
}

function iso(ms: number): string {
  return new Date(Math.floor(ms)).toISOString();
}

/** Runs `fn` in a BEGIN IMMEDIATE transaction (the write lock before the first read). */
function immediate<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    result = fn();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('COMMIT');
  return result;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { db, now } = deps;
  const params = deps.argon2 ?? ARGON2_PARAMS;
  const throttle = deps.throttle ?? createLoginThrottle({ now });
  const { ownerPassword, session } = schema;
  const profileId = DEFAULT_PROFILE_ID;

  function storedHash(): string | null {
    const row = db.orm
      .select({ hash: ownerPassword.passwordHash })
      .from(ownerPassword)
      .where(eq(ownerPassword.profileId, profileId))
      .get();
    return row?.hash ?? null;
  }

  /** Inserts a new session row; the caller holds the transaction. */
  function openSession(at: number): { token: string; session: SessionInfo } {
    const token = newToken();
    const createdAt = iso(at);
    const row = db.orm
      .insert(session)
      .values({
        profileId,
        tokenHash: hashToken(token),
        createdAt,
        expiresAt: iso(at + Math.min(SESSION_IDLE_MS, SESSION_MAX_MS)),
        lastSeenAt: createdAt,
      })
      .returning({ id: session.id })
      .get();
    return { token, session: { id: row.id, profileId } };
  }

  function sweepExpired(): number {
    return db.orm
      .delete(session)
      .where(lte(session.expiresAt, iso(now())))
      .run().changes;
  }

  return {
    passwordSet() {
      return storedHash() !== null;
    },

    authenticate(token) {
      if (!TOKEN_FORM.test(token)) return null;
      const row = db.orm
        .select()
        .from(session)
        .where(eq(session.tokenHash, hashToken(token)))
        .get();
      if (row === undefined) return null;
      const at = now();
      if (Date.parse(row.expiresAt) <= at) {
        db.orm.delete(session).where(eq(session.id, row.id)).run();
        return null;
      }
      const created = Date.parse(row.createdAt);
      if (at - Date.parse(row.lastSeenAt) >= SESSION_RENEW_AFTER_MS) {
        const seen = Math.max(at, created);
        db.orm
          .update(session)
          .set({
            lastSeenAt: iso(seen),
            expiresAt: iso(Math.min(seen + SESSION_IDLE_MS, created + SESSION_MAX_MS)),
          })
          .where(eq(session.id, row.id))
          .run();
      }
      return { id: row.id, profileId: row.profileId };
    },

    async setup(password) {
      const failure = checkNewPassword(password);
      if (failure !== null) return { kind: 'invalid', reason: failure };
      // Answer at once when a password exists: no hashing for a request that cannot win.
      if (storedHash() !== null) return { kind: 'already_set' };
      const hash = await hashPassword(password, params);
      // Two setups racing both reach this point; the primary key lets exactly one insert land.
      return immediate(db, (): SetupResult => {
        const at = now();
        const inserted = db.orm
          .insert(ownerPassword)
          .values({ profileId, passwordHash: hash, setAt: iso(at) })
          .onConflictDoNothing()
          .run();
        if (inserted.changes !== 1) return { kind: 'already_set' };
        return { kind: 'created', ...openSession(at) };
      });
    },

    async login(password, client): Promise<LoginResult> {
      const admission = throttle.admit(client);
      if (!admission.admitted) return { kind: 'throttled', retryAfterMs: admission.retryAfterMs };
      const { ticket } = admission;
      try {
        const stored = storedHash();
        if (stored === null || !hashable(password)) {
          ticket.fail();
          return { kind: 'invalid_credentials' };
        }
        const verdict = await verifyPassword(password, stored, params);
        if (!verdict.ok) {
          ticket.fail();
          return { kind: 'invalid_credentials' };
        }
        ticket.succeed();
        const rehashed = verdict.needsRehash ? await hashPassword(password, params) : null;
        sweepExpired();
        return immediate(db, () => {
          if (rehashed !== null) {
            // Compare-and-set: a password changed meanwhile is not overwritten.
            db.orm
              .update(ownerPassword)
              .set({ passwordHash: rehashed })
              .where(
                and(eq(ownerPassword.profileId, profileId), eq(ownerPassword.passwordHash, stored)),
              )
              .run();
          }
          return { kind: 'ok' as const, ...openSession(now()) };
        });
      } catch (error) {
        ticket.fail();
        throw error;
      }
    },

    logout(sessionId) {
      db.orm.delete(session).where(eq(session.id, sessionId)).run();
    },

    async changePassword(current, currentPassword, newPassword, client) {
      const failure = checkNewPassword(newPassword);
      if (failure !== null) return { kind: 'invalid', reason: failure };
      const admission = throttle.admit(client);
      if (!admission.admitted) return { kind: 'throttled', retryAfterMs: admission.retryAfterMs };
      const { ticket } = admission;
      try {
        const stored = storedHash();
        if (stored === null || !hashable(currentPassword)) {
          ticket.fail();
          return { kind: 'invalid_credentials' };
        }
        const verdict = await verifyPassword(currentPassword, stored, params);
        if (!verdict.ok) {
          ticket.fail();
          return { kind: 'invalid_credentials' };
        }
        ticket.succeed();
        const hash = await hashPassword(newPassword, params);
        return immediate(db, (): ChangePasswordResult => {
          const updated = db.orm
            .update(ownerPassword)
            .set({ passwordHash: hash, setAt: iso(now()) })
            .where(
              and(eq(ownerPassword.profileId, profileId), eq(ownerPassword.passwordHash, stored)),
            )
            .run();
          // Changed by another request since the check: this one proved the old password only.
          if (updated.changes !== 1) return { kind: 'invalid_credentials' };
          const ended = db.orm
            .delete(session)
            .where(and(eq(session.profileId, current.profileId), ne(session.id, current.id)))
            .run();
          return { kind: 'changed', endedSessions: ended.changes };
        });
      } catch (error) {
        ticket.fail();
        throw error;
      }
    },

    sweepExpired,
  };
}
