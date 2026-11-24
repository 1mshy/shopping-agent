import { FETCH_OUTCOME_KINDS, FetchOutcome, RUNGS } from '@agentic-dasher/shared';
import { describe, expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { ClassifyPage, PageOutcome } from './contract.ts';

/** Phase 1 replaces this stub with the wall classifier of packages/fetch. */
const classifyPage: ClassifyPage = () => notImplemented('wall classifier (classifyPage)');

corpusTests(
  area,
  (c) => classifyPage(c.input),
  (c, actual: PageOutcome) => {
    expect(FetchOutcome.parse(actual)).toEqual(actual);
    if ('kindIn' in c.expected) {
      expect(c.expected.kindIn).toContain(actual.kind);
      expect(actual.rung).toBe(c.expected.rung);
    } else {
      expect(actual).toEqual(c.expected);
    }
  },
);

describe('wall-classification case data', () => {
  test.each(area.cases.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    const { input, expected } = c;
    expect(RUNGS).toContain(input.rung);
    expect(expected.rung).toBe(input.rung);
    if ('kindIn' in expected) {
      expect(expected.kindIn.length).toBeGreaterThan(1);
      expect(expected.kindIn).not.toContain('wall');
      for (const k of expected.kindIn) expect(FETCH_OUTCOME_KINDS).toContain(k);
    } else {
      expect(FetchOutcome.safeParse(expected).success).toBe(true);
    }
    expect(Number.isInteger(input.status) && input.status >= 100 && input.status <= 599).toBe(true);
    expect(() => new URL(input.finalUrl)).not.toThrow();
    for (const name of Object.keys(input.headers)) expect(name).toBe(name.toLowerCase());
    for (const signal of input.markup) {
      expect(signal.value).toBe(signal.value.toLowerCase());
      if (signal.in !== 'inline_script') expect(signal.value).not.toContain('?');
    }
    expect(input.title).toBe(input.title.trim());
    if (input.visibleText.length < input.visibleChars) expect(input.visibleText).toContain('…');
    else expect(input.visibleChars).toBe(input.visibleText.length);
    expect(Number.isInteger(input.documentBytes) && input.documentBytes > 0).toBe(true);
    expect(c.from.length).toBeGreaterThan(0);
    expect(c.established.length).toBeGreaterThan(0);
    // A divergence from the predecessor rests on the spec or on a ruling of 2026-11-23.
    if (c.divergence !== undefined) {
      expect(c.established.some((e) => e === 'spec' || e === 'ruling')).toBe(true);
    }
    // No e-mail address, cookie or token in a case.
    expect(JSON.stringify(c)).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });
});
