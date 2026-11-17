// robots.txt in `report` mode (S§5.1): fetched and parsed with robots-parser, never obeyed; each
// route records what `respect` would have done. Fetch results map per RFC 9309 §2.3.1:
// 2xx parsed; 4xx "unavailable" (allow all); 5xx or network error "unreachable" (disallow all).
// A robots.txt we could not read for policy reasons (off-site redirect, cap) is `unknown`.
import robotsParser from 'robots-parser';
import { classify, detectWall } from './classify.ts';
import { type Budget, get, type HttpConfig } from './http.ts';
import type { DomainResult, Outcome, RobotsVerdict } from './outcome.ts';

export const ROBOTS_TOKEN = 'agentic-dasher-lab';

export interface Robots {
  record: DomainResult['robots'];
  /** Origin the robots.txt fetch settled on (after same-site redirects), used for the routes. */
  origin: string;
  requests: number;
  /** Set when robots.txt was not fetched (guard refusal, network error, cap). */
  failure?: Outcome;
  verdict(url: string): RobotsVerdict;
}

export async function fetchRobots(
  origin: string,
  cfg: HttpConfig,
  budget: Budget,
): Promise<Robots> {
  const r = await get(`${origin}/robots.txt`, cfg, budget, { accept: 'text/plain' });
  if (!r.ok) {
    const kind = r.outcome.kind;
    const unreachable = kind === 'network_error';
    return {
      record: { state: unreachable ? 'unreachable' : 'unknown', outcome: kind },
      origin,
      requests: r.requests,
      failure: r.outcome,
      verdict: () => (unreachable ? 'disallowed' : 'unknown'),
    };
  }
  const { status, finalUrl, body } = r.res;
  const settled = new URL(finalUrl).origin;
  const walled = detectWall(r.res) !== undefined;
  const outcome =
    status < 300 && !walled
      ? 'ok'
      : classify(r.res, { valid: false, reason: 'robots' }, 'any').outcome.kind;
  if (status < 300 && walled) {
    // A challenge page served as robots.txt is not a robots.txt.
    return {
      record: { state: 'unknown', status, outcome },
      origin: settled,
      requests: r.requests,
      verdict: () => 'unknown',
    };
  }
  if (status >= 500) {
    return {
      record: { state: 'unreachable', status, outcome },
      origin: settled,
      requests: r.requests,
      verdict: () => 'disallowed',
    };
  }
  if (status >= 400) {
    return {
      record: { state: 'absent', status, outcome },
      origin: settled,
      requests: r.requests,
      verdict: () => 'allowed',
    };
  }
  const robots = robotsParser(finalUrl, body);
  return {
    record: { state: 'parsed', status, outcome },
    origin: settled,
    requests: r.requests,
    verdict: (url) => {
      const allowed = robots.isAllowed(url, ROBOTS_TOKEN);
      return allowed === undefined ? 'unknown' : allowed ? 'allowed' : 'disallowed';
    },
  };
}
