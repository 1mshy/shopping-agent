// A first-come, first-served semaphore whose waiters give up at a deadline or on abort. One per
// host (capacity 1: one request in flight) and one for the pool of hosts in flight.

/** Waits `ms` on the injected clock, or less when `signal` aborts. Never rejects. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** The real Sleep, on the process timers. */
export const timerSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, { once: true });
  });

export type GateEntry = 'granted' | 'deadline' | 'aborted';

interface Waiter {
  /** Hands the waiter a place; false when it had already given up. */
  grant(): boolean;
}

export class Gate {
  readonly #capacity: number;
  readonly #now: () => number;
  readonly #sleep: Sleep;
  readonly #waiters: Waiter[] = [];
  #held = 0;

  constructor(capacity: number, now: () => number, sleep: Sleep) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#capacity = capacity;
    this.#now = now;
    this.#sleep = sleep;
  }

  /** True when nobody holds a place and nobody waits. */
  get idle(): boolean {
    return this.#held === 0 && this.#waiters.length === 0;
  }

  /**
   * A place, in arrival order. Gives up at `deadline` (epoch ms on the injected clock) or when
   * `signal` aborts, leaving the queue as if it had never joined.
   */
  enter(deadline: number, signal: AbortSignal): Promise<GateEntry> {
    if (signal.aborted) return Promise.resolve('aborted');
    if (this.#held < this.#capacity && this.#waiters.length === 0) {
      this.#held++;
      return Promise.resolve('granted');
    }
    return new Promise<GateEntry>((resolve) => {
      let settled = false;
      const stopTimer = new AbortController();
      const settle = (entry: GateEntry): boolean => {
        if (settled) return false;
        settled = true;
        stopTimer.abort();
        signal.removeEventListener('abort', onAbort);
        if (entry !== 'granted') {
          const at = this.#waiters.indexOf(waiter);
          if (at !== -1) this.#waiters.splice(at, 1);
        }
        resolve(entry);
        return true;
      };
      const waiter: Waiter = { grant: () => settle('granted') };
      const onAbort = () => settle('aborted');
      this.#waiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
      void this.#sleep(Math.max(0, deadline - this.#now()), stopTimer.signal).then(() => {
        if (!stopTimer.signal.aborted) settle('deadline');
      });
    });
  }

  /** Gives a place back: straight to the first waiter still waiting, else to the pool. */
  leave(): void {
    if (this.#held === 0) throw new Error('leave() without a place');
    for (let waiter = this.#waiters.shift(); waiter !== undefined; waiter = this.#waiters.shift()) {
      if (waiter.grant()) return;
    }
    this.#held--;
  }
}
