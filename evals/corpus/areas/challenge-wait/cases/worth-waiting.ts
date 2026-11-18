// Keep waiting, or judge now: one read of the tab at a time.
import type { PageContent, WorthWaitingCase } from '../contract.ts';
import * as p from './pages.ts';

const MAY_STILL_CLEAR = 'fetch.py _may_still_clear lines 362-369';
const NEEDS_A_PERSON = 'fetch.py _needs_a_person lines 352-359';

function read(status: number, content: PageContent) {
  return { decide: 'worth_waiting', page: { rung: 'browser', status, ...content } } as const;
}

export const worthWaitingCases: readonly WorthWaitingCase[] = [
  {
    id: 'cloudflare-challenge-is-waited-on',
    what: 'A 403 "Just a moment..." challenge may clear by itself: keep waiting',
    input: read(403, p.cloudflare),
    expected: true,
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_cloudflare_challenge_that_clears_is_read_not_called_a_wall ' +
      'and ::test_a_challenge_that_never_clears_is_a_wall_after_the_wait (polls > 1); ' +
      'reports/2026-10-16-browser-access.md line 153',
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'datadome-captcha-is-reported-at-once',
    what: 'A captcha iframe will not clear by itself: judge now',
    input: read(403, p.datadomeCaptcha),
    expected: false,
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_captcha_is_reported_at_once_and_only_that_sites_cookies_go ' +
      `(polls == 1); ${NEEDS_A_PERSON}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'access-denied-is-reported-at-once',
    what: 'An "Access Denied" page will not clear: judge now',
    input: read(403, p.accessDenied),
    expected: false,
    from: `${NEEDS_A_PERSON} ("access denied" in the title); reports/2026-10-16-browser-access.md line 392`,
    established: ['read', 'ran', 'spec'],
  },
  {
    id: 'press-and-hold-is-reported-at-once',
    what: "PerimeterX's press-and-hold needs a person: judge now",
    input: read(403, p.pressAndHold),
    expected: false,
    from: `${NEEDS_A_PERSON} ("px-captcha" in the markup)`,
    established: ['read', 'ran', 'spec'],
  },
  {
    id: 'datadome-captcha-config-is-reported-at-once',
    what: "DataDome's inline configuration naming a captcha response: judge now",
    input: read(403, p.datadomeCaptchaConfig),
    expected: false,
    from: `${NEEDS_A_PERSON} ("'rt':'c'" in the markup)`,
    established: ['read', 'ran', 'spec'],
    note: 'The predecessor read this config only to decide the wait; it never named the vendor from it.',
  },
  {
    id: 'served-store-page-is-not-kept-waiting',
    what: "The store's own page, served with 200: judge now",
    input: read(200, p.store),
    expected: false,
    from: 'pricewatch/tests/test_browser_mode.py::test_a_served_page_is_not_kept_waiting (polls == 1)',
    established: ['test', 'ran'],
  },
  {
    id: 'blank-document-gets-time-to-fill-in',
    what: 'A 200 document with no visible text may still fill in: keep waiting',
    input: read(200, p.blank),
    expected: true,
    from: `pricewatch/tests/test_browser_mode.py::test_a_blank_document_gets_time_to_fill_in; ${MAY_STILL_CLEAR}`,
    established: ['test', 'ran'],
    specSilent: true,
    note: 'S§5.1 speaks of challenges only. The predecessor also waits on a page under 200 visible characters.',
  },
  {
    id: 'loading-document-gets-time-to-fill-in',
    what: 'A 200 document reading only "Loading" may still fill in: keep waiting',
    input: read(200, p.loading),
    expected: true,
    from: `pricewatch/tests/test_browser_mode.py::test_a_blank_document_gets_time_to_fill_in (second read); ${MAY_STILL_CLEAR}`,
    established: ['test', 'ran'],
    specSilent: true,
  },
  {
    id: 'dead-link-is-not-waited-on',
    what: 'A 404 is the store answering: judge now',
    input: read(404, p.notFound),
    expected: false,
    from: `pricewatch/tests/test_browser_mode.py::test_a_dead_link_is_not_waited_on (polls == 1); ${MAY_STILL_CLEAR}`,
    established: ['test', 'ran'],
  },
  {
    id: 'gone-410-is-not-waited-on',
    what: 'A 410 is the store answering: judge now',
    input: read(410, p.notFound),
    expected: false,
    from: `${MAY_STILL_CLEAR} (line 365)`,
    established: ['read', 'ran'],
  },
  {
    id: 'server-error-500-is-not-waited-on',
    what: 'A 500 will not clear by waiting: judge now',
    input: read(500, p.plain403),
    expected: false,
    from: `${MAY_STILL_CLEAR} (line 365: a 5xx other than 503)`,
    established: ['read', 'ran'],
  },
  {
    id: 'status-503-page-is-waited-on',
    what: 'A 503 may be a challenge answering while it works: keep waiting',
    input: read(503, p.maintenance(0)),
    expected: true,
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_real_error_page_whose_dom_changes_is_not_relabelled_a_200 ' +
      `(waited until the deadline); ${MAY_STILL_CLEAR}; fetch.py _CHALLENGE_STATUSES line 77`,
    established: ['test', 'ran'],
    specSilent: true,
    note: "Even the store's own maintenance page is waited on: the status alone cannot tell them apart.",
  },
  {
    id: 'status-429-is-waited-on',
    what: 'A 429 may be a challenge answering while it works: keep waiting',
    input: read(429, p.plain403),
    expected: true,
    from: `${MAY_STILL_CLEAR}; fetch.py _CHALLENGE_STATUSES line 77 ("Statuses a bot wall answers with while its challenge may still clear")`,
    established: ['read', 'ran'],
    specSilent: true,
  },
  {
    id: 'plain-403-is-waited-on',
    what: 'A 403 with no captcha and no "Access Denied" may clear: keep waiting',
    input: read(403, p.plain403),
    expected: true,
    from: MAY_STILL_CLEAR,
    established: ['read', 'ran', 'spec'],
  },
  {
    id: 'walmart-verify-your-identity-is-waited-on',
    what: 'A "Verify Your Identity" redirect with no puzzle in the page: keep waiting',
    input: read(200, p.verifyYourIdentity),
    expected: true,
    from: `${MAY_STILL_CLEAR}; ${NEEDS_A_PERSON}`,
    established: ['read', 'ran', 'spec'],
    note: 'Consistent with its mode `challenge` in wall-classification.',
  },
  {
    id: 'amazon-text-captcha-is-reported-at-once',
    what: "Amazon's type-the-characters captcha will not clear by itself: judge now",
    input: read(200, p.amazonTextCaptcha),
    expected: false,
    from: `${MAY_STILL_CLEAR}; ${NEEDS_A_PERSON}`,
    established: ['ran', 'spec'],
    divergence:
      'The predecessor waits on this page for the whole 20 s (ran: _may_still_clear True), because ' +
      '_needs_a_person knows only DataDome, PerimeterX and "access denied" titles. S§5.1: report a ' +
      'captcha at once.',
  },
  {
    id: 'access-denied-title-of-perimeterx-is-reported-at-once',
    what: 'A page titled "Access to this page has been denied" will not clear: judge now',
    input: read(200, p.accessDeniedTitleOnly),
    expected: false,
    from: `${MAY_STILL_CLEAR}; ${NEEDS_A_PERSON}`,
    established: ['ran', 'spec'],
    divergence:
      'The predecessor waits on it (ran): its _needs_a_person looks for "access denied" in the ' +
      'title, which "access to this page has been denied" does not contain. S§5.1: report "Access ' +
      'Denied" at once; the mode is access_denied (wall-classification).',
  },
];
