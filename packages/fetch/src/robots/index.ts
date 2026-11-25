// robots.txt (S§5.1): the setting, what a robots.txt answers, and the per-origin cache.
export { createRobotsCache, ROBOTS_CACHE_ORIGINS, type RobotsCache } from './cache.ts';
export type { RobotsRules } from './parse.ts';
export {
  DEFAULT_ROBOTS_MODE,
  interpretRobots,
  looksLikeRobotsTxt,
  ROBOTS_CACHE_MS,
  ROBOTS_MODES,
  ROBOTS_PARSE_LIMIT,
  ROBOTS_PRODUCT_TOKEN,
  ROBOTS_RETRY_MS,
  ROBOTS_RUNG,
  type RobotsAnswer,
  type RobotsCheck,
  type RobotsMode,
  type RobotsState,
  type RobotsVerdict,
  robotsAnswerTtl,
  robotsUrlOf,
  robotsVerdict,
} from './policy.ts';
