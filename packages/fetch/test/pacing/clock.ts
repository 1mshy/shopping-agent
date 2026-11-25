// A fake clock for the pacing tests: `now` and `sleep` on virtual time that moves only when the
// test runs it. No real timer is ever set; `flush` yields one macrotask so promise chains settle.
import type { Sleep } from '../../src/pacing/index.ts';

interface Timer {
  readonly at: number;
  readonly seq: number;
  readonly fire: () => void;
}

export class FakeClock {
  #t: number;
  #seq = 0;
  #timers: Timer[] = [];

  constructor(start: number) {
    this.#t = start;
  }

  readonly now = (): number => this.#t;

  readonly sleep: Sleep = (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer: Timer = {
        at: this.#t + Math.max(0, ms),
        seq: this.#seq++,
        fire: () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        },
      };
      const cancel = () => {
        this.#timers = this.#timers.filter((t) => t !== timer);
        resolve();
      };
      this.#timers.push(timer);
      signal.addEventListener('abort', cancel, { once: true });
    });

  /** Timers not yet fired. */
  get pending(): number {
    return this.#timers.length;
  }

  /** Lets every promise chain that can move without time move. */
  async flush(): Promise<void> {
    for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  /** Moves time forward by `ms`, firing every timer due on the way, in order. */
  async advance(ms: number): Promise<void> {
    await this.runUntil(this.#t + ms);
  }

  /** Runs timers in order until none is due at or before `end`; time ends at `end`. */
  async runUntil(end: number): Promise<void> {
    await this.flush();
    for (;;) {
      const next = this.#earliest();
      if (next === undefined || next.at > end) break;
      this.#fire(next);
      await this.flush();
    }
    this.#t = Math.max(this.#t, end);
  }

  /** Runs every timer, in order, until none is left (at most `limit` timers). */
  async runAll(limit = 10_000): Promise<void> {
    await this.flush();
    for (let i = 0; i < limit; i++) {
      const next = this.#earliest();
      if (next === undefined) return;
      this.#fire(next);
      await this.flush();
    }
    throw new Error(`more than ${limit} timers fired`);
  }

  #earliest(): Timer | undefined {
    let best: Timer | undefined;
    for (const t of this.#timers) {
      if (best === undefined || t.at < best.at || (t.at === best.at && t.seq < best.seq)) best = t;
    }
    return best;
  }

  #fire(timer: Timer): void {
    this.#timers = this.#timers.filter((t) => t !== timer);
    this.#t = Math.max(this.#t, timer.at);
    timer.fire();
  }
}

/** A random source that returns `values` in turn, then repeats them. */
export function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const value = values[i % values.length];
    i++;
    if (value === undefined) throw new Error('empty sequence');
    return value;
  };
}
