// The browser rung's challenge wait (S§5.1 ladder step 3: "Wait up to 20 s for a self-clearing
// challenge; never click; report a captcha or 'Access Denied' at once"). The browser rung arrives
// in Phase 6; these are the two decisions its wait loop calls, as pure functions:
//
//   read the tab once a second, up to CHALLENGE_WAIT_MS:
//     while worthWaiting(page): wait CHALLENGE_POLL_MS, read again
//   the judged page carries statusAfterWait(...), and classifyPage judges it.
//
// Nothing here clicks, types or runs anything on the page.

import { findWall } from './classify-page.ts';
import type { PageEvidence } from './evidence.ts';

/** How long a challenge gets to clear by itself (S§5.1). */
export const CHALLENGE_WAIT_MS = 20_000;
/** How often the tab is read during the wait (the predecessor's pace). */
export const CHALLENGE_POLL_MS = 1_000;
/**
 * A 2xx document with less visible text than this may still be filling in (a client-rendered
 * page), so it is given the wait too. The predecessor's number (fetch.py `_may_still_clear`).
 */
export const FILL_IN_MIN_VISIBLE_CHARS = 200;

/** Statuses a bot wall answers with while its challenge may still clear. */
const CHALLENGE_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

/** A read of the tab without its status: the document's status comes from the navigation. */
export type PageContent = Omit<PageEvidence, 'rung' | 'status'>;

export interface StatusAfterWaitInput {
  /** The status of the navigation's response. */
  readonly firstStatus: number;
  /** The document as first read, right after the navigation settled. */
  readonly first: PageContent;
  /** The status of the latest main-frame document loaded since the first read; null if none. */
  readonly newDocumentStatus: number | null;
  /** The document as read now, when the wait stops. */
  readonly current: PageContent;
}

function isStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 599;
}

/**
 * After a read of the tab: true to keep waiting (a self-clearing challenge, or a document still
 * filling in), false to judge the page now (the store's page, a dead link, a server error, a
 * captcha, an "Access Denied", a login). Never throws; when in doubt it judges now.
 */
export function worthWaiting(page: PageEvidence): boolean {
  try {
    const { status } = page;
    if (status === 404 || status === 410) return false;
    if (status >= 500 && status !== 503) return false;
    const wall = findWall(page);
    // A captcha or a refusal does not clear by itself: report it at once (S§5.1).
    if (wall !== null) return wall.mode === 'challenge';
    if (CHALLENGE_STATUSES.has(status)) return true;
    if (status >= 200 && status <= 299) return page.visibleChars < FILL_IN_MIN_VISIBLE_CHARS;
    // A 401 with no wall on it asks for a login, which waiting does not give.
    return false;
  } catch {
    return false;
  }
}

/** The page as it would be judged if it carried a 200. */
function at200(content: PageContent): PageEvidence {
  return { ...content, rung: 'browser', status: 200 };
}

/**
 * The status the page judged at the end of the wait carries. A new document brings its own. A
 * challenge or a blank document swapped in place for a page that no longer may clear (and is no
 * wall) is the store's page: 200. A real error page with content of its own whose DOM changed (a
 * clock, a carousel) keeps its status, and so does a challenge still showing.
 */
export function statusAfterWait(input: StatusAfterWaitInput): number {
  const { firstStatus, first, newDocumentStatus, current } = input;
  if (newDocumentStatus !== null && isStatus(newDocumentStatus)) return newDocumentStatus;
  if (!CHALLENGE_STATUSES.has(firstStatus)) return firstStatus;
  const firstWasChallenge =
    findWall(at200(first)) !== null || first.visibleChars < FILL_IN_MIN_VISIBLE_CHARS;
  if (!firstWasChallenge) return firstStatus;
  const now = at200(current);
  if (worthWaiting(now) || findWall(now) !== null) return firstStatus;
  return 200;
}
