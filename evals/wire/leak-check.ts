// Temporary stub (review round 1, tests-first commit): the old check, moved behind its new
// module name so the new tests fail one by one. Replaced in the next commit.
import type { WireFixture } from './format.ts';
import { findSecretLeaks as old } from './redact.ts';

export function findSecretLeaks(
  f: WireFixture,
  secrets: readonly string[],
  _extra: Readonly<Record<string, string>> = {},
): string[] {
  return old(f, secrets);
}
