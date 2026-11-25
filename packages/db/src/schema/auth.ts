// S§5.13 owner auth (migration 0002): the owner password and login sessions. User-owned.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { id, profile, profileId, timestamp } from './profile.ts';

/**
 * The owner password as a PHC string from `crypto.argon2` (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`),
 * one per profile. Kept out of `setting`, so no settings route can read it.
 */
export const ownerPassword = sqliteTable('owner_password', {
  profileId: integer('profile_id')
    .primaryKey()
    .references(() => profile.id, { onDelete: 'restrict' }),
  passwordHash: text('password_hash').notNull(),
  setAt: timestamp('set_at').notNull(),
});

/**
 * A login session. Only the SHA-256 of the cookie's token is stored, in lower-case hex, never the
 * token. Logging out deletes the row.
 */
export const session = sqliteTable('session', {
  id: id(),
  profileId: profileId(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull(),
});
