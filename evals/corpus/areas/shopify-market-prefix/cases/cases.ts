// Shopify Markets cases. The prefix choices were established by running the predecessor's
// preferred_market offline against stubbed /cart.js answers (no network); the URL rule by running
// a line-for-line transcription of stores/shopify.py lines 307-313 with its own _locale_prefix and
// _locale_market.
import type { ShopifyMarketCase, UserMarket } from '../contract.ts';

const SHOPIFY_PY = 'pricewatch/src/pricewatch/stores/shopify.py';
const TEST_SHOPIFY = 'pricewatch/tests/test_shopify.py';
const ORIGIN = 'https://shop.example.com';
const CANADA: UserMarket = { country: 'CA', currency: 'CAD' };

const ranPreferredMarket = (answers: string, prefix: string, probed: string) =>
  ({
    file: SHOPIFY_PY,
    at: 'preferred_market, _locale_candidates, _EXTRA_LOCALES (lines 58-59, 94-148)',
    how: 'running the function offline',
    note: `cart.js answers ${answers}: returned ${prefix}, probed ${probed}`,
  }) as const;
const ranResultUrl = (path: string, url: string) =>
  ({
    file: SHOPIFY_PY,
    at: 'ShopifyAdapter.search, lines 307-313',
    how: 'running the function offline',
    note: `pinned "/en-ca", path ${path} gave ${url}`,
  }) as const;
const pinnedTest = {
  file: TEST_SHOPIFY,
  at: 'test_a_pinned_market_keeps_a_results_own_locale',
  how: 'test assertion',
} as const;

