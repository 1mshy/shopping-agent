// Assertion helpers for the contract tests. A refusal is checked at the path it names, so a test
// fails if a record is refused for some other reason than the rule under test.
import { expect } from 'vitest';
import type { z } from 'zod';

export function expectValid(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value);
  expect(result.success ? [] : result.error.issues).toEqual([]);
}

/** Asserts a refusal with an issue at `path` (dot-joined; '' for the record itself). */
export function expectRefused(schema: z.ZodType, value: unknown, path: string): void {
  const result = schema.safeParse(value);
  expect(result.success, `expected a refusal at "${path}"`).toBe(false);
  if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain(path);
}
