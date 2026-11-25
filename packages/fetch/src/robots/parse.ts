// The only module that imports robots-parser (S§3.3 "robots.txt: robots-parser"), so it can be
// swapped.
import robotsParser from 'robots-parser';

/** The rules of one robots.txt for one product token. */
export interface RobotsRules {
  /** True or false for a URL of the robots.txt's own origin; undefined for any other URL. */
  isAllowed(url: string): boolean | undefined;
}

/**
 * Parses `text` as the robots.txt of `robotsUrl` (the URL it was asked for: RFC 9309 §2.3.1.2
 * applies the rules to the initial authority, even after a redirect) for the product token
 * `token`.
 */
export function parseRobots(robotsUrl: string, text: string, token: string): RobotsRules {
  const robots = robotsParser(robotsUrl, text);
  return { isAllowed: (url) => robots.isAllowed(url, token) };
}
