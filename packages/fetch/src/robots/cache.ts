// robots.txt answers per origin, in memory (S§5.1: "cached for a day"). Concurrent requests to one
// origin share one robots.txt request.
import type { PageResult } from '../page/index.ts';
import { interpretRobots, type RobotsAnswer, robotsAnswerTtl } from './policy.ts';

/** Origins kept at most; the oldest is dropped first. */
export const ROBOTS_CACHE_ORIGINS = 2_048;

export interface RobotsCache {
  /**
   * The answer for `robotsUrl`: a fresh cached one, the one a concurrent caller is fetching, or a
   * new one from `fetch`. `cached` is false only when this caller's `fetch` ran.
   */
  answer(
    robotsUrl: string,
    fetch: () => Promise<PageResult>,
  ): Promise<{ readonly answer: RobotsAnswer; readonly cached: boolean }>;
}

interface Kept {
  readonly answer: RobotsAnswer;
  readonly until: number;
}

export function createRobotsCache(options: {
  readonly now: () => number;
  readonly maxOrigins?: number;
}): RobotsCache {
  const { now } = options;
  const max = options.maxOrigins ?? ROBOTS_CACHE_ORIGINS;
  const kept = new Map<string, Kept>();
  const inflight = new Map<string, Promise<RobotsAnswer>>();

  const fresh = (robotsUrl: string): RobotsAnswer | null => {
    const entry = kept.get(robotsUrl);
    if (entry === undefined) return null;
    if (entry.until > now()) return entry.answer;
    kept.delete(robotsUrl);
    return null;
  };

  const keep = (answer: RobotsAnswer): void => {
    const ttl = robotsAnswerTtl(answer);
    if (ttl <= 0) return;
    kept.delete(answer.robotsUrl);
    kept.set(answer.robotsUrl, { answer, until: now() + ttl });
    while (kept.size > max) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  };

  const run = (robotsUrl: string, fetch: () => Promise<PageResult>): Promise<RobotsAnswer> => {
    const pending = (async () => {
      try {
        const answer = interpretRobots(robotsUrl, await fetch());
        keep(answer);
        return answer;
      } finally {
        inflight.delete(robotsUrl);
      }
    })();
    inflight.set(robotsUrl, pending);
    return pending;
  };

  return {
    async answer(robotsUrl, fetch) {
      const known = fresh(robotsUrl);
      if (known !== null) return { answer: known, cached: true };
      const shared = inflight.get(robotsUrl);
      if (shared !== undefined) {
        const answer = await shared.catch(() => null);
        // An answer another caller's attempt could not keep (its deadline, its abort, a network
        // failure) says nothing for this caller: it asks for itself.
        if (answer !== null && robotsAnswerTtl(answer) > 0) return { answer, cached: true };
        const again = fresh(robotsUrl);
        if (again !== null) return { answer: again, cached: true };
      }
      return { answer: await run(robotsUrl, fetch), cached: false };
    },
  };
}
