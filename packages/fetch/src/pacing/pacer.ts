// Per-host pacing (S§5.1 Pacing; progress log, Phase 1, "Migration 0002"): one request in flight
// per host, 2.5 s × jitter(0.85-1.3) between starts, shared by every rung, and a pool bounding the
// hosts in flight at once. The earliest next start per host is kept in `host_pacing`, so a
// restart does not reset it; "one in flight" is process memory.
//
// A request's turn, in order:
//   1. the host's turn, first come first served (one in flight per host);
//   2. the host's earliest next start: read from the store, waited for on the injected clock;
//   3. a place in the pool of hosts in flight.
// Each wait ends at the request's deadline (`closed`: the caller refuses with `host_limit`) or when
// its signal aborts. A request whose host cannot start before its deadline is refused at once,
// without waiting for nothing.
//
// The interval is counted between starts, and a start is the moment the request first reaches the
// network (the slot's `started()`, called by the fetcher at the transport's first exchange). A
// request refused by the guard or failing before it sends anything never calls it, so it leaves the
// host's next start where it was and the next request goes straight on.
import { Gate, type Sleep } from './gate.ts';
import type { PacingStore } from './store.ts';

/** S§5.1: "2.5 s between starts". */
export const PACING_INTERVAL_MS = 2_500;

/** S§5.1: "with 0.85-1.3 jitter", a multiplier of the interval: gaps of 2,125 to 3,250 ms. */
export const PACING_JITTER: readonly [number, number] = [0.85, 1.3];

/** S§5.1: "about 12 concurrent HTTP hosts". */
export const HTTP_HOST_POOL = 12;

/**
 * The longest a host is ever closed by pacing, from now. A Retry-After beyond it is shortened to
 * it (a longer pause is the playbook's back-off, not pacing), and a stored next start beyond it
 * cannot have been written on this clock: the clock jumped back, or the row is corrupt. Such a
 * value is bounded to now + this, and the bound is written back, so the host opens at most one
 * hour later whatever the stored value said.
 */
export const MAX_HOST_PAUSE_MS = 60 * 60 * 1_000;

/**
 * The pause after a `rate_limited` outcome that gave no Retry-After. The spec names none; a 429
 * without a delay still says "slower", and one minute is this unit's choice (the fetcher applies
 * it; the pacer only takes a pause in milliseconds).
 */
export const RATE_LIMITED_DEFAULT_PAUSE_MS = 60_000;

export interface PacerDeps {
  readonly store: PacingStore;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly sleep: Sleep;
  /** Uniform in [0, 1), like Math.random. */
  readonly random: () => number;
  /** Hosts in flight at once (default `HTTP_HOST_POOL`). */
  readonly maxHosts?: number;
  /**
   * A store write that failed after the request had reached the network. The in-process state
   * still paces the host; the failure must not turn into the request's outcome. Default: a warning.
   */
  readonly onStoreError?: (error: unknown) => void;
}

/** A granted turn. Exactly one `release()` per slot. */
export interface PacingSlot {
  /** The request reached the network now: the next start moves to now + the jittered interval. */
  started(): void;
  /** The host asked for a pause (Retry-After, ms): the next start moves to the later of the two. */
  pause(ms: number): void;
  /** Ends the turn: the next request to the host and the pool place go to the next waiter. */
  release(): void;
}

export type Admission =
  | { readonly kind: 'granted'; readonly slot: PacingSlot }
  /** Cannot start before the deadline; `until` is when the host opens, null when not known. */
  | { readonly kind: 'closed'; readonly until: number | null }
  | { readonly kind: 'aborted' };

export interface Pacer {
  acquire(
    host: string,
    request: { readonly deadline: number; readonly signal: AbortSignal },
  ): Promise<Admission>;
  /** The host's earliest next start (bounded as above), or null when it has none. */
  nextStart(host: string): number | null;
}

/** The jittered gap after a start: `PACING_INTERVAL_MS` × a multiplier in `PACING_JITTER`. */
export function jitteredGap(random: () => number): number {
  const r = random();
  if (!(r >= 0 && r < 1)) throw new RangeError(`random() must be in [0, 1), got ${r}`);
  const [low, high] = PACING_JITTER;
  return Math.ceil(PACING_INTERVAL_MS * (low + (high - low) * r));
}

