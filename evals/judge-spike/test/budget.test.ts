import { describe, expect, it } from 'vitest';
import { BudgetLedger, costFromPrices } from '../lib/budget.ts';

const big = { maxCalls: 100, maxInputTokens: 1_000_000, deadlineMs: 60_000, maxSpendNanos: 1e12 };
const plan = (estimatedInputTokens: number, maxOutputTokens = 100) => ({
  estimatedInputTokens,
  maxOutputTokens,
});

describe('settings prices', () => {
  it('cost whole tokens in nano-units per million, rounded up', () => {
    // 1 token at 1 nano per million tokens is 0.000001 nano: rounds up to 1.
    expect(costFromPrices(1, 0, { inputNanosPerMTok: 1, outputNanosPerMTok: 1 })).toBe(1);
    // 1M in at $0.15/M (150,000,000) plus 1M out at $0.60/M (600,000,000).
    const prices = { inputNanosPerMTok: 150_000_000, outputNanosPerMTok: 600_000_000 };
    expect(costFromPrices(1_000_000, 1_000_000, prices)).toBe(750_000_000);
    // 1,000 in at $0.15/M = 150,000 nanos exactly.
    expect(costFromPrices(1000, 0, prices)).toBe(150_000);
  });
});

describe('the budget ledger: every cap is checked before the call', () => {
  it('stops at the call cap', () => {
    const l = new BudgetLedger({ ...big, maxCalls: 2 }, null, () => 0);
    for (let i = 0; i < 2; i++) {
      expect(l.admit(plan(10)).ok).toBe(true);
      l.settle({ inputTokens: 10, estimatedInputTokens: 10, costNanos: null, reserveNanos: null });
    }
    expect(l.admit(plan(10))).toEqual({ ok: false, hit: 'calls' });
  });

  it('stops before a call whose estimated input would pass the token cap', () => {
    const l = new BudgetLedger({ ...big, maxInputTokens: 1000 }, null, () => 0);
    expect(l.admit(plan(600)).ok).toBe(true);
    l.settle({ inputTokens: 600, estimatedInputTokens: 600, costNanos: null, reserveNanos: null });
    expect(l.admit(plan(500))).toEqual({ ok: false, hit: 'input_tokens' });
    // 600 + 400 = 1000 is at the cap, not past it.
    expect(l.admit(plan(400)).ok).toBe(true);
  });

  it('charges the estimate when the server reports no input tokens', () => {
    const l = new BudgetLedger({ ...big, maxInputTokens: 1000 }, null, () => 0);
    l.settle({ inputTokens: null, estimatedInputTokens: 700, costNanos: null, reserveNanos: null });
    expect(l.state().inputTokens).toBe(700);
    expect(l.admit(plan(301))).toEqual({ ok: false, hit: 'input_tokens' });
  });

  it('stops at the wall-clock deadline and says how long is left', () => {
    let now = 1000;
    const l = new BudgetLedger({ ...big, deadlineMs: 10_000 }, null, () => now);
    now = 10_999;
    expect(l.admit(plan(1)).ok).toBe(true);
    expect(l.remainingMs()).toBe(1);
    now = 11_000;
    expect(l.admit(plan(1))).toEqual({ ok: false, hit: 'deadline' });
  });

  it('reserves the worst case from prices before the call, and charges the reserve when the cost stays unknown', () => {
    const prices = { inputNanosPerMTok: 1e9, outputNanosPerMTok: 1e9 }; // 1,000 nanos a token
    const l = new BudgetLedger({ ...big, maxSpendNanos: 300_000 }, prices, () => 0);
    const first = l.admit(plan(100, 100));
    // (100 in + 100 out) x 1,000 = 200,000 reserved, under 300,000.
    expect(first).toEqual({ ok: true, reserveNanos: 200_000 });
    l.settle({
      inputTokens: 100,
      estimatedInputTokens: 100,
      costNanos: null,
      reserveNanos: 200_000,
    });
    expect(l.state().spendNanos).toBe(200_000);
    // 200,000 + 200,000 > 300,000.
    expect(l.admit(plan(100, 100))).toEqual({ ok: false, hit: 'spend' });
  });

  it('settles with the known cost instead of the reserve', () => {
    const prices = { inputNanosPerMTok: 1e9, outputNanosPerMTok: 1e9 };
    const l = new BudgetLedger({ ...big, maxSpendNanos: 300_000 }, prices, () => 0);
    l.admit(plan(100, 100));
    l.settle({
      inputTokens: 100,
      estimatedInputTokens: 100,
      costNanos: 50_000,
      reserveNanos: 200_000,
    });
    expect(l.state().spendNanos).toBe(50_000);
    expect(l.admit(plan(100, 100)).ok).toBe(true);
  });

  it('without prices, can only stop after the known spend reaches the cap', () => {
    const l = new BudgetLedger({ ...big, maxSpendNanos: 300_000 }, null, () => 0);
    expect(l.admit(plan(100))).toEqual({ ok: true, reserveNanos: null });
    l.settle({
      inputTokens: 100,
      estimatedInputTokens: 100,
      costNanos: 250_000,
      reserveNanos: null,
    });
    expect(l.admit(plan(100)).ok).toBe(true);
    l.settle({ inputTokens: 100, estimatedInputTokens: 100, costNanos: null, reserveNanos: null });
    expect(l.state().unknownCostCalls).toBe(1);
    l.settle({
      inputTokens: 100,
      estimatedInputTokens: 100,
      costNanos: 50_000,
      reserveNanos: null,
    });
    expect(l.admit(plan(100))).toEqual({ ok: false, hit: 'spend' });
  });
});
