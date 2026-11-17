// Pacing (S§5.1): one request in flight per host, at least `minGapMs` between request starts to
// the same host with a 0.85-1.3 jitter multiplier, and at most `maxInFlight` requests (so hosts)
// in flight overall. The spec's "2.5 s with 0.85-1.3 jitter" would allow 2.125 s; the plan
// asks for at least 2.5 s, so the jittered gap is floored at `minGapMs` (2.5-3.25 s).

export interface PacerOptions {
  minGapMs?: number;
  jitter?: readonly [number, number];
  maxInFlight?: number;
  random?: () => number;
}

export class Pacer {
  readonly #minGap: number;
  readonly #jitter: readonly [number, number];
  readonly #max: number;
  readonly #random: () => number;
  readonly #tails = new Map<string, Promise<void>>();
  readonly #nextStart = new Map<string, number>();
  #inFlight = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(opts: PacerOptions = {}) {
    this.#minGap = opts.minGapMs ?? 2500;
    this.#jitter = opts.jitter ?? [0.85, 1.3];
    this.#max = opts.maxInFlight ?? 12;
    this.#random = opts.random ?? Math.random;
  }

  #gap(): number {
    const [lo, hi] = this.#jitter;
    return Math.ceil(Math.max(this.#minGap, this.#minGap * (lo + (hi - lo) * this.#random())));
  }

  /** Pushes the next start to `host` at least `ms` from now (a Retry-After). */
  defer(host: string, ms: number): void {
    this.#nextStart.set(host, Math.max(this.#nextStart.get(host) ?? 0, Date.now() + ms));
  }

  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#tails.get(host) ?? Promise.resolve();
    let release = () => {};
    const tail = prev.then(() => new Promise<void>((r) => (release = r)));
    this.#tails.set(host, tail);
    await prev;
    try {
      const wait = (this.#nextStart.get(host) ?? 0) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // A finishing request hands its slot straight to the next waiter.
      if (this.#inFlight >= this.#max) await new Promise<void>((r) => this.#waiters.push(r));
      else this.#inFlight++;
      this.#nextStart.set(host, Math.max(this.#nextStart.get(host) ?? 0, Date.now() + this.#gap()));
      try {
        return await fn();
      } finally {
        const next = this.#waiters.shift();
        if (next) next();
        else this.#inFlight--;
      }
    } finally {
      release();
      if (this.#tails.get(host) === tail) this.#tails.delete(host);
    }
  }
}
