// Pages that look like walls and are not, and what a page that is no wall is instead.
import type { WallCase } from '../contract.ts';

const STORE_TEXT = `${'Daylight Disco on a Stick, 5V lamp bar for Voron printers. '.repeat(8)}$9.50`;
const MAINTENANCE_TEXT = `${'We are upgrading our store and will be back soon. '.repeat(6)}5`;
const FILLER = 'Solid oak frame, quiet sweep movement, battery included.';

export const notWallCases: readonly WallCase[] = [
  {
    id: 'just-a-moment-loading-text-on-a-store-page-is-not-a-challenge',
    what: 'A large store page whose loading placeholder reads "Just a moment..." is not a challenge',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://memoryexpress.com/',
      headers: {},
      title: 'Memory Express',
      visibleText: 'ProductProductProduct … ProductProductJust a moment...',
      visibleChars: 10516,
      markup: [{ in: 'inline_script', value: 'const error="access denied";' }],
      documentBytes: 21117,
    },
    expected: { kind: 'ok', rung: 'http' },
    from:
      'pricewatch/tests/test_retail_reliability.py::test_loading_placeholder_and_javascript_are_not_challenges ' +
      '(first assertion); fetch.py lines 323-336; reports/2026-09-19-retailer-reliability.md line 23',
    established: ['test', 'ran', 'spec'],
    reducedFrom:
      'The test body (21,117 bytes: "<p>Product</p>" 1,500 times, the loading div, a script). The ' +
      'visible text is cut to its start and end; nothing between them is other than "Product".',
    note:
      'S§5.1 names this case. The "access denied" string lives in a script, which is not visible ' +
      "text; the page is far over the predecessor's 12,000-character small-document limit.",
  },
  {
    id: 'store-page-on-the-browser-rung-is-ok',
    what: "The store's own product page, read by the browser after a challenge cleared, is ok",
    input: {
      rung: 'browser',
      status: 200,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: 'Voron Lamp Bar | Siboor',
      visibleText: STORE_TEXT,
      visibleChars: STORE_TEXT.length,
      markup: [],
      documentBytes: 581,
    },
    expected: { kind: 'ok', rung: 'browser' },
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_cloudflare_challenge_that_clears_is_read_not_called_a_wall ' +
      'and ::test_a_served_page_is_not_kept_waiting (STORE page)',
    established: ['test', 'ran'],
  },
  {
    id: 'maintenance-503-page-is-a-server-error',
    what: "A store's own 503 maintenance page is a server error, not a wall",
    input: {
      rung: 'browser',
      status: 503,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: 'Down for maintenance',
      visibleText: MAINTENANCE_TEXT,
      visibleChars: MAINTENANCE_TEXT.length,
      markup: [],
      documentBytes: 375,
    },
    expected: { kind: 'server_error', rung: 'browser' },
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_real_error_page_whose_dom_changes_is_not_relabelled_a_200; ' +
      'fetch.py get_or_render line 1257',
    established: ['test', 'read'],
    note:
      'Predecessor: page.looks_blocked True with status 503 (asserted). Mapped to server_error as in ' +
      'status-503-is-a-server-error; the text names maintenance, no bot manager.',
  },
  {
    id: 'dead-link-on-the-browser-rung-is-not-found',
    what: 'A 404 on the browser rung is not found',
    input: {
      rung: 'browser',
      status: 404,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: '',
      visibleText: 'Not found',
      visibleChars: 9,
      markup: [],
      documentBytes: 35,
    },
    expected: { kind: 'not_found', rung: 'browser' },
    from: 'pricewatch/tests/test_browser_mode.py::test_a_dead_link_is_not_waited_on; fetch.py line 316',
    established: ['test', 'ran', 'spec'],
  },
  {
    id: 'blank-document-after-the-wait-is-empty',
    what: 'A document with no visible text, still blank when the wait ends, is empty',
    input: {
      rung: 'browser',
      status: 200,
      finalUrl: 'https://www.siboor.com/product/lamp-bar/',
      headers: {},
      title: '',
      visibleText: '',
      visibleChars: 0,
      markup: [],
      documentBytes: 26,
    },
    expected: { kind: 'empty', rung: 'browser' },
    from:
      'pricewatch/tests/test_browser_mode.py::test_a_blank_document_gets_time_to_fill_in (first state); ' +
      'fetch.py _usable line 1201 and get_or_render lines 1255-1258',
    established: ['test', 'read'],
    note:
      'Predecessor: looks_blocked False and _usable False (under 2,000 characters), so neither a wall ' +
      'nor a usable page, and no playbook entry. S§5.1 has `empty` for a page that came back with ' +
      'nothing to read; mapped there. How little text makes a page empty is an open question.',
  },
  {
    id: 'tiny-product-page-is-not-a-wall',
    what: 'A 38-byte page reading "Product page" is no wall; whether it is ok or empty is not decided',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example.com/products/x',
      headers: {},
      title: '',
      visibleText: 'Product page',
      visibleChars: 12,
      markup: [],
      documentBytes: 38,
    },
    expected: { kindIn: ['ok', 'empty'], rung: 'http' },
    from: 'pricewatch/tests/test_fetch.py::test_normal_page_not_blocked',
    established: ['test', 'ran'],
    note:
      'The test asserts only "not blocked". The lab classifier answers error:empty (under 60 ' +
      'characters); the engine returned the page. The case accepts either kind and no other.',
  },
  {
    id: 'datadome-script-on-a-large-store-page-is-not-a-wall',
    what: "A large store page that ships DataDome's script and a px-captcha string is not a wall",
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/products/cordless-drill',
      headers: {},
      title: 'Cordless Drill | Example Tools',
      visibleText: `${FILLER} ${FILLER} …`,
      visibleChars: 44459,
      markup: [
        { in: 'script_src', value: 'https://js.captcha-delivery.com/tags.js' },
        { in: 'inline_script', value: "var px='px-captcha';" },
      ],
      documentBytes: 45554,
    },
    expected: { kind: 'ok', rung: 'http' },
    from: 'fetch.py Page.looks_blocked lines 331-336 (markup markers count only under 12,000 characters)',
    established: ['read', 'ran'],
    note:
      'No predecessor test; the body was built for this case. A bot manager deployed on a page is not ' +
      'a wall (the lab classifier records it under vendors_present and answers ok).',
  },
  {
    id: 'product-titled-just-a-moment-is-not-a-wall',
    what: 'A large product page whose product is called "Just a Moment" is not a challenge',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/products/just-a-moment-wall-clock',
      headers: {},
      title: 'Just a Moment Wall Clock | Example Home',
      visibleText: `Just a Moment Wall Clock${FILLER} ${FILLER} …`,
      visibleChars: 44483,
      markup: [],
      documentBytes: 45496,
    },
    expected: { kind: 'ok', rung: 'http' },
    from: 'fetch.py Page.looks_blocked line 328 ("just a moment" in the title, at any size)',
    established: ['ran', 'spec'],
    divergence:
      'The predecessor calls this page blocked (ran): "just a moment" anywhere in the title is a wall ' +
      'whatever the document size. S§5.1: no bare substrings; the decision weighs title, text and ' +
      'size, and a 45 KB product page with its product in the title is not a challenge.',
  },
  {
    id: 'product-page-mentioning-robot-or-human-is-not-a-wall',
    what: 'A large product page for a game called "Robot or Human?" is not a wall',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/products/robot-or-human',
      headers: {},
      title: 'Robot or Human? Party Game | Example Toys',
      visibleText: `Robot or Human? The party game${FILLER} ${FILLER} …`,
      visibleChars: 44489,
      markup: [],
      documentBytes: 45504,
    },
    expected: { kind: 'ok', rung: 'http' },
    from: 'fetch.py Page.looks_blocked lines 334-335 (CHALLENGE_MARKERS in the visible text, at any size)',
    established: ['ran', 'spec'],
    divergence:
      'The predecessor calls this page blocked (ran): "robot or human" is a marker matched in the ' +
      'visible text of a page of any size. The lab classifier also calls it wall:perimeterx (title ' +
      'prefix). S§5.1: no bare substrings.',
  },
  {
    id: 'product-url-with-captcha-in-its-path-is-not-a-wall',
    what: 'A large product page whose URL contains "captcha" is not a wall',
    input: {
      rung: 'http',
      status: 200,
      finalUrl: 'https://shop.example/products/captcha-party-game',
      headers: {},
      title: 'Captcha Party Game | Example Toys',
      visibleText: `Captcha: the party game${FILLER} ${FILLER} …`,
      visibleChars: 44482,
      markup: [],
      documentBytes: 45489,
    },
    expected: { kind: 'ok', rung: 'http' },
    from: 'fetch.py Page.looks_blocked line 321 ("captcha" anywhere in the final URL)',
    established: ['ran', 'spec'],
    divergence:
      'The predecessor calls this page blocked (ran): "captcha" anywhere in the final URL is a wall. ' +
      'S§5.1: no bare substrings. The lab classifier answers ok.',
  },
  {
    id: 'walmart-saved-product-page-is-ok',
    what: "A saved Walmart Canada product page, from a site whose wall is PerimeterX's, is ok",
    input: {
      rung: 'http',
      status: 200,
      finalUrl:
        'https://www.walmart.ca/en/ip/Sony-WH-1000XM5-Wireless-headphones-with-top-noise-canceling-clear-calls-Auto-NC-Optimizer-and-Alexa-voice-control/2P9FP9H47OOW',
      headers: {},
      title:
        'Sony WH-1000XM5: Wireless headphones with top noise canceling, clear calls, Auto NC Optimizer, and Alexa voice control. - Walmart.ca',
      visibleText:
        'LanguageEnglishEnglishFrançaisReorderMy ItemsReorderListsRegistriesSign InAccountSign in or ' +
        'create accountPurchase HistoryWalmart+Help0$0.00 Sony WH-1000XM5: Wireless headphones with top ' +
        'noise canceling, clear calls, Auto NC Optimizer, and Alexa voice control. Actual ' +
        'Color:BlackBlack, $498.00$498.00Blue, $498.95$498.95White, $498.95$498.95 Current price is ' +
        'CAD$498.00 …',
      visibleChars: 2560,
      markup: [],
      documentBytes: 50023,
    },
    expected: { kind: 'ok', rung: 'http' },
    from: 'pricewatch/tests/fixtures/displayed/walmart.html, run through fetch.py Page.looks_blocked with status 200',
    established: ['ran'],
    reducedFrom:
      'pricewatch/tests/fixtures/displayed/walmart.html (50,023 bytes as saved; the predecessor may ' +
      'already have trimmed it: it holds one script). Kept: title, the og:url as final URL, the first ' +
      '330 characters of visible text. No cookies, tokens or personal data were in it. Status and ' +
      'rung are assumed (the fixture records neither); the classification does not depend on the ' +
      'cut text: no marker occurs anywhere in the saved page (ran).',
    note: 'The only predecessor saved pages are non-walls; none of the 24 fixtures is a wall (ran).',
  },
];
