// The browser rung's challenge wait (S§5.1 ladder step 3: "Wait up to 20 s for a self-clearing
// challenge; never click; report a captcha or 'Access Denied' at once"). Types only.
//
// The wait itself is a loop over time (one read a second, 20 s at most, S§5.1). Two decisions in it
// are pure rules the predecessor tested, and they are the subjects here:
//   1. `worthWaiting`: after a read of the tab, keep waiting or judge the page now.
//   2. `statusAfterWait`: which HTTP status the judged page carries, when the challenge was swapped
//      for the store's page in place, without a new document and so without a new status.
// The page itself is then judged by the wall classifier (area wall-classification).
import type { PageEvidence } from '../wall-classification/contract.ts';

export type { PageEvidence };

/** A read of the tab without its status: the document's status comes from the navigation. */
export type PageContent = Omit<PageEvidence, 'rung' | 'status'>;

/**
 * Subject 1. True: the page may still clear by itself (a self-clearing challenge, or a document
 * still filling in), so the wait goes on. False: judge it now (the store's page, a dead link, a
 * server error, a captcha, an "Access Denied"). The page is on the browser rung.
 */
export type WorthWaiting = (page: PageEvidence) => boolean;

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

/** Subject 2: the status the page judged at the end of the wait carries. */
export type StatusAfterWait = (input: StatusAfterWaitInput) => number;

export type Established = 'test' | 'read' | 'ran' | 'spec';

interface CaseBase {
  readonly id: string;
  readonly what: string;
  readonly from: string;
  readonly established: readonly Established[];
  readonly divergence?: string;
  readonly specSilent?: true;
  readonly note?: string;
}

export interface WorthWaitingCase extends CaseBase {
  readonly input: { readonly decide: 'worth_waiting'; readonly page: PageEvidence };
  readonly expected: boolean;
}

export interface StatusAfterWaitCase extends CaseBase {
  readonly input: { readonly decide: 'status_after_wait' } & StatusAfterWaitInput;
  readonly expected: number;
}

export type ChallengeWaitCase = WorthWaitingCase | StatusAfterWaitCase;
