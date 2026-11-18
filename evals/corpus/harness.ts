// The fixture corpus harness (plan P0 workstream 3, CONTRIBUTING rule 2).
//
// A behaviour ported from the predecessor lands here as golden cases before its implementation
// exists. Until then the subject under test is a stub that throws NotImplementedError, and a
// case "fails for the right reason": it is counted as pending only when the subject throws
// exactly that. Any other error fails the test, and so does a subject that answers while its
// area is still marked pending, so the count of pending cases cannot drift from the truth.
// When the implementation lands, its unit points the area's test at the real function and
// flips the area to `implemented`; from then on every case must pass.
import { describe, expect, test } from 'vitest';

export class NotImplementedError extends Error {
  override name = 'NotImplementedError';
  readonly subject: string;
  constructor(subject: string) {
    super(`not implemented: ${subject}`);
    this.subject = subject;
  }
}

/** The stub for a subject that does not exist yet. */
export function notImplemented(subject: string): never {
  throw new NotImplementedError(subject);
}

export type AreaStatus = 'pending' | 'implemented';

export interface Area<C extends { readonly id: string }> {
  /** Kebab-case, unique in the corpus, equal to the directory name under `areas/`. */
  readonly id: string;
  readonly status: AreaStatus;
  /** What the cases were ported from: predecessor files and tests, with the commit read. */
  readonly sources: readonly string[];
  readonly cases: readonly C[];
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Checks an area's shape: a kebab-case id, at least one case, unique kebab-case case ids. */
export function defineArea<C extends { readonly id: string }>(area: Area<C>): Area<C> {
  if (!ID.test(area.id)) throw new Error(`area id "${area.id}" is not kebab-case`);
  if (area.sources.length === 0) throw new Error(`area ${area.id} names no source`);
  if (area.cases.length === 0) throw new Error(`area ${area.id} has no cases`);
  const seen = new Set<string>();
  for (const c of area.cases) {
    if (!ID.test(c.id)) throw new Error(`case id "${c.id}" in ${area.id} is not kebab-case`);
    if (seen.has(c.id)) throw new Error(`case id "${c.id}" appears twice in ${area.id}`);
    seen.add(c.id);
  }
  return area;
}

export type CaseOutcome = 'pending' | 'passed';

/**
 * Runs one case. Pending area: the subject must throw NotImplementedError. Implemented area: the
 * subject must answer and `verify` must accept the answer. Everything else throws.
 */
export async function runCase<T>(
  status: AreaStatus,
  run: () => T | Promise<T>,
  verify: (actual: T) => void | Promise<void>,
): Promise<CaseOutcome> {
  let actual: T;
  try {
    actual = await run();
  } catch (err) {
    if (!(err instanceof NotImplementedError)) throw err;
    if (status === 'implemented') {
      throw new Error(`the area is marked implemented, but ${err.subject} is not implemented`);
    }
    return 'pending';
  }
  if (status === 'pending') {
    throw new Error(
      'the subject answered, but the area is still marked pending: mark it implemented',
    );
  }
  await verify(actual);
  return 'passed';
}

/** Registers one test per case. `verify` asserts with `expect`; it is not run while pending. */
export function corpusTests<C extends { readonly id: string }, T>(
  area: Area<C>,
  run: (c: C) => T | Promise<T>,
  verify: (c: C, actual: T) => void | Promise<void>,
): void {
  describe(`corpus: ${area.id} (${area.status})`, () => {
    for (const c of area.cases) {
      test(c.id, async () => {
        const outcome = await runCase(
          area.status,
          () => run(c),
          (actual) => verify(c, actual),
        );
        expect(outcome).toBe(area.status === 'pending' ? 'pending' : 'passed');
      });
    }
  });
}