export const cases: readonly ShopifyMarketCase[] = [
  // Which market prefix to search under
  {
    id: 'switch-to-the-market-billing-the-users-currency',
    what: 'A Canadian shopper on a USD storefront is moved to /en-ca, which bills CAD',
    subject: 'pickMarketPrefix',
    input: { market: CANADA, defaultMarketCurrency: 'USD', cartCurrencies: { 'en-ca': 'CAD' } },
    expected: { prefix: '/en-ca', probed: ['en-ca'] },
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_search_switches_to_the_market_that_bills_in_your_currency',
        how: 'test assertion',
      },
      ranPreferredMarket('{en-ca: CAD}', '"/en-ca"', '[en-ca]'),
    ],
  },
  {
    id: 'stay-when-no-market-bills-the-users-currency',
    what: 'No candidate answers in CAD: the default market is searched and reported in USD',
    subject: 'pickMarketPrefix',
    input: { market: CANADA, defaultMarketCurrency: 'USD', cartCurrencies: {} },
    expected: { prefix: '', probed: ['en-ca', 'ca', 'fr-ca'] },
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_search_stays_put_when_no_market_bills_in_your_currency',
        how: 'test assertion',
      },
      ranPreferredMarket('{}', '""', '[en-ca, ca, fr-ca]'),
    ],
  },
  {
    id: 'default-market-already-bills-the-users-currency',
    what: 'A storefront whose default market bills CAD is not probed',
    subject: 'pickMarketPrefix',
    input: { market: CANADA, defaultMarketCurrency: 'CAD', cartCurrencies: { 'en-ca': 'CAD' } },
    expected: { prefix: '', probed: [] },
    from: [
      { file: SHOPIFY_PY, at: 'preferred_market, lines 131-133', how: 'reading the function' },
      ranPreferredMarket('{en-ca: CAD}, default CAD', '""', '[]'),
    ],
  },
  {
    id: 'a-candidate-billing-another-currency-is-passed-over',
    what: '/en-ca answering USD is not the Canadian market; /ca answering CAD is',
    subject: 'pickMarketPrefix',
    input: {
      market: CANADA,
      defaultMarketCurrency: 'USD',
      cartCurrencies: { 'en-ca': 'USD', ca: 'CAD' },
    },
    expected: { prefix: '/ca', probed: ['en-ca', 'ca'] },
    from: [ranPreferredMarket('{en-ca: USD, ca: CAD}', '"/ca"', '[en-ca, ca]')],
  },
  {
    id: 'french-canadian-locale-is-tried-last',
    what: 'Only /fr-ca bills CAD: it is found after en-ca and ca',
    subject: 'pickMarketPrefix',
    input: { market: CANADA, defaultMarketCurrency: 'USD', cartCurrencies: { 'fr-ca': 'CAD' } },
    expected: { prefix: '/fr-ca', probed: ['en-ca', 'ca', 'fr-ca'] },
    from: [ranPreferredMarket('{fr-ca: CAD}', '"/fr-ca"', '[en-ca, ca, fr-ca]')],
  },
  {
    id: 'swiss-candidates-in-order',
    what: 'A Swiss shopper: en-ch, ch, de-ch, then fr-ch',
    subject: 'pickMarketPrefix',
    input: {
      market: { country: 'CH', currency: 'CHF' },
      defaultMarketCurrency: 'EUR',
      cartCurrencies: { 'fr-ch': 'CHF' },
    },
    expected: { prefix: '/fr-ch', probed: ['en-ch', 'ch', 'de-ch', 'fr-ch'] },
    from: [
      ranPreferredMarket('{fr-ch: CHF}, default EUR', '"/fr-ch"', '[en-ch, ch, de-ch, fr-ch]'),
    ],
  },
  // A search result's URL on the pinned market
  {
    id: 'same-market-other-language-is-left-alone',
    what: 'A /fr-ca result from an /en-ca search is the same market: never /en-ca/fr-ca/',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/fr-ca/products/pla-pro' },
    expected: 'https://shop.example.com/fr-ca/products/pla-pro',
    from: [pinnedTest],
  },
  {
    id: 'path-without-a-locale-gets-the-pinned-prefix',
    what: "A result path with no locale would be the default market's price: it gets /en-ca",
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/products/pla-max' },
    expected: 'https://shop.example.com/en-ca/products/pla-max',
    from: [pinnedTest],
  },
  {
    id: 'pinned-prefix-is-not-doubled',
    what: 'A path already under /en-ca is not prefixed again',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/en-ca/products/pla-mini' },
    expected: 'https://shop.example.com/en-ca/products/pla-mini',
    from: [
      pinnedTest,
      {
        file: TEST_SHOPIFY,
        at: 'test_search_switches_to_the_market_that_bills_in_your_currency ("joining must not double them up")',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'another-markets-locale-is-moved',
    what: 'An /en-us result is moved to the pinned /en-ca market',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/en-us/products/pla-us' },
    expected: 'https://shop.example.com/en-ca/products/pla-us',
    from: [pinnedTest],
  },
  {
    id: 'language-only-locale-is-the-default-market',
    what: 'A /fr result is the default market in French: moved to /en-ca',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/fr/products/pla-fr' },
    expected: 'https://shop.example.com/en-ca/products/pla-fr',
    from: [pinnedTest],
  },
  {
    id: 'default-market-path-joins-the-origin',
    what: 'With no pinned market a path joins the origin as it is',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '', path: '/products/pla-pro' },
    expected: 'https://shop.example.com/products/pla-pro',
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_search_stays_put_when_no_market_bills_in_your_currency',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'collection-segment-is-no-locale',
    what: '"collections" is not a locale, so the path gets the pinned prefix',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/collections/pla/products/x' },
    expected: 'https://shop.example.com/en-ca/collections/pla/products/x',
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_locale_prefix_recognised_only_where_it_is_one',
        how: 'test assertion',
        note: '_locale_prefix("https://s.com/collections/pla/products/x") == ""',
      },
      ranResultUrl(
        '/collections/pla/products/x',
        'https://shop.example.com/en-ca/collections/pla/products/x',
      ),
    ],
  },
  {
    id: 'language-only-de-locale-is-recognised',
    what: 'A two-letter /de segment is a locale of the default market and is moved',
    subject: 'marketResultUrl',
    input: { origin: ORIGIN, pinnedPrefix: '/en-ca', path: '/de/products/x' },
    expected: 'https://shop.example.com/en-ca/products/x',
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_locale_prefix_recognised_only_where_it_is_one',
        how: 'test assertion',
        note: '_locale_prefix("https://s.com/de/products/x") == "/de"',
      },
      ranResultUrl('/de/products/x', 'https://shop.example.com/en-ca/products/x'),
    ],
  },
];
