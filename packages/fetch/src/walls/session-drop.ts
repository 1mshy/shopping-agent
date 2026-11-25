// What a walled render clears (S§5.1 "Sessions": "A walled render clears only that site's cookies
// (including parent-domain bot-manager cookies) and origin storage"). Bot managers keep their
// verdict in the session (Akamai's _abck, DataDome's datadome, PerimeterX's _px*), so a session
// kept after a wall makes the wall stick. Every other site's session stays, a challenge that
// cleared keeps its clearance cookie, and nothing is cleared for an outcome that is not a wall
// (a 5xx, a 429, a 404 are the store answering, not a verdict on the session).
//
// The site of a page is its host without a leading `www.`. Its cookies are those set for the
// site, any host under it, or any of its parent domains short of a public suffix (see `site.ts`).
import type { FetchOutcome } from '@agentic-dasher/shared';
import { bareDomain, hostOf, isIpHost, isPublicSuffix } from './site.ts';

export interface SessionDropInput {
  /** The URL the render was asked for; its host names the site. */
  readonly pageUrl: string;
  /** How the render ended, as the wall classifier judged it. */
  readonly outcome: FetchOutcome;
  /** The cookie domains in the profile when the render ended, as the browser lists them. */
  readonly jar: readonly string[];
}

export interface SessionDrop {
  /** The jar entries whose cookies are cleared, in jar order; empty when nothing is cleared. */
  readonly cookieDomains: readonly string[];
  /** Origins whose storage is cleared (local storage, IndexedDB, cache storage, service workers). */
  readonly origins: readonly string[];
}

/** True when an outcome drops the site's session: only a wall does. */
export function dropsSession(outcome: FetchOutcome): boolean {
  return outcome.kind === 'wall';
}

/**
 * The site a page belongs to: its host, lower-cased, without a leading `www.`; null for a URL
 * that is not http(s). On the HTTP rungs, `CookieJars.forget(sessionSite(url))` is the same drop.
 */
export function sessionSite(pageUrl: string): string | null {
  const host = hostOf(pageUrl);
  if (host === null) return null;
  return host.startsWith('www.') && host.length > 4 ? host.slice(4) : host;
}

/** True when cookies set for `domain` belong to `site` (as `sessionSite` gives it). */
export function cookieDomainOfSite(domain: string, site: string): boolean {
  const bare = bareDomain(domain);
  if (bare === '') return false;
  if (bare === site) return true;
  if (isIpHost(site) || isIpHost(bare)) return false;
  if (bare.endsWith(`.${site}`)) return true;
  return site.endsWith(`.${bare}`) && !isPublicSuffix(bare);
}

/** What to clear after a render; clearing it is the browser client's job. Never throws. */
export function planSessionDrop(input: SessionDropInput): SessionDrop {
  const nothing: SessionDrop = { cookieDomains: [], origins: [] };
  try {
    if (!dropsSession(input.outcome)) return nothing;
    const site = sessionSite(input.pageUrl);
    if (site === null) return nothing;
    return {
      cookieDomains: input.jar.filter((domain) => cookieDomainOfSite(domain, site)),
      origins: [new URL(input.pageUrl).origin],
    };
  } catch {
    return nothing;
  }
}
