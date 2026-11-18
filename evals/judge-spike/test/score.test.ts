import { describe, expect, it } from 'vitest';
import { formatRatio, ratio, scoreRelation } from '../lib/score.ts';

describe('scoring one judgement (plain reading)', () => {
  it('is right about exact only when both say exact', () => {
    expect(scoreRelation({ relation: 'exact' }, 'exact')).toBe('true_accept');
  });

  it('calls exact on a single non-exact gold, or on any set, a false accept', () => {
    expect(scoreRelation({ relation: 'variant' }, 'exact')).toBe('false_accept');
    expect(scoreRelation({ relation: 'unknown' }, 'exact')).toBe('false_accept');
    expect(scoreRelation({ oneOf: ['other_line', 'unknown'] }, 'exact')).toBe('false_accept');
  });

  it('counts unknown from the judge as an abstention, whatever the gold', () => {
    expect(scoreRelation({ relation: 'exact' }, 'unknown')).toBe('abstain');
    expect(scoreRelation({ relation: 'variant' }, 'unknown')).toBe('abstain');
    expect(scoreRelation({ oneOf: ['variant', 'unknown'] }, 'unknown')).toBe('abstain');
  });

  it('separates a wrong non-exact relation from a false accept', () => {
    expect(scoreRelation({ relation: 'variant' }, 'variant')).toBe('correct_reject');
    expect(scoreRelation({ relation: 'variant' }, 'bundle')).toBe('wrong_relation');
    expect(scoreRelation({ oneOf: ['variant', 'bundle'] }, 'bundle')).toBe('correct_reject');
    expect(scoreRelation({ oneOf: ['variant', 'bundle'] }, 'other_line')).toBe('wrong_relation');
    // A single `unknown` gold rejected with a decided relation: not what the evidence supports.
    expect(scoreRelation({ relation: 'unknown' }, 'other_model')).toBe('wrong_relation');
  });

  it('calls a rejection of an exact gold a false reject', () => {
    expect(scoreRelation({ relation: 'exact' }, 'variant')).toBe('false_reject');
  });
});

describe('the veto-only reading (S§5.4: a small local model may only veto)', () => {
  it('ignores the model’s exact: it becomes an abstention', () => {
    expect(scoreRelation({ relation: 'exact' }, 'exact', 'veto-only')).toBe('abstain');
    expect(scoreRelation({ relation: 'variant' }, 'exact', 'veto-only')).toBe('abstain');
  });

  it('keeps its rejections', () => {
    expect(scoreRelation({ relation: 'variant' }, 'variant', 'veto-only')).toBe('correct_reject');
    expect(scoreRelation({ relation: 'exact' }, 'other_line', 'veto-only')).toBe('false_reject');
  });
});

describe('ratios', () => {
  it('carry numerator and denominator, and are undefined over zero', () => {
    expect(ratio(1, 3)).toEqual({ num: 1, den: 3, value: 1 / 3 });
    expect(ratio(0, 0)).toEqual({ num: 0, den: 0, value: null });
    expect(formatRatio(ratio(1, 3))).toBe('1/3 = 0.333');
    expect(formatRatio(ratio(0, 0))).toBe('0/0 = undefined');
    expect(formatRatio(ratio(2, 2))).toBe('2/2 = 1.000');
  });
});
