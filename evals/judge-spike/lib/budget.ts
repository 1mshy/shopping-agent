// The four budgets of S§2.6, enforced in code before every call: calls, input tokens, wall clock
// and money. The spike runs its calls one at a time, so a reservation is just the worst case of
// the next call (S§5.7: "Money caps reserve before concurrent calls and settle after").
//
// What each cap guarantees:
// - calls: exact; a call is never started past the cap.
// - input tokens: the next call's input is estimated (lib/tokens.ts) and checked before it is
//   sent; it is charged afterwards with the server's count, or the estimate when none is
//   reported. An estimate below the real count can overshoot within that one call.
// - deadline: no call starts at or past the deadline, and each call is aborted when it is reached.
// - spend: with prices, the worst case of the next call (estimated input plus the full output
//   allowance, at the given prices) is reserved and checked before the call, and a call whose
//   cost stays unknown is charged that reserve. Without prices the cap cannot be guaranteed: the
//   run then needs --accept-unknown-cost and can stop only once known spend has reached the cap.

export type BudgetHit = 'calls' | 'input_tokens' | 'deadline' | 'spend';

export interface Budgets {
  readonly maxCalls: number;
  readonly maxInputTokens: number;
  readonly deadlineMs: number;
  readonly maxSpendNanos: number;
}

/** Settings prices, in nano-units of the spend currency per million tokens. */
export interface Prices {
  readonly inputNanosPerMTok: number;
  readonly outputNanosPerMTok: number;
}

/** Cost at the given prices, in whole nano-units, rounded up. Every input token is charged at the
 * input price, cached or not: an upper bound where a cache discount applies. */
export function costFromPrices(inputTokens: number, outputTokens: number, p: Prices): number {
  const total =
    BigInt(inputTokens) * BigInt(p.inputNanosPerMTok) +
    BigInt(outputTokens) * BigInt(p.outputNanosPerMTok);
  const nanos = total / 1_000_000n + (total % 1_000_000n > 0n ? 1n : 0n);
  return Number(nanos);
}

export interface CallPlan {
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
}

export type Admission =
  | { readonly ok: true; readonly reserveNanos: number | null }
  | { readonly ok: false; readonly hit: BudgetHit };

export interface Settlement {
  /** The server's input count, or null when it reported none. */
  readonly inputTokens: number | null;
  readonly estimatedInputTokens: number;
  /** The call's known cost, or null when it is unknown. */
  readonly costNanos: number | null;
  readonly reserveNanos: number | null;
}

export interface LedgerState {
  readonly calls: number;
  readonly inputTokens: number;
  /** Known costs, plus the reserve of every call whose cost stayed unknown when prices exist. */
  readonly spendNanos: number;
  readonly unknownCostCalls: number;
  readonly elapsedMs: number;
}

export class BudgetLedger {
  readonly #budgets: Budgets;
  readonly #prices: Prices | null;
  readonly #now: () => number;
  readonly #start: number;
  #calls = 0;
  #inputTokens = 0;
  #spendNanos = 0;
  #unknownCostCalls = 0;

  constructor(budgets: Budgets, prices: Prices | null, now: () => number) {
    this.#budgets = budgets;
    this.#prices = prices;
    this.#now = now;
    this.#start = now();
  }

  remainingMs(): number {
    return this.#budgets.deadlineMs - (this.#now() - this.#start);
  }

  /** Checked before every call, the repair retry included. */
  admit(plan: CallPlan): Admission {
    const b = this.#budgets;
    if (this.#calls + 1 > b.maxCalls) return { ok: false, hit: 'calls' };
    if (this.remainingMs() <= 0) return { ok: false, hit: 'deadline' };
    if (this.#inputTokens + plan.estimatedInputTokens > b.maxInputTokens) {
      return { ok: false, hit: 'input_tokens' };
    }
    if (this.#prices === null) {
      if (this.#spendNanos >= b.maxSpendNanos) return { ok: false, hit: 'spend' };
      return { ok: true, reserveNanos: null };
    }
    const reserve = costFromPrices(plan.estimatedInputTokens, plan.maxOutputTokens, this.#prices);
    if (this.#spendNanos + reserve > b.maxSpendNanos) return { ok: false, hit: 'spend' };
    return { ok: true, reserveNanos: reserve };
  }

  /** Called once after every call that was sent, whatever its outcome. */
  settle(s: Settlement): void {
    this.#calls++;
    this.#inputTokens += s.inputTokens ?? s.estimatedInputTokens;
    if (s.costNanos !== null) this.#spendNanos += s.costNanos;
    else {
      this.#unknownCostCalls++;
      if (s.reserveNanos !== null) this.#spendNanos += s.reserveNanos;
    }
  }

  state(): LedgerState {
    return {
      calls: this.#calls,
      inputTokens: this.#inputTokens,
      spendNanos: this.#spendNanos,
      unknownCostCalls: this.#unknownCostCalls,
      elapsedMs: this.#now() - this.#start,
    };
  }
}
