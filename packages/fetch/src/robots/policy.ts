// robots.txt (S§5.1 "robots.txt"; RFC 9309): what a fetched robots.txt answers for a URL. Pure:
// the request is made by the fetcher, through the same guarded and paced path as any other.
//
// What the robots.txt request ended in, and what it means (RFC 9309 §2.3.1):
//   - 2xx with a robots.txt body: `parsed`, the rules for our product token decide.
//   - 2xx with an HTML document (a login page, a single-page app's shell, a challenge the wall
//     classifier did not name): `not_robots`, no verdict. A robots.txt never starts with "<".
//   - any status the wall classifier calls a wall (a challenge served as 403, 429 or even 200):
//     `challenged`, no verdict, whatever the status (S§5.1).
//   - 4xx, an unfollowed 3xx, or more redirects than the guard follows: `unavailable` (§2.3.1.3,
//     §2.3.1.2), every URL allowed.
//   - 429 and 5xx: `unreachable` (§2.3.1.4), every URL disallowed. 429 is a 4xx, but it says "not
//     now", not "there is no file", and RFC 9309 lets a crawler treat it as unreachable.
//   - no response at all (a network error, a timeout, a guard refusal, the body cap, pacing or the
//     budget): `failed`, no verdict. Under `respect` the fetcher ends a request whose robots.txt
//     failed with a network error with that same error, since nothing was established (see
//     fetcher.ts); RFC 9309 calls that "unreachable" and asks for a full disallow, and here the
//     request is not made either way.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';
import { TOO_MANY_REDIRECTS } from '../guard/index.ts';
import type { PageResult } from '../page/index.ts';
import { parseRobots, type RobotsRules } from './parse.ts';

/** The robots setting (S§5.1, S§9 #4): the default is `ignore`. */
export const ROBOTS_MODES = ['ignore', 'report', 'respect'] as const;
export type RobotsMode = (typeof ROBOTS_MODES)[number];
export const DEFAULT_ROBOTS_MODE: RobotsMode = 'ignore';

/**
 * The product token our rules are read for (RFC 9309 §2.2.1: letters, "-" and "_"). Only robots.txt
 * groups naming it, or `*`, apply. It is never sent: the User-Agent is the TLS profile's (S§5.1).
 */
export const ROBOTS_PRODUCT_TOKEN = 'agentic-dasher';

/** S§5.1: robots.txt is "cached for a day". RFC 9309 §2.4 asks for no more than 24 hours. */
export const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1_000;

/**
 * How long an answer that is not a robots.txt is kept: a 5xx or 429, a challenge, a refused or
 * oversized robots.txt. The spec names no number. Long enough not to ask a struggling or walled
 * host for robots.txt before every request, short enough that a passing failure costs little.
 */
export const ROBOTS_RETRY_MS = 15 * 60 * 1_000;

/**
 * RFC 9309 §2.5: a crawler must parse at least the first 500 KiB of a robots.txt. The body is read
 * under the page cap and only this much of it is parsed.
 */
export const ROBOTS_PARSE_LIMIT = 500 * 1024;

export type RobotsState =
  | 'parsed'
  | 'unavailable'
  | 'unreachable'
  | 'challenged'
  | 'not_robots'
  | 'failed';

export type RobotsVerdict = 'allowed' | 'disallowed' | 'unknown';

/** What one robots.txt request answered, for any URL of its origin. */
export interface RobotsAnswer {
  /** `<origin>/robots.txt`, as asked (the rules apply to this origin, RFC 9309 §2.3.1.2). */
  readonly robotsUrl: string;
  readonly state: RobotsState;
  /** The robots.txt request's own outcome. */
  readonly outcome: FetchOutcome;
  /** The status read, or null when no response was read. */
  readonly status: number | null;
  /** The parsed rules; only for `parsed`. */
  readonly rules: RobotsRules | null;
}

/** The robots.txt URL of a URL's origin (scheme, host and port). */
export function robotsUrlOf(url: string): string {
  return `${new URL(url).origin}/robots.txt`;
}

/** True unless the body is an HTML (or XML) document rather than robots.txt text. */
export function looksLikeRobotsTxt(text: string): boolean {
  const start = text.replace(/^﻿/, '').trimStart();
  return !start.startsWith('<');
}

/** What the response to a robots.txt request answers. */
export function interpretRobots(robotsUrl: string, result: PageResult): RobotsAnswer {
  const { outcome, response } = result;
  const answer = (state: RobotsState, rules: RobotsRules | null = null): RobotsAnswer => ({
    robotsUrl,
    state,
    outcome,
    status: response?.status ?? null,
    rules,
  });
  if (response === null) {
    if (outcome.kind === 'network_error' && outcome.code === TOO_MANY_REDIRECTS) {
      return answer('unavailable');
    }
    return answer('failed');
  }
  if (outcome.kind === 'wall') return answer('challenged');
  const { status } = response;
  if (status >= 200 && status <= 299) {
    if (!looksLikeRobotsTxt(response.text)) return answer('not_robots');
    const text = response.text.slice(0, ROBOTS_PARSE_LIMIT);
    return answer('parsed', parseRobots(robotsUrl, text, ROBOTS_PRODUCT_TOKEN));
  }
  if (status === 429 || (status >= 500 && status <= 599)) return answer('unreachable');
  return answer('unavailable');
}

/** What the answer says about `url` (a URL of the same origin). */
export function robotsVerdict(answer: RobotsAnswer, url: string): RobotsVerdict {
  switch (answer.state) {
    case 'parsed': {
      const allowed = answer.rules?.isAllowed(url);
      return allowed === undefined ? 'unknown' : allowed ? 'allowed' : 'disallowed';
    }
    case 'unavailable':
      return 'allowed';
    case 'unreachable':
      return 'disallowed';
    default:
      return 'unknown';
  }
}

/** How long the answer may be reused for its origin; 0 when it must not be. */
export function robotsAnswerTtl(answer: RobotsAnswer): number {
  switch (answer.state) {
    case 'parsed':
    case 'unavailable':
    case 'not_robots':
      return ROBOTS_CACHE_MS;
    case 'unreachable':
    case 'challenged':
      return ROBOTS_RETRY_MS;
    case 'failed': {
      // A refusal about the robots.txt itself is stable; a network failure, a deadline, the
      // pacing and the budget are about this one attempt.
      const { outcome } = answer;
      const stable =
        outcome.kind === 'refused_by_policy' &&
        outcome.reason !== 'host_limit' &&
        outcome.reason !== 'budget';
      return stable ? ROBOTS_RETRY_MS : 0;
    }
  }
}

/** The robots.txt check returned beside a result in `report` and `respect` mode. */
export interface RobotsCheck {
  readonly mode: Exclude<RobotsMode, 'ignore'>;
  readonly robotsUrl: string;
  readonly state: RobotsState;
  readonly verdict: RobotsVerdict;
  /** The robots.txt request's own outcome (this check's request, or the cached one's). */
  readonly outcome: FetchOutcome;
  /** True when the answer came from the cache and no robots.txt request was made for this check. */
  readonly cached: boolean;
}

/** The rung robots.txt is asked on: a plain page request. */
export const ROBOTS_RUNG: Extract<Rung, 'http'> = 'http';
