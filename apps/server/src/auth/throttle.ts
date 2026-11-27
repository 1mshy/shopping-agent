// Password-guessing throttle (S§5.13), in memory, on an injected clock. Login and the password
// change pass through it; setup does not (it succeeds once and then answers 409 forever).
//
// Per-client failures start an exponential lockout, cleared by success. Across clients, the
// first 20 failures are free. Under global pressure each verification waits a fixed second
// in one of two in-flight slots before accessing password state. Other failures cannot extend
// an admitted verification's wait. Completed failures expire after a day without a failure.

export interface ThrottleRule {
  /** Failures that cost nothing. */
  readonly free: number;
  /** The first lockout. */
  readonly baseMs: number;
  /** The longest lockout. */
  readonly maxMs: number;
  /** A key with no failure for this long starts afresh. */
  readonly forgetMs: number;
}

/** Per client address (an IPv6 address counts by its /64). */
export const LOGIN_THROTTLE_PER_CLIENT: ThrottleRule = {
  free: 5,
  baseMs: 1_000,
  maxMs: 15 * 60_000,
  forgetMs: 24 * 3_600_000,
};

/** Global pressure adds a fixed wait to each admitted verification. */
export const LOGIN_THROTTLE_GLOBAL: ThrottleRule = {
  free: 20,
  baseMs: 1_000,
  maxMs: 1_000,
  forgetMs: 24 * 3_600_000,
};

/** Verifications allowed to run at once, across every client. */
export const MAX_IN_FLIGHT = 2;

/** Per-client entries kept at most; the oldest are dropped first. */
const MAX_KEYS = 10_000;

interface Entry {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
}

export type Admission =
  | { readonly admitted: true; readonly ticket: Ticket }
  | { readonly admitted: false; readonly retryAfterMs: number };

export interface Ticket {
  /** Resolves when this admitted verification may read and check password state. */
  readonly ready: Promise<void>;
  /** The password was right: refunds the attempt and clears the client's failures. */
  succeed(): void;
  /** The password was wrong (the attempt already counts; this only ends it). */
  fail(): void;
}

export interface LoginThrottle {
  /** Admits one attempt from `client`, or says how long to wait. */
  admit(client: string): Admission;
}

export interface ThrottleOptions {
  readonly now: () => number;
  readonly perClient?: ThrottleRule;
  readonly global?: ThrottleRule;
  readonly maxInFlight?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function lockFor(rule: ThrottleRule, failures: number): number {
  if (failures <= rule.free) return 0;
  const exponent = Math.min(failures - rule.free - 1, 30);
  return Math.min(rule.baseMs * 2 ** exponent, rule.maxMs);
}

export function createLoginThrottle(options: ThrottleOptions): LoginThrottle {
  const perClient = options.perClient ?? LOGIN_THROTTLE_PER_CLIENT;
  const globalRule = options.global ?? LOGIN_THROTTLE_GLOBAL;
  const maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
  const clients = new Map<string, Entry>();
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let globalFailures = 0;
  let globalLastFailureAt: number | null = null;
  let inFlight = 0;

  function fresh(entry: Entry, rule: ThrottleRule, now: number): void {
    if (
      entry.failures > 0 &&
      now >= entry.lockedUntil &&
      now - entry.lastFailureAt >= rule.forgetMs
    ) {
      entry.failures = 0;
      entry.lockedUntil = 0;
    }
  }

  function record(entry: Entry, rule: ThrottleRule, now: number): void {
    entry.failures += 1;
    entry.lastFailureAt = now;
    const lock = lockFor(rule, entry.failures);
    if (lock > 0) entry.lockedUntil = Math.max(entry.lockedUntil, now + lock);
  }

  function clientEntry(client: string, now: number): Entry {
    let entry = clients.get(client);
    if (entry === undefined) {
      if (clients.size >= MAX_KEYS) {
        for (const [key, old] of clients) {
          if (now >= old.lockedUntil && now - old.lastFailureAt >= perClient.forgetMs) {
            clients.delete(key);
          }
        }
        // Still full: drop the oldest insertions.
        for (const key of clients.keys()) {
          if (clients.size < MAX_KEYS) break;
          clients.delete(key);
        }
      }
      entry = { failures: 0, lastFailureAt: now, lockedUntil: 0 };
      clients.set(client, entry);
    }
    return entry;
  }

  return {
    admit(client) {
      const now = options.now();
      const entry = clientEntry(client, now);
      fresh(entry, perClient, now);
      const wait = entry.lockedUntil - now;
      if (wait > 0) return { admitted: false, retryAfterMs: wait };
      if (inFlight >= maxInFlight) return { admitted: false, retryAfterMs: 1_000 };

      if (globalLastFailureAt !== null && now - globalLastFailureAt >= globalRule.forgetMs) {
        globalFailures = 0;
        globalLastFailureAt = null;
      }
      // Reserve unfinished attempts against the free allowance before admitting a concurrent one.
      const paced = globalFailures + inFlight >= globalRule.free;
      inFlight += 1;
      record(entry, perClient, now);
      let done = false;
      const end = () => {
        if (done) return false;
        done = true;
        inFlight -= 1;
        return true;
      };
      return {
        admitted: true,
        ticket: {
          ready: paced ? sleep(Math.min(globalRule.baseMs, globalRule.maxMs)) : Promise.resolve(),
          succeed() {
            if (!end()) return;
            clients.delete(client);
          },
          fail() {
            if (!end()) return;
            globalFailures = Math.min(globalRule.free, globalFailures + 1);
            globalLastFailureAt = options.now();
          },
        },
      };
    },
  };
}