const defaultStoreError = (error: unknown) => {
  console.warn('host_pacing: a write failed; pacing continues in memory', error);
};

export function createPacer(deps: PacerDeps): Pacer {
  const { store, now, sleep } = deps;
  const onStoreError = deps.onStoreError ?? defaultStoreError;
  const pool = new Gate(deps.maxHosts ?? HTTP_HOST_POOL, now, sleep);
  const hosts = new Map<string, Gate>();
  /** What this process last wrote per host: pacing holds even if the store fails a write. */
  const written = new Map<string, number>();

  const gateOf = (host: string): Gate => {
    let gate = hosts.get(host);
    if (gate === undefined) {
      gate = new Gate(1, now, sleep);
      hosts.set(host, gate);
    }
    return gate;
  };

  const persist = (host: string, at: number): void => {
    written.set(host, at);
    try {
      store.write(host, at);
    } catch (error) {
      onStoreError(error);
    }
  };

  const nextStart = (host: string): number | null => {
    const stored = store.read(host);
    const mine = written.get(host);
    let next = stored === null ? (mine ?? null) : Math.max(stored, mine ?? stored);
    if (next === null) return null;
    const bound = now() + MAX_HOST_PAUSE_MS;
    if (next > bound) {
      next = bound;
      persist(host, next);
    }
    return next;
  };

  const raise = (host: string, at: number): void => {
    const current = nextStart(host);
    if (current === null || at > current) persist(host, at);
  };

  const forget = (host: string): void => {
    const gate = hosts.get(host);
    if (gate?.idle) hosts.delete(host);
    const mine = written.get(host);
    if (mine !== undefined && mine <= now()) written.delete(host);
  };

  return {
    nextStart,

    async acquire(host, { deadline, signal }) {
      if (!Number.isFinite(deadline))
        throw new RangeError(`deadline must be a number: ${deadline}`);
      if (signal.aborted) return { kind: 'aborted' };
      // Closed past the deadline already: no point queueing.
      const early = nextStart(host);
      if (early !== null && early >= deadline) return { kind: 'closed', until: early };

      const gate = gateOf(host);
      const turn = await gate.enter(deadline, signal);
      if (turn !== 'granted') {
        forget(host);
        return turn === 'aborted'
          ? { kind: 'aborted' }
          : { kind: 'closed', until: nextStart(host) };
      }
      const giveUp = (admission: Admission): Admission => {
        gate.leave();
        forget(host);
        return admission;
      };

      // Holding the host's turn: whatever happens below, it is handed back or handed to the slot.
      let gap: number;
      try {
        for (;;) {
          const next = nextStart(host);
          const t = now();
          if (next !== null && next >= deadline) return giveUp({ kind: 'closed', until: next });
          if (next === null || next <= t) break;
          const stop = new AbortController();
          const onAbort = () => stop.abort();
          signal.addEventListener('abort', onAbort, { once: true });
          await sleep(next - t, stop.signal);
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) return giveUp({ kind: 'aborted' });
        }
        // Drawn before the start: `started()` runs inside the transport's exchange and must not
        // throw there (an error would become the request's network error).
        gap = jitteredGap(deps.random);
      } catch (error) {
        giveUp({ kind: 'aborted' });
        throw error;
      }

      const place = await pool.enter(deadline, signal);
      if (place !== 'granted') {
        return giveUp(place === 'aborted' ? { kind: 'aborted' } : { kind: 'closed', until: null });
      }

      let started = false;
      let released = false;
      const slot: PacingSlot = {
        started() {
          if (started || released) return;
          started = true;
          persist(host, now() + gap);
        },
        pause(ms) {
          if (released || !Number.isFinite(ms) || ms <= 0) return;
          try {
            raise(host, now() + Math.min(ms, MAX_HOST_PAUSE_MS));
          } catch (error) {
            onStoreError(error);
          }
        },
        release() {
          if (released) return;
          released = true;
          pool.leave();
          gate.leave();
          forget(host);
        },
      };
      return { kind: 'granted', slot };
    },
  };
}
