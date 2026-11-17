import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pacer } from './pacer.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Records when each call started and lets the test decide when it finishes. */
function recorder() {
  const starts: Array<{ host: string; at: number }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const task = (host: string, ms: number) => async () => {
    starts.push({ host, at: Date.now() });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
  };
  return { starts, task, max: () => maxInFlight };
}

describe('Pacer', () => {
  it('spaces starts to one host by at least 2.5 s and at most 2.5 s x 1.3', async () => {
    for (const [random, gap] of [
      [0, 2500], // 0.85 x 2.5 s is below the floor, so the floor applies
      [1, 3250],
      [0.5, 2687.5],
    ] as const) {
      vi.setSystemTime(0);
      const pacer = new Pacer({ random: () => random });
      const r = recorder();
      const runs = [0, 1, 2].map(() => pacer.run('a.example', r.task('a.example', 100)));
      await vi.runAllTimersAsync();
      await Promise.all(runs);
      expect(r.starts.map((s) => s.at)).toEqual([0, gap, 2 * gap]);
    }
  });

  it('keeps one request in flight per host even when a request outlasts the gap', async () => {
    const pacer = new Pacer({ random: () => 0 });
    const r = recorder();
    const runs = [
      pacer.run('a.example', r.task('a', 10_000)),
      pacer.run('a.example', r.task('a', 10)),
    ];
    await vi.runAllTimersAsync();
    await Promise.all(runs);
    expect(r.starts.map((s) => s.at)).toEqual([0, 10_000]);
  });

  it('runs different hosts concurrently but never more than maxInFlight', async () => {
    const pacer = new Pacer({ random: () => 0, maxInFlight: 12 });
    const r = recorder();
    const runs = Array.from({ length: 13 }, (_, i) =>
      pacer.run(`h${i}.example`, r.task(`h${i}`, 1000)),
    );
    await vi.runAllTimersAsync();
    await Promise.all(runs);
    expect(r.max()).toBe(12);
    expect(r.starts.filter((s) => s.at === 0)).toHaveLength(12);
    expect(r.starts[12]?.at).toBe(1000);
  });

  it('defers the next start to a host after a Retry-After', async () => {
    const pacer = new Pacer({ random: () => 0 });
    const r = recorder();
    await pacer.run('a.example', r.task('a', 10));
    pacer.defer('a.example', 30_000);
    const next = pacer.run('a.example', r.task('a', 10));
    await vi.runAllTimersAsync();
    await next;
    expect(r.starts[1]?.at).toBeGreaterThanOrEqual(30_000);
  });
});
