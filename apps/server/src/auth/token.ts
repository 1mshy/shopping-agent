// Session tokens (S§5.13). The cookie carries 32 random bytes in base64url; the database keeps only
// their SHA-256 in lower-case hex (migration 0002, `session_token_hash`), so a copy of the database
// opens no session. A lookup is by that hash.
import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** The form of a token this build issues: 32 bytes in unpadded base64url. */
export const TOKEN_FORM = /^[A-Za-z0-9_-]{43}$/;

/** A fresh session token. */
export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** The stored form of a token: SHA-256, 64 lower-case hex characters. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
