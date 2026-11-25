import type { MatchVerdict } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { effectiveVerdict } from '../../src/matching/verdicts.ts';

const now = { matcherVersion: 'matcher-2', promptVersion: 'judge.v1', modelId: 'model-a' };

function v(more: Partial<MatchVerdict>): MatchVerdict {
  const decidedBy = more.decidedBy ?? 'rules';
  return {
    specFp: 'spec1:a',
    listingFp: 'listing1:b',
    relation: 'unknown',
    differingAttrs: [],
    decidedBy,
    matcherVersion: 'matcher-2',
    promptVersion: decidedBy === 'model' ? 'judge.v1' : null,
    modelId: decidedBy === 'model' ? 'model-a' : null,
    decidedAt: '2026-11-20T10:00:00.000Z',
    ...more,
  };
}

describe('person overrides take precedence', () => {
  it('a person beats an identifier, the rules and the model', () => {
    const person = v({ decidedBy: 'person', relation: 'other_model', differingAttrs: ['model'] });
    const verdicts = [
      v({ decidedBy: 'identifier', relation: 'exact' }),
      v({ decidedBy: 'rules', relation: 'exact' }),
      v({ decidedBy: 'model', relation: 'exact' }),
      person,
    ];
    expect(effectiveVerdict(verdicts, now)).toBe(person);
  });

  it('a person beats them whatever the matcher version it was made under', () => {
    const person = v({ decidedBy: 'person', relation: 'exact', matcherVersion: 'matcher-1' });
    expect(effectiveVerdict([v({ relation: 'variant' }), person], now)).toBe(person);
  });

  it('the latest person override wins', () => {
    const first = v({
      decidedBy: 'person',
      relation: 'exact',
      decidedAt: '2026-11-20T10:00:00.000Z',
    });
    const second = v({
      decidedBy: 'person',
      relation: 'variant',
      decidedAt: '2026-11-21T10:00:00.000Z',
    });
    expect(effectiveVerdict([second, first], now)).toBe(second);
  });
});

describe('without a person', () => {
  it('only verdicts of the current matcher, prompt and model count', () => {
    expect(
      effectiveVerdict([v({ relation: 'exact', matcherVersion: 'matcher-1' })], now),
    ).toBeNull();
    expect(
      effectiveVerdict([v({ decidedBy: 'model', relation: 'exact', modelId: 'model-b' })], now),
    ).toBeNull();
    expect(effectiveVerdict([], now)).toBeNull();
  });

  it('a decided verdict beats an undecided one: the judge settles what the rules left open', () => {
    const judge = v({ decidedBy: 'model', relation: 'exact' });
    expect(effectiveVerdict([v({ relation: 'unknown' }), judge], now)).toBe(judge);
  });

  it('identifier before rules before model, then the latest', () => {
    const id = v({ decidedBy: 'identifier', relation: 'exact' });
    expect(effectiveVerdict([v({ relation: 'variant' }), id], now)).toBe(id);
    const newer = v({ relation: 'variant', decidedAt: '2026-11-22T10:00:00.000Z' });
    expect(effectiveVerdict([v({ relation: 'other_model' }), newer], now)).toBe(newer);
  });
});
