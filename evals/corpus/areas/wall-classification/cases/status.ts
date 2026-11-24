// Status-driven cases: what a status says before any text is read, and the dead-product statuses
// whose bodies carry challenge copy.
import type { WallCase } from '../contract.ts';

const NOTHING = { headers: {}, markup: [] } as const;
const SETTLED =
  'docs/progress.md 2026-11-23 "Settled by the orchestrator" (the owner may overrule):';

export const statusCases: readonly WallCase[] = [
  {
    id: 'bare-403-is-a-wall-of-unknown-vendor',
    what: 'A 403 with no wall text, title or markup is a wall whose vendor nothing names',
    input: {
      rung: 'http',
      status: 403,
      finalUrl: 'https://shop.example/',
      ...NOTHING,
      title: '',
      visibleText: 'x'.repeat(5000),
      visibleChars: 5000,
      documentBytes: 5000,
    },
    expected: { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' },
    from:
      'pricewatch/tests/test_fetch.py::test_blocked_by_status (403); fetch.py Page.looks_blocked line 309; ' +
      `${SETTLED} "a bare 403 with no wall marker is a block, not a named wall"`,
    established: ['test', 'ran', 'ruling'],
    note:
      'Predecessor: looks_blocked True. Confirmed by the detail the orchestrator settled on 2026-11-23 ' +
      '(the owner may overrule): a block is a wall outcome whose vendor is null, never a named one. ' +
      'Mode by the default rule (no puzzle, no access-denied wording); the settled detail does not ' +
      'name a mode. Vendor null: the lab classifier (scripts/browser-lab/harness/lab/classify.py ' +
      'classify(), run offline) answers wall:other "HTTP 403". The test used host x.com; replaced by ' +
      'shop.example.',
  },
  {
    id: 'bare-403-on-a-big-retailer-names-no-vendor',
    what: 'A bare 403 from amazon.ca with no wall marker is still a block with no vendor named',
    input: {
      rung: 'http',
      status: 403,
      finalUrl: 'https://www.amazon.ca/dp/B0BKVY4WKT',
      ...NOTHING,
      title: '',
      visibleText: 'x'.repeat(5000),
      visibleChars: 5000,
      documentBytes: 5000,
    },
    expected: { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' },
    from:
      `${SETTLED} "a bare 403 with no wall marker is a block, not a named wall" and "in-house walls ` +
      'name their vendor"',
    established: ['ruling'],
    note:
      "Added for the two details settled on 2026-11-23. The host is Amazon's, but nothing in the " +
      'page is a wall marker, so the in-house rule (which names a vendor from wall evidence, as in ' +
      'amazon-text-captcha-on-a-200-is-a-captcha) does not apply: the host alone names no vendor.',
  },
  {
    id: 'status-429-is-rate-limited',
    what: 'A 429 is a rate limit, not a wall; no Retry-After header gives a null delay',
    input: {
      rung: 'http',
      status: 429,
      finalUrl: 'https://shop.example/',
      ...NOTHING,
      title: '',
      visibleText: 'x'.repeat(5000),
      visibleChars: 5000,
      documentBytes: 5000,
    },
    expected: { kind: 'rate_limited', rung: 'http', retryAfterMs: null },
    from:
      'pricewatch/tests/test_fetch.py::test_blocked_by_status (429); ' +
      'test_retail_reliability.py::test_dead_product_or_transient_failure_does_not_block_host[429]; ' +
      'fetch.py get_or_render line 1257',
    established: ['test', 'read'],
    note:
      'Predecessor: looks_blocked True, the same boolean as a wall, but get_or_render never records a ' +
      'host as blocked on a 429 (line 1257) and the test asserts the playbook is untouched. S§5.1 has ' +
      'its own kind for it, so the boolean maps to rate_limited, which cannot change the playbook.',
  },
  {
    id: 'status-503-is-a-server-error',
    what: 'A 503 with no wall evidence is a server error, not a wall',
    input: {
      rung: 'http',
      status: 503,
      finalUrl: 'https://shop.example/',
      ...NOTHING,
      title: '',
      visibleText: 'x'.repeat(5000),
      visibleChars: 5000,
      documentBytes: 5000,
    },
    expected: { kind: 'server_error', rung: 'http' },
    from:
      'pricewatch/tests/test_fetch.py::test_blocked_by_status (503); ' +
      'test_retail_reliability.py::test_dead_product_or_transient_failure_does_not_block_host[503]; ' +
      'fetch.py store_answered (lines 190-195), get_or_render line 1257',
    established: ['test', 'read'],
    note:
      'Predecessor: looks_blocked True, but a 5xx never marks a host blocked (line 1257) and ' +
      'store_answered() calls a 5xx an outage. Mapped to server_error. The lab classifier answers ' +
      'error:http503.',
  },
  {
    id: 'status-401-is-login-required',
    what: 'A 401 with no wall evidence asks for a login',
    input: {
      rung: 'http',
      status: 401,
      finalUrl: 'https://shop.example/account/orders',
      ...NOTHING,
      title: '',
      visibleText: 'x'.repeat(5000),
      visibleChars: 5000,
      documentBytes: 5000,
    },
    expected: { kind: 'login_required', rung: 'http' },
    from:
      'fetch.py Page.looks_blocked line 309 (401 is blocked); _NOT_THE_STORES_ANSWER comment, lines 184-187; ' +
      `${SETTLED} "a 401 is login_required"`,
    established: ['read', 'ran', 'ruling'],
    note:
      'No predecessor test. looks_blocked returns True for 401 (ran), and the comment at line 184 ' +
      'calls 401/403 "a login or bot wall". The evidence has no wall signal, so the HTTP meaning of ' +
      '401 decides: login_required, as the orchestrator settled on 2026-11-23 (the owner may overrule).',
    divergence:
      'The predecessor counted a 401 as blocked, the same boolean as a wall. Settled 2026-11-23: a 401 ' +
      'is login_required.',
  },
  {
    id: 'amazon-404-with-the-automated-access-footer-is-not-found',
    what: "Amazon's own 404 page carries a challenge marker in its footer and is still not found",
    input: {
      rung: 'http',
      status: 404,
      finalUrl: 'https://www.amazon.ca/dp/B08MVFJ1RJ',
      ...NOTHING,
      title: 'Page Not Found',
      visibleText:
        "Sorry! We couldn't find that page. To discuss automated access to Amazon data please contact …",
      visibleChars: 124,
      documentBytes: 179,
    },
    expected: { kind: 'not_found', rung: 'http' },
    from:
      'pricewatch/tests/test_fetch.py::test_plain_404_is_not_a_challenge; ' +
      'test_amazon.py::test_retired_asin_reports_not_found_without_a_browser; fetch.py lines 311-317',
    established: ['test', 'ran', 'spec'],
    reducedFrom:
      'The test body (179 bytes). The support e-mail address after "please contact" is cut from the ' +
      'excerpt; it does not bear on the classification.',
    note:
      'S§5.1 names this case. "to discuss automated access" is a CHALLENGE_MARKERS entry; only the ' +
      '404 exemption keeps the predecessor right. The lab classifier gets it wrong (wall:other, ' +
      '"challenge copy in a small page").',
  },
  {
    id: 'gone-410-with-the-same-footer-is-not-found',
    what: 'A 410 whose body carries the automated-access footer is a dead product, not a wall',
    input: {
      rung: 'http',
      status: 410,
      finalUrl: 'https://www.amazon.ca/dp/B08MVFJ1RJ',
      ...NOTHING,
      title: 'Page Not Found',
      visibleText:
        "Sorry! We couldn't find that page. To discuss automated access to Amazon data please contact …",
      visibleChars: 124,
      documentBytes: 179,
    },
    expected: { kind: 'not_found', rung: 'http' },
    from:
      'fetch.py Page.looks_blocked line 316 (only 404 is exempt); get_or_render lines 1225 and 1244 ' +
      'and _may_still_clear line 365 (404 and 410 are a dead product); ' +
      'test_retail_reliability.py::test_dead_product_or_transient_failure_does_not_block_host[410]',
    established: ['read', 'ran', 'spec'],
    divergence:
      'Page.looks_blocked returns True for this 410 (ran): the footer marker matches in the visible ' +
      'text and only a 404 is exempt. The fetch path hid it by returning 404/410 before asking. ' +
      'S§5.1: the classifier does not match bare substrings, and a 410 is the store answering.',
  },
];
