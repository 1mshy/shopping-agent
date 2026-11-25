// Owner auth and first-run status on the wire (S§5.12 First-run wizard, S§5.13). The password is
// only ever a request field; no response carries it, a hash or a session token (the token travels
// in the Set-Cookie of setup and login only).
import { z } from 'zod';

/**
 * The shortest owner password, in Unicode code points after NFKC normalisation. NIST SP 800-63B-4
 * asks for at least 15 characters when a password is the only factor, as it is here (one owner, no
 * second factor in v1). A passphrase of four short words meets it.
 */
export const PASSWORD_MIN_LENGTH = 15;

/**
 * The longest owner password, in code points after NFKC normalisation (NIST asks verifiers to accept
 * at least 64). The bound keeps the argon2 input small, so a huge body cannot buy CPU time.
 */
export const PASSWORD_MAX_LENGTH = 256;

/** Body of `POST /api/auth/setup` and `POST /api/auth/login`. */
export const PasswordRequest = z.strictObject({ password: z.string() });
export type PasswordRequest = z.infer<typeof PasswordRequest>;

/** Body of `POST /api/auth/password`. The current password is required (S§5.13). */
export const ChangePasswordRequest = z.strictObject({
  currentPassword: z.string(),
  newPassword: z.string(),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/** Response of `GET /api/auth/status` (open): nothing but these two facts. */
export const AuthStatusResponse = z.strictObject({
  passwordSet: z.boolean(),
  signedIn: z.boolean(),
});
export type AuthStatusResponse = z.infer<typeof AuthStatusResponse>;

/** Response of `GET /api/setup`: which first-run wizard steps are done (S§5.12). */
export const SetupStatusResponse = z.strictObject({
  /** Step 1: the owner password is set. */
  password: z.boolean(),
  /** Step 2: country, currency and language all have a value (from the database or the environment). */
  locale: z.boolean(),
});
export type SetupStatusResponse = z.infer<typeof SetupStatusResponse>;

/**
 * Refusal codes of the auth and settings routes. A failed login or password check is always
 * `invalid_credentials`: the answer never says which part was wrong.
 */
export const API_ERROR_CODES = [
  'invalid',
  'invalid_credentials',
  'throttled',
  'already_set',
  'not_set',
  'unauthenticated',
  'forbidden',
  'not_found',
  'payload_too_large',
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** The refusal body: `fields` names the paths that failed validation, never a submitted value. */
export const AuthApiError = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCode,
    message: z.string(),
    fields: z.array(z.string()),
  }),
});
export type AuthApiError = z.infer<typeof AuthApiError>;
