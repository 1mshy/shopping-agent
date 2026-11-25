// The owner password's length rules (S§5.13). The bounds live in @agentic-dasher/shared so the
// wizard can show them; see PASSWORD_MIN_LENGTH and PASSWORD_MAX_LENGTH for why these values.
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@agentic-dasher/shared';

/** The password as hashed and measured: NFKC-normalised (NIST SP 800-63B-4). */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export type PasswordRuleFailure = 'too_short' | 'too_long';

/** Checks a new password against the length rules; null when it passes. */
export function checkNewPassword(password: string): PasswordRuleFailure | null {
  if (!hashable(password)) return 'too_long';
  if (codePoints(normalizePassword(password)) < PASSWORD_MIN_LENGTH) return 'too_short';
  return null;
}

/**
 * True when a submitted password may be hashed at all: at most PASSWORD_MAX_LENGTH code points
 * after normalisation. The UTF-16 length is checked first, so a body of a million characters is
 * refused without normalising it.
 */
export function hashable(password: string): boolean {
  if (password.length > PASSWORD_MAX_LENGTH * 2) return false;
  return codePoints(normalizePassword(password)) <= PASSWORD_MAX_LENGTH;
}

/** The refusal message for a rule failure (no part of the password in it). */
export function ruleMessage(reason: PasswordRuleFailure): string {
  return reason === 'too_short'
    ? `the password needs at least ${PASSWORD_MIN_LENGTH} characters`
    : `the password may have at most ${PASSWORD_MAX_LENGTH} characters`;
}
