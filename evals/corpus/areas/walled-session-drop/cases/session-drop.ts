// Which cookies and which origin storage a render's end clears.
import type { SessionDropCase } from '../contract.ts';

const PATTERN = 'fetch.py _site_cookie_pattern lines 408-415';
const FORGET =
  'fetch.py _SharedProfile.forget lines 433-452, called from Fetcher.render lines 1134-1142';
const NOTHING = { cookieDomains: [], origins: [] } as const;
const SIBOOR = 'https://www.siboor.com/product/lamp-bar/';

export const sessionDropCases: readonly SessionDropCase[] = [
  {
    id: 'wall-clears-the-sites-own-and-parent-domain-cookies-only',
    what: "An Akamai wall on www.homedepot.ca clears that site's cookies and its parent domain's, and no other site's",
    input: {
      pageUrl: 'https://www.homedepot.ca/en/home.html',
      outcome: { kind: 'wall', rung: 'browser', vendor: 'akamai', mode: 'access_denied' },
      jar: [
        '.homedepot.ca',
        'homedepot.ca',
        'www.homedepot.ca',
        'secure.homedepot.ca',
        'nothomedepot.ca',
        '.ca',
        '.rona.ca',
      ],
    },
    expected: {
      cookieDomains: ['.homedepot.ca', 'homedepot.ca', 'www.homedepot.ca', 'secure.homedepot.ca'],
      origins: ['https://www.homedepot.ca'],
    },
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_wall_clears_only_that_sites_cookies (all seven ' +
      `domains); ${PATTERN}; ${FORGET}; reports/2026-10-16-browser-access.md line 64`,
    established: ['test', 'ran', 'spec'],
    note: 'The test checks the pattern only; the outcome and the origin follow render() and forget().',
  },
  {
    id: 'subdomain-store-clears-its-parent-domains',
    what: "For a store on ca.store.bambulab.com, the cookies of every parent domain short of the TLD are the site's",
    input: {
      pageUrl: 'https://ca.store.bambulab.com/products/p1s',
      outcome: { kind: 'wall', rung: 'browser', vendor: null, mode: 'challenge' },
      jar: [
        '.bambulab.com',
        'ca.store.bambulab.com',
        '.com',
        'us.bambulab.org',
        '.store.bambulab.com',
        'store.bambulab.com',
        'us.store.bambulab.com',
      ],
    },
    expected: {
      cookieDomains: [
        '.bambulab.com',
        'ca.store.bambulab.com',
        '.store.bambulab.com',
        'store.bambulab.com',
      ],
      origins: ['https://ca.store.bambulab.com'],
    },
    from:
      'pricewatch/tests/test_browser_mode.py::test_parent_domains_of_a_subdomain_store_are_its_own ' +
      `(.bambulab.com, ca.store.bambulab.com, .com, us.bambulab.org); ${PATTERN}`,
    established: ['test', 'ran', 'spec'],
    note:
      'The last three jar entries are not in the test; their verdicts come from running the pattern: ' +
      'a parent (.store.bambulab.com, store.bambulab.com) is cleared, a sibling store ' +
      '(us.store.bambulab.com) is not. The wall itself is a placeholder: any wall drops the session.',
  },
  {
    id: 'captcha-clears-the-site-and-its-origin-storage',
    what: "A DataDome captcha on siboor.com clears that site's cookies and the page origin's storage",
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'wall', rung: 'browser', vendor: 'datadome', mode: 'captcha' },
      jar: ['.siboor.com', 'www.siboor.com', '.othershop.example'],
    },
    expected: {
      cookieDomains: ['.siboor.com', 'www.siboor.com'],
      origins: ['https://www.siboor.com'],
    },
    from: `pricewatch/tests/test_browser_mode.py::test_a_captcha_is_reported_at_once_and_only_that_sites_cookies_go; ${FORGET}`,
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'challenge-that-never-cleared-drops-the-session',
    what: 'A Cloudflare challenge still showing after the wait drops the site session too',
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'wall', rung: 'browser', vendor: 'cloudflare', mode: 'challenge' },
      jar: ['.siboor.com', '.othershop.example'],
    },
    expected: { cookieDomains: ['.siboor.com'], origins: ['https://www.siboor.com'] },
    from: 'pricewatch/tests/test_browser_mode.py::test_a_challenge_that_never_clears_is_a_wall_after_the_wait',
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'challenge-that-cleared-keeps-its-clearance',
    what: 'A challenge that cleared by itself leaves the session alone, so the fresh clearance cookie stays',
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'ok', rung: 'browser' },
      jar: ['.siboor.com', 'www.siboor.com'],
    },
    expected: NOTHING,
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_cloudflare_challenge_that_clears_is_read_not_called_a_wall ' +
      '(cleared == []) and ::test_a_served_page_is_not_kept_waiting; fetch.py _settled docstring lines 1162-1167',
    established: ['test', 'spec'],
  },
  {
    id: 'dead-link-keeps-the-session',
    what: 'A 404 is the store answering and keeps the session',
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'not_found', rung: 'browser' },
      jar: ['.siboor.com'],
    },
    expected: NOTHING,
    from: 'fetch.py Fetcher.render line 1134 (only a looks_blocked page drops it; a 404 is not)',
    established: ['read', 'ran', 'spec'],
  },
  {
    id: 'public-suffix-is-not-a-parent-domain',
    what: "For a store on www.example.co.uk, .co.uk is not the site's and is not cleared",
    input: {
      pageUrl: 'https://www.example.co.uk/p/1',
      outcome: { kind: 'wall', rung: 'browser', vendor: 'akamai', mode: 'access_denied' },
      jar: ['.co.uk', '.example.co.uk', 'example.co.uk', 'www.example.co.uk', '.other.co.uk'],
    },
    expected: {
      cookieDomains: ['.example.co.uk', 'example.co.uk', 'www.example.co.uk'],
      origins: ['https://www.example.co.uk'],
    },
    from: PATTERN,
    established: ['ran', 'spec'],
    divergence:
      "The predecessor's pattern takes every parent but the last label, so for example.co.uk it " +
      'matches ".co.uk" (ran) and would clear every .co.uk cookie the browser held. Browsers refuse ' +
      "cookies on a public suffix, so the harm is small, but S§5.1 clears only that site's cookies.",
  },
  {
    id: 'server-error-render-keeps-the-session',
    what: "A store's 503 page is no wall and keeps the session",
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'server_error', rung: 'browser' },
      jar: ['.siboor.com'],
    },
    expected: NOTHING,
    from: 'fetch.py Fetcher.render lines 1134-1142 and Page.looks_blocked line 309',
    established: ['read', 'ran', 'spec'],
    divergence:
      'The predecessor dropped the session after any page that looks_blocked, which includes every ' +
      '5xx (ran on the 503 maintenance page of test_browser_mode.py). S§5.1 ties the drop to a ' +
      'walled render; a server error is not one (wall-classification maps it to server_error). ' +
      'Open question for the owner.',
  },
  {
    id: 'rate-limited-render-keeps-the-session',
    what: 'A 429 is a rate limit, not a wall, and keeps the session',
    input: {
      pageUrl: SIBOOR,
      outcome: { kind: 'rate_limited', rung: 'browser', retryAfterMs: null },
      jar: ['.siboor.com'],
    },
    expected: NOTHING,
    from: 'fetch.py Fetcher.render lines 1134-1142 and Page.looks_blocked line 309',
    established: ['read', 'ran', 'spec'],
    divergence:
      'The predecessor dropped the session after a 429 too (looks_blocked is True for 429). S§5.1 ' +
      'ties the drop to a walled render. Open question for the owner.',
  },
];
