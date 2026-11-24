// Pages that are walls: by final URL, by title, by visible text on a small page, by markup on a
// small page, and the walls the browser rung reports after its challenge wait.
import type { WallCase } from '../contract.ts';

const LAB = 'lab classifier (scripts/browser-lab/harness/lab/classify.py classify(), run offline)';
const IN_HOUSE = '"in-house walls name their vendor"';

export const wallCases: readonly WallCase[] = [
  {
    id: 'ebay-wall-shows-only-in-the-final-url',
    what: "eBay's challenge redirect answers 200 with a clean body; only the final URL shows the wall",
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://www.ebay.com/splashui/challenge?ap=1&ru=https%3A%2F%2Fwww.ebay.com%2F',
      headers: {},
      title: '',
      visibleText: 'welcome',
      visibleChars: 7,
      markup: [],
      documentBytes: 20,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'ebay', mode: 'challenge' },
    from:
      'pricewatch/tests/test_fetch.py::test_blocked_by_challenge_redirect_url; fetch.py lines 318-322; ' +
      `docs/progress.md 2026-11-23 "Settled by the orchestrator": ${IN_HOUSE}`,
    established: ['test', 'ran', 'spec', 'ruling'],
    note:
      `S§5.1 names this case. Vendor ebay: eBay's own wall, which the ${LAB} reports as ` +
      'wall:other "eBay splashui challenge". Until the orchestrator settled on 2026-11-23 that ' +
      'in-house walls name their vendor (the owner may overrule), this case expected vendor null. The ' +
      'path says challenge, so the mode is challenge.',
    divergence:
      'The predecessor named no vendor for its own boolean "blocked", and its lab classifier filed this ' +
      'wall under "other". In-house walls now name their vendor (settled 2026-11-23).',
  },
  {
    id: 'walmart-blocked-redirect-is-a-perimeterx-wall',
    what: 'Walmart Canada redirects to /blocked with a "Verify Your Identity" page served with 200',
    input: {
      rung: 'browser',
      status: 200,
      finalUrl: 'https://www.walmart.ca/blocked?url=abc',
      headers: {},
      title: 'Verify Your Identity',
      visibleText: '',
      visibleChars: 0,
      markup: [],
      documentBytes: 35,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'perimeterx', mode: 'challenge' },
    from:
      'pricewatch/tests/test_retail_reliability.py::test_walmart_identity_interstitial_is_classified_as_blocked; ' +
      'fetch.py line 321 ("/blocked" path) and line 329 (title); ' +
      'reports/2026-10-16-browser-access.md line 348 ("Walmart CA | PerimeterX \'press and hold\'"); ' +
      'reports/2026-09-19-retailer-reliability.md line 10',
    established: ['test', 'ran'],
    note:
      `Vendor perimeterx from the ${LAB}: "/blocked?url=" in the final URL (line 144). Mode challenge ` +
      'by the default rule: the test body shows no puzzle. The live page carries a press-and-hold ' +
      'element, which would make it a captcha (see perimeterx-press-and-hold-is-a-captcha). ' +
      'The url= value "abc" is the test\'s placeholder.',
  },
  {
    id: 'blocked-path-is-a-wall',
    what: 'A final URL whose path is exactly /blocked is a wall even with an empty 200 page',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/blocked',
      headers: {},
      title: '',
      visibleText: '',
      visibleChars: 0,
      markup: [],
      documentBytes: 26,
    },
    expected: { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' },
    from: 'fetch.py Page.looks_blocked line 321 (urlsplit(final).path.rstrip("/") == "/blocked")',
    established: ['read', 'ran'],
    note: `No predecessor test of its own. The ${LAB} answers error:empty: it only knows "/blocked?url=".`,
  },
  {
    id: 'cloudflare-just-a-moment-title-is-a-challenge',
    what: 'A small page titled "Just a moment..." is a Cloudflare challenge',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/',
      headers: {},
      title: 'Just a moment...',
      visibleText: '',
      visibleChars: 0,
      markup: [],
      documentBytes: 44,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'cloudflare', mode: 'challenge' },
    from:
      'pricewatch/tests/test_fetch.py::test_blocked_by_body_marker; ' +
      'test_canada.py::test_verify_reports_a_walled_homepage_as_blocked (same title, body "checking your browser"); ' +
      'fetch.py line 328',
    established: ['test', 'ran'],
    note: `Vendor from the ${LAB}: title "Just a moment..." (line 113). The test used host x.com.`,
  },
  {
    id: 'powered-and-protected-by-on-a-small-page-is-a-wall',
    what: 'A small page reading "Powered and protected by" is a wall',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://mouser.com/',
      headers: {},
      title: '',
      visibleText: 'Powered and protected by',
      visibleChars: 24,
      markup: [],
      documentBytes: 31,
    },
    expected: { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' },
    from:
      'pricewatch/tests/test_retail_reliability.py::test_loading_placeholder_and_javascript_are_not_challenges ' +
      '(second assertion); fetch.py lines 331-333',
    established: ['test', 'ran'],
    note:
      'Vendor null: the text names none. reports/2026-10-16-browser-access.md line 347 lists Mouser ' +
      'CA as a DataDome captcha, but this evidence does not show it, so neither the vendor nor the ' +
      `captcha mode is taken from there. The ${LAB} answers error:empty for this body.`,
  },
  {
    id: 'amazon-text-captcha-on-a-200-is-a-captcha',
    what: 'An Amazon page served with 200 that asks for the characters in an image is a captcha',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://www.amazon.ca/dp/B0BKVY4WKT',
      headers: {},
      title: '',
      visibleText: 'Enter the characters you see below',
      visibleChars: 34,
      markup: [],
      documentBytes: 47,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'amazon', mode: 'captcha' },
    from:
      'pricewatch/tests/test_fetch.py::test_body_markers_still_apply_on_a_200; ' +
      'test_amazon.py::test_search_gives_up_quietly_when_amazon_walls_the_page (same body); ' +
      `docs/progress.md 2026-11-23 "Settled by the orchestrator": ${IN_HOUSE}`,
    established: ['test', 'ran', 'ruling'],
    note:
      `Mode captcha by rule 1: the page asks a person to type characters. Vendor amazon: the ${LAB} ` +
      'answers wall:other "Amazon captcha"; the final URL is on amazon.ca and the wall is Amazon\'s ' +
      'own. Until the orchestrator settled on 2026-11-23 that in-house walls name their vendor (the ' +
      'owner may overrule), this case expected vendor null. The predecessor would have waited on it ' +
      '(see challenge-wait amazon-text-captcha-is-reported-at-once).',
    divergence:
      'The predecessor named no vendor for its own boolean "blocked", and its lab classifier filed this ' +
      'wall under "other". In-house walls now name their vendor (settled 2026-11-23).',
  },
  {
    id: 'akamai-access-denied-is-access-denied',
    what: 'A small 403 page titled and reading "Access Denied" is an Akamai access-denied wall',
    input: {
      rung: 'browser',
      status: 403,
      finalUrl: 'https://www.canadiantire.ca/en/search-results.html',
      headers: {},
      title: 'Access Denied',
      visibleText: 'Access Denied',
      visibleChars: 13,
      markup: [],
      documentBytes: 80,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'akamai', mode: 'access_denied' },
    from:
      'pricewatch/tests/test_recipes.py::test_a_wall_on_the_replay_is_reported_as_a_wall ' +
      '("Akamai let the first visit in"); fetch.py _needs_a_person line 358; ' +
      'reports/2026-10-16-browser-access.md lines 274-275 and 345',
    established: ['test', 'read', 'ran'],
    note:
      `Vendor akamai from the ${LAB}: title "Access Denied" on a small page (line 124); the report ` +
      'names Akamai "Access Denied" for Canadian Tire, Home Depot and Best Buy Canada. The test ' +
      'page had URL "x"; the search URL is the one the test replayed, query removed.',
  },
  {
    id: 'access-denied-page-served-with-200-is-access-denied',
    what: 'The same "Access Denied" page is a wall when the status is 200',
    input: {
      rung: 'browser',
      status: 200,
      finalUrl: 'https://shop.example/p/2',
      headers: {},
      title: 'Access Denied',
      visibleText: 'Access Denied',
      visibleChars: 13,
      markup: [],
      documentBytes: 80,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'akamai', mode: 'access_denied' },
    from:
      'pricewatch/tests/test_retail_reliability.py::test_a_walled_render_starts_the_next_visit_from_a_fresh_session ' +
      '(the fake tab answers 200; page.looks_blocked is asserted)',
    established: ['test', 'ran'],
    note: `Vendor from the ${LAB} and the test's docstring ("Akamai marks the session cookie itself").`,
  },
  {
    id: 'datadome-captcha-iframe-is-a-captcha',
    what: "A small 403 page holding DataDome's captcha iframe is a captcha",
    input: {
      rung: 'browser',
      status: 403,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: 'shop.example',
      visibleText: '',
      visibleChars: 0,
      markup: [{ in: 'iframe_src', value: 'https://geo.captcha-delivery.com/captcha/' }],
      documentBytes: 144,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'datadome', mode: 'captcha' },
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_captcha_is_reported_at_once_and_only_that_sites_cookies_go ' +
      '(DATADOME page); fetch.py _needs_a_person line 358',
    established: ['test', 'read', 'ran'],
    reducedFrom: 'The test body (144 bytes). The iframe query (initialCid) is dropped.',
    note: `Vendor from the ${LAB}: "captcha-delivery iframe" (line 134).`,
  },
  {
    id: 'datadome-captcha-iframe-served-with-200-is-a-captcha',
    what: 'The DataDome captcha page is a wall on markup alone when the status is 200',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: 'shop.example',
      visibleText: '',
      visibleChars: 0,
      markup: [{ in: 'iframe_src', value: 'https://geo.captcha-delivery.com/captcha/' }],
      documentBytes: 144,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'datadome', mode: 'captcha' },
    from: 'fetch.py Page.looks_blocked lines 331-333 (small document, "captcha-delivery.com" in the markup)',
    established: ['read', 'ran'],
  },
  {
    id: 'incapsula-resource-on-a-small-page-is-a-wall',
    what: "A small page that loads Incapsula's challenge resource is an Imperva wall",
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/p/1',
      headers: {},
      title: '',
      visibleText: '',
      visibleChars: 0,
      markup: [{ in: 'iframe_src', value: '/_incapsula_resource' }],
      documentBytes: 180,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'imperva', mode: 'challenge' },
    from:
      'fetch.py CHALLENGE_MARKERS ("/_incapsula_", line 59) and Page.looks_blocked lines 335-336 ' +
      '(markers in the markup count on a document under 12,000 characters)',
    established: ['read', 'ran'],
    note:
      `No predecessor test; the body was built for this case. Vendor imperva from the ${LAB} ` +
      '("_incapsula_resource" on a small page, line 150).',
  },
  {
    id: 'perimeterx-press-and-hold-is-a-captcha',
    what: "PerimeterX's press-and-hold page is a captcha even though its title says access is denied",
    input: {
      rung: 'browser',
      status: 403,
      finalUrl: 'https://www.walmart.ca/blocked?url=abc',
      headers: {},
      title: 'Access to this page has been denied',
      visibleText: 'Press & Hold to confirm you are a human (and not a bot).',
      visibleChars: 56,
      markup: [{ in: 'element_id', value: 'px-captcha' }],
      documentBytes: 183,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'perimeterx', mode: 'captcha' },
    from:
      'fetch.py _needs_a_person lines 352-359 (docstring: "PerimeterX\'s press-and-hold"; "px-captcha" ' +
      'in the markup); reports/2026-10-16-browser-access.md line 348',
    established: ['read', 'ran'],
    note:
      `No predecessor test; the body was built for this case. Vendor from the ${LAB} (title, line ` +
      '140). Mode captcha by rule 1, which wins over the access-denied title: a decision for the owner ' +
      'to confirm.',
  },
  {
    id: 'perimeterx-access-denied-title-alone-is-access-denied',
    what: 'A page titled "Access to this page has been denied" with no puzzle is an access-denied wall',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/p/1',
      headers: {},
      title: 'Access to this page has been denied',
      visibleText: '',
      visibleChars: 0,
      markup: [],
      documentBytes: 89,
    },
    expected: { kind: 'wall', rung: 'http', vendor: 'perimeterx', mode: 'access_denied' },
    from: 'fetch.py Page.looks_blocked line 328 (title)',
    established: ['read', 'ran'],
    note: `No predecessor test. Vendor from the ${LAB} (title, line 140). Mode by rule 2.`,
  },
  {
    id: 'cloudflare-challenge-that-never-cleared-is-a-challenge',
    what: 'On the browser rung, a Cloudflare challenge still showing after the wait is a challenge wall',
    input: {
      rung: 'browser',
      status: 403,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: 'Just a moment...',
      visibleText: '',
      visibleChars: 0,
      markup: [{ in: 'element_id', value: 'challenge-running' }],
      documentBytes: 104,
    },
    expected: { kind: 'wall', rung: 'browser', vendor: 'cloudflare', mode: 'challenge' },
    from: 'pricewatch/tests/test_browser_mode.py::test_a_challenge_that_never_clears_is_a_wall_after_the_wait',
    established: ['test', 'ran'],
    note: `S§5.1: "challenge (did not clear)". Vendor from the ${LAB} (title, line 113).`,
  },
];
