// Beyond the corpus area watch-intake: encoding, a link kept as a name, and rules re-checked alone.
import { describe, expect, it } from 'vitest';
import { checkWatchRules, normaliseWatchInput } from '../../src/index.ts';

describe('normaliseWatchInput', () => {
  it('re-encodes kept parameters as the predecessor did (quote_plus)', () => {
    const n = normaliseWatchInput('https://shop.example/p?q=a b&x=(1)*~');
    expect(n).toEqual({
      ok: true,
      kind: 'product',
      value: 'https://shop.example/p?q=a+b&x=%281%29%2A~',
      key: 'url:https://shop.example/p?q=a+b&x=%281%29%2A~',
    });
  });

  it('two orders of the same parameters are one key', () => {
    const a = normaliseWatchInput('shop.example/p?b=2&a=1');
    const b = normaliseWatchInput('https://SHOP.example/p?a=1&b=2&utm_x=1');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  it('a link with no tracking parameter left has no "?"', () => {
    expect(normaliseWatchInput('https://shop.example/p?utm_source=x&tag=y')).toMatchObject({
      value: 'https://shop.example/p',
    });
  });

  it('a name with tabs collapses to single spaces', () => {
    expect(normaliseWatchInput('Bambu\tLab   P1S')).toMatchObject({
      kind: 'query',
      value: 'Bambu Lab P1S',
      key: 'query:bambu lab p1s',
    });
  });

  it('counts characters, not UTF-16 units, against the limit', () => {
    expect(normaliseWatchInput('😀'.repeat(1000)).ok).toBe(true);
    expect(normaliseWatchInput('😀'.repeat(1001)).ok).toBe(false);
  });
});

describe('checkWatchRules', () => {
  const none = { targetPrice: null, dropBasisPoints: null, restock: false, cooldownSeconds: null };
  it('applies the 5% drop default only when no rule is given', () => {
    expect(checkWatchRules(none)).toEqual({
      ok: true,
      rules: { targetPrice: null, dropBasisPoints: 500, restock: false, cooldownSeconds: 43200 },
    });
    expect(
      checkWatchRules({ ...none, targetPrice: { amountMinor: 100, currency: 'CAD' } }),
    ).toMatchObject({ ok: true, rules: { dropBasisPoints: null } });
  });

  it('refuses a fractional drop, a zero target and a 59-minute cooldown', () => {
    expect(checkWatchRules({ ...none, dropBasisPoints: 1.5 })).toMatchObject({
      refusal: 'drop_out_of_range',
    });
    expect(
      checkWatchRules({ ...none, targetPrice: { amountMinor: 0, currency: 'CAD' } }),
    ).toMatchObject({ refusal: 'target_not_positive' });
    expect(checkWatchRules({ ...none, cooldownSeconds: 3599 })).toMatchObject({
      refusal: 'cooldown_too_short',
    });
  });
});
