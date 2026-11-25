// A run's request budget (S§5.1 "Guard first": "…; per-host limiter; budget"): at most so many
// requests reach the network for one run. Checked before each request; a request is counted only
// when it reached the network, so a refusal or a failure before sending costs nothing.

export interface RequestBudget {
  readonly maxRequests: number;
  /** Requests counted so far, those in flight included. */
  readonly used: number;
  readonly remaining: number;
  /** Takes one request; false when none is left. */
  take(): boolean;
  /** Gives back a request taken that never reached the network. */
  refund(): void;
}

export function createRequestBudget(maxRequests: number): RequestBudget {
  if (!Number.isInteger(maxRequests) || maxRequests < 0) {
    throw new RangeError(`maxRequests must be a non-negative integer, got ${maxRequests}`);
  }
  let used = 0;
  return {
    maxRequests,
    get used() {
      return used;
    },
    get remaining() {
      return maxRequests - used;
    },
    take() {
      if (used >= maxRequests) return false;
      used++;
      return true;
    },
    refund() {
      if (used > 0) used--;
    },
  };
}
