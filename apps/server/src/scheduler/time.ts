// The scheduler's clock and timers are injected: tests drive a fake clock, and the loop never
// trusts a timer to fire on time. After a laptop sleep or a paused container a timer fires late,
// or all at once, so every wake reads the wall clock again and decides from it.

/** Wall-clock time in epoch milliseconds. */
export type Now = () => number;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Node's timers, unref'd so a pending wake never keeps the process alive on its own. */
export const nodeTimers: Timers = {
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** The S§4 timestamp form: UTC, exactly three fractional digits. */
export function iso(ms: number): string {
  return new Date(Math.floor(ms)).toISOString();
}

export function ms(at: string): number {
  return Date.parse(at);
}

/**
 * Resolves once the wall clock has reached `atMs`. Each timer is at most `maxStepMs` long and the
 * clock is read again when it fires, so a timer that fires early (a clock step) or late (a sleep)
 * neither ends the wait too soon nor stretches it. Rejects with the signal's reason on abort.
 */
export function sleepUntil(
  now: Now,
  timers: Timers,
  atMs: number,
  maxStepMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let handle: unknown;
    const onAbort = () => {
      timers.clearTimeout(handle);
      reject(signal.reason);
    };
    const check = () => {
      if (signal.aborted) return;
      const left = atMs - now();
      if (left <= 0) {
        signal.removeEventListener('abort', onAbort);
        resolve();
        return;
      }
      handle = timers.setTimeout(check, Math.min(left, maxStepMs));
    };
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}
