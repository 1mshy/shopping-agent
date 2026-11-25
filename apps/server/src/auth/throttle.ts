// Password-guessing throttle (S§5.13), in memory, on an injected clock. Login and the password
// change pass through it; setup does not (it succeeds once and then answers 409 forever).
//
// The rule, per key: the first `free` failures cost nothing; each failure after that locks the key
// for base × 2^(n − free − 1), doubling up to `max`. While a key is locked every attempt is refused
// with its Retry-After, without hashing anything and without counting as a failure, so the owner is
// never locked out for longer than one window. A key forgets its failures after `forget` without
// one. Two keys apply to every attempt: the client's address (LOGIN_THROTTLE_PER_CLIENT, reset by a
// success from that address) and one global key (LOGIN_THROTTLE_GLOBAL, never reset by a success,
// so many addresses together cannot guess faster than one lockout window allows).
//
// An attempt counts as a failure from the moment it starts (a success refunds it), so a burst of
// concurrent requests cannot all slip in before the first failure is recorded; and at most
// `maxInFlight` verifications run at once (each holds argon2's memory).

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

/** Every address together. */
export const LOGIN_THROTTLE_GLOBAL: ThrottleRule = {
  free: 20,
  baseMs: 1_000,
  maxMs: 15 * 60_000,
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
  const global: Entry = { failures: 0, lastFailureAt: 0, lockedUntil: 0 };
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
      fresh(global, globalRule, now);
      const wait = Math.max(entry.lockedUntil - now, global.lockedUntil - now, 0);
      if (wait > 0) return { admitted: false, retryAfterMs: wait };
      if (inFlight >= maxInFlight) return { admitted: false, retryAfterMs: 1_000 };

      inFlight += 1;
      record(entry, perClient, now);
      const globalLockBefore = global.lockedUntil;
      record(global, globalRule, now);
      const globalLockMine = global.lockedUntil;
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
          succeed() {
            if (!end()) return;
            clients.delete(client);
            // Only this attempt is refunded: a lockout that other failures set stays.
            global.failures = Math.max(0, global.failures - 1);
            if (global.lockedUntil === globalLockMine) global.lockedUntil = globalLockBefore;
          },
          fail() {
            end();
          },
        },
      };
    },
  };
}
