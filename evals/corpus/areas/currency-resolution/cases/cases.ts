// Currency resolution cases: the order of the sources, explicit marks, the bare-"$" rule and the
// unknown currency. The `converted` and `conflict` refusals are in `converted-price-refusal`.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import {
  type CurrencyCase,
  type CurrencyExpected,
  type CurrencyRefusalCode,
  type CurrencySource,
  evidence,
} from '../contract.ts';

const MONEY_PY = 'pricewatch/src/pricewatch/money.py';
const LEARNED_PY = 'pricewatch/src/pricewatch/stores/learned.py';
const EXTRACT_PY = 'pricewatch/src/pricewatch/extract.py';
const TEST_CANADA = 'pricewatch/tests/test_canada.py';
const TEST_RECIPES = 'pricewatch/tests/test_recipes.py';
const TEST_PREFERENCES = 'pricewatch/tests/test_preferences.py';
const TEST_SHOPIFY = 'pricewatch/tests/test_shopify.py';
const SPEC_ORDER = {
  file: 'docs/spec.md',
  at: 'S§5.2 Currency resolution order',
  how: 'spec',
} as const;

const is = (currency: MinorUnitCurrency, source: CurrencySource): CurrencyExpected => ({
  ok: true,
  currency,
  source,
});
const refused = (code: CurrencyRefusalCode): CurrencyExpected => ({ ok: false, code });

const marksBeatHost = {
  file: TEST_CANADA,
  at: 'test_explicit_currency_marks_beat_the_host',
  how: 'test assertion',
} as const;
// The predecessor believed an explicit mark over the host (money.currency_from_text). The
// orchestrator settled on 2026-11-23 (the owner may overrule) that currency evidence ranks an
// explicit mark on the figure, then a platform declaration, then the page locale, then the ccTLD;
// the cases where that order decides against the host cite it (before, they were specSilent).
const SETTLED_RANK = {
  file: 'docs/progress.md',
  at: '2026-11-23, "Settled by the orchestrator"',
  how: 'owner ruling',
  note: 'currency evidence ranks an explicit mark on the figure, then a platform declaration, then the page locale, then the ccTLD (an engineering detail the owner may overrule)',
} as const;
const RULING_PRESENTMENT = {
  file: 'docs/progress.md',
  at: '2026-11-23, "Owner rulings on the Phase 1 questions"',
  how: 'owner ruling',
  note: 'A Shopify Markets presentment price is the shop\'s own price for that market, not a converted figure; conversions made by the agent or a site\'s "approx." figures are still refused.',
} as const;
const wholeWords = {
  file: TEST_CANADA,
  at: 'test_iso_codes_are_matched_as_whole_words',
  how: 'test assertion',
} as const;
const bareDollarHost = {
  file: TEST_CANADA,
  at: 'test_bare_dollar_resolves_to_the_hosts_currency',
  how: 'test assertion',
} as const;
const bareDollarFromStore = {
  file: TEST_RECIPES,
  at: 'test_bare_dollar_comes_from_the_store',
  how: 'test assertion',
} as const;

export const cases: readonly CurrencyCase[] = [
  // Declared sources
  {
    id: 'platform-answer-beats-the-host',
    what: 'A .com Shopify storefront whose /cart.js says CAD bills CAD',
    input: evidence('shop.example.com', { platform: 'CAD' }),
    expected: is('CAD', 'platform'),
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_currency_comes_from_cart_js_not_the_hostname',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'platform-answer-before-price-currency',
    what: 'The platform answer outranks a priceCurrency that disagrees',
    input: evidence('shop.example.com', { platform: 'CAD', priceCurrency: 'USD' }),
    expected: is('CAD', 'platform'),
    from: [
      {
        ...SPEC_ORDER,
        note: 'no predecessor case puts the two side by side: its Shopify reader asked only /cart.js (stores/shopify.py market_currency, lines 101-119)',
      },
    ],
  },
  {
    id: 'price-currency-without-platform',
    what: "The structured data's own priceCurrency names the money",
    input: evidence('shop.example.com', { priceCurrency: 'GBP' }),
    expected: is('GBP', 'price_currency'),
    from: [
      {
        file: EXTRACT_PY,
        at: "extract, line 1915 (the data's own code first)",
        how: 'reading the function',
      },
    ],
  },
  {
    id: 'price-currency-in-lower-case',
    what: 'A declared code is read in any case',
    input: evidence('shop.example.com', { priceCurrency: 'cad' }),
    expected: is('CAD', 'price_currency'),
    from: [
      {
        file: EXTRACT_PY,
        at: '_declared_currency, line 1891 (.upper())',
        how: 'reading the function',
      },
    ],
  },
  {
    id: 'declared-code-without-minor-unit-is-refused',
    what: 'A priceCurrency of gold (XAU) is not a currency a listing can carry',
    input: evidence('shop.example.com', { priceCurrency: 'XAU' }),
    expected: refused('not_a_listing_currency'),
    from: [
      {
        file: EXTRACT_PY,
        at: '_declared_currency, line 1892 (any [A-Z]{3})',
        how: 'reading the function',
      },
    ],
    divergence:
      'The predecessor accepted any three letters as a declared currency. S§4.1 and ListingCurrency allow only an ISO 4217 code with a minor unit, or unknown.',
  },
  // Shopify Markets: the presentment price of a market prefix is the shop's own
  {
    id: 'shopify-markets-presentment-price-is-the-shops-own',
    what: 'A US Shopify .com pinned to /en-ca bills CAD there: "$25.00 CAD" is its own price, not a conversion',
    input: evidence('shop.example.com', { platform: 'CAD', priceText: '$25.00 CAD' }),
    expected: is('CAD', 'price_mark'),
    from: [
      RULING_PRESENTMENT,
      SETTLED_RANK,
      {
        file: TEST_SHOPIFY,
        at: 'test_currency_comes_from_cart_js_not_the_hostname',
        how: 'test assertion',
        note: "the predecessor took the market's currency from /cart.js under the market prefix",
      },
    ],
    notes:
      "Added for the owner's ruling of 2026-11-23, which answers question 5 of progress.md 2026-11-18 (is a presentment price a converted figure? no). `platform` is what /en-ca/cart.js states for the pinned Canadian market (shopify-market-prefix). The mark (CAD) agrees with that declaration, so nothing is refused; the source named is the mark, which ranks first.",
  },
  {
    id: 'shopify-markets-presentment-bare-dollar',
    what: 'The same pinned market showing a bare "$25.00" bills CAD by its /cart.js',
    input: evidence('shop.example.com', { platform: 'CAD', priceText: '$25.00' }),
    expected: is('CAD', 'platform'),
    from: [RULING_PRESENTMENT, SETTLED_RANK],
    notes:
      'Added for the owner\'s ruling of 2026-11-23. A bare "$" is no explicit mark, and a .com names no market, so there is no conflict: the platform declaration decides.',
  },
  {
    id: 'site-approx-conversion-is-refused',
    what: 'A site\'s "approx." figure is a conversion and is refused, even with nothing declared',
    input: evidence('shop.example.com', { priceText: 'approx. CA$25.00' }),
    expected: refused('converted'),
    from: [RULING_PRESENTMENT],
    notes:
      'Added for the owner\'s ruling of 2026-11-23 ("a site\'s approx. figures are still refused"). Without the word "approx." the mark would name CAD (ca-dollar-mark-on-a-dot-com). No predecessor case was read for this text.',
  },
  {
    id: 'site-approx-sign-beside-a-declared-currency-is-refused',
    what: 'An "≈ €23.10" figure beside a USD declaration is a conversion',
    input: evidence('shop.example.com', { priceCurrency: 'USD', priceText: '≈ €23.10' }),
    expected: refused('converted'),
    from: [RULING_PRESENTMENT],
    notes:
      "Added for the owner's ruling of 2026-11-23. Refused twice over: the site marks the figure approximate, and its mark (EUR) is not the declared USD.",
  },
  // An explicit mark on the figure
  {
    id: 'us-dollar-mark-on-a-canadian-host',
    what: '"US$" on a .ca storefront is US dollars',
    input: evidence('newegg.ca', { priceText: 'US$88' }),
    expected: is('USD', 'price_mark'),
    from: [marksBeatHost, SETTLED_RANK],
  },
  {
    id: 'cdn-dollar-mark-on-a-dot-com',
    what: '"CDN$" is Canadian dollars on any host',
    input: evidence('newegg.com', { priceText: 'CDN$ 12.00' }),
    expected: is('CAD', 'price_mark'),
    from: [marksBeatHost],
  },
  {
    id: 'ca-dollar-mark-on-a-dot-com',
    what: '"CA$" is Canadian dollars on any host',
    input: evidence('example.com', { priceText: 'CA$ 12.00' }),
    expected: is('CAD', 'price_mark'),
    from: [marksBeatHost],
  },
  {
    id: 'euro-sign-on-a-dot-com',
    what: 'A euro sign names euros',
    input: evidence('3djake.com', { priceText: '€12' }),
    expected: is('EUR', 'price_mark'),
    from: [marksBeatHost],
  },
  {
    id: 'pound-sign-on-a-canadian-host',
    what: 'A pound sign names pounds even on a .ca host',
    input: evidence('amazon.ca', { priceText: '£12' }),
    expected: is('GBP', 'price_mark'),
    from: [marksBeatHost, SETTLED_RANK],
  },
  {
    id: 'australian-dollar-mark',
    what: '"A$" is Australian dollars, not US dollars',
    input: evidence('example.com', { priceText: 'A$ 12' }),
    expected: is('AUD', 'price_mark'),
    from: [
      {
        file: 'pricewatch/tests/test_money.py',
        at: 'test_qualified_dollar_signs_are_not_usd',
        how: 'test assertion',
        note: 'detect_currency("A$ 12") == "AUD"',
      },
    ],
  },
  {
    id: 'iso-code-before-the-figure',
    what: 'An ISO code before the figure names the money',
    input: evidence('newegg.com', { priceText: 'CAD 138.73' }),
    expected: is('CAD', 'price_mark'),
    from: [marksBeatHost],
  },
  {
    id: 'iso-code-after-the-figure',
    what: 'An ISO code after the figure beats the .ca host',
    input: evidence('newegg.ca', { priceText: '12 USD' }),
    expected: is('USD', 'price_mark'),
    from: [wholeWords, SETTLED_RANK],
  },
  {
    id: 'iso-code-in-lower-case',
    what: 'An ISO code is matched in any case',
    input: evidence('newegg.ca', { priceText: 'usd 12' }),
    expected: is('USD', 'price_mark'),
    from: [wholeWords, SETTLED_RANK],
  },
  {
    id: 'iso-code-glued-to-a-dollar-sign',
    what: '"CAD$12" names Canadian dollars',
    input: evidence('newegg.com', { priceText: 'Price: CAD$12' }),
    expected: is('CAD', 'price_mark'),
    from: [wholeWords],
  },
  {
    id: 'letters-inside-a-word-are-no-code',
    what: '"Audio" is not AUD: the bare "$" falls through to the .ca host',
    input: evidence('newegg.ca', { priceText: 'Audio cable $12.99' }),
    expected: is('CAD', 'host_market'),
    from: [wholeWords],
  },
  {
    id: 'decade-is-no-cad',
    what: '"Decade" holds the letters CAD but names no currency',
    input: evidence('newegg.com', { priceText: 'Decade edition $9', storeCountry: 'US' }),
    expected: is('USD', 'store_country'),
    from: [
      {
        ...wholeWords,
        note: 'the predecessor reached USD from the .com host; with no store country this case would be unknown (see bare-dollar-on-a-dot-com-nothing-places)',
      },
    ],
  },
  // The bare "$": the store's own country
  {
    id: 'bare-dollar-on-a-country-tld',
    what: 'A bare "$" on a .ca storefront is Canadian dollars',
    input: evidence('newegg.ca', { priceText: '$88.41' }),
    expected: is('CAD', 'host_market'),
    from: [bareDollarHost],
  },
  {
    id: 'bare-dollar-on-a-www-host',
    what: 'The www. label does not hide the country TLD',
    input: evidence('www.newegg.ca', { priceText: '$88.41' }),
    expected: is('CAD', 'host_market'),
    from: [bareDollarHost],
  },
  {
    id: 'bare-dollar-on-a-two-part-tld',
    what: 'A bare "$" on a .com.au storefront is Australian dollars',
    input: evidence('shop.example.com.au', { priceText: '$88' }),
    expected: is('AUD', 'host_market'),
    from: [bareDollarHost],
  },
  {
    id: 'co-uk-is-read-whole',
    what: '.co.uk is the United Kingdom, read before .uk',
    input: evidence('amazon.co.uk'),
    expected: is('GBP', 'host_market'),
    from: [{ file: TEST_PREFERENCES, at: 'test_region_from_hostname', how: 'test assertion' }],
  },
  {
    id: 'no-mark-on-a-country-tld',
    what: 'A price with no mark and no declaration on a .ca storefront is Canadian dollars',
    input: evidence('shop.example.ca'),
    expected: is('CAD', 'host_market'),
    from: [
      {
        file: TEST_SHOPIFY,
        at: 'test_currency_falls_back_to_the_hostname_when_cart_js_is_absent',
        how: 'test assertion',
      },
      {
        file: LEARNED_PY,
        at: 'read_page, lines 305-308 ("or a price with no mark at all")',
        how: 'reading the function',
      },
    ],
  },
  {
    id: 'unmarked-text-on-a-country-tld',
    what: 'Text with no mark on a .ca storefront takes the host, not a default',
    input: evidence('newegg.ca', { priceText: 'no money here' }),
    expected: is('CAD', 'host_market'),
    from: [
      {
        file: TEST_CANADA,
        at: 'test_bare_dollar_without_a_host_is_the_default',
        how: 'test assertion',
        note: 'currency_from_text("no money here", "newegg.ca", "EUR") == "EUR"',
      },
    ],
    divergence:
      'money.currency_from_text returned its default argument (EUR here) for text without a "$", ignoring the host. S§2.2: there is no default currency; S§5.2: the ccTLD is a source.',
  },
  {
    id: 'regional-sub-domain-names-the-market',
    what: 'A bare "$" on ca.store.… is Canadian dollars',
    input: evidence('ca.store.bambulab.com', { priceText: '$19.99' }),
    expected: is('CAD', 'host_market'),
    from: [bareDollarFromStore],
    specSilent: true,
  },
  {
    id: 'us-regional-sub-domain',
    what: 'A bare "$" on us.store.… is US dollars',
    input: evidence('us.store.bambulab.com', { priceText: '$19.99' }),
    expected: is('USD', 'host_market'),
    from: [bareDollarFromStore],
    specSilent: true,
  },
  {
    id: 'eu-sub-domain-is-euros',
    what: 'eu.store.… bills euros',
    input: evidence('eu.store.bambulab.com'),
    expected: is('EUR', 'host_market'),
    from: [{ file: TEST_PREFERENCES, at: 'test_currency_from_hostname', how: 'test assertion' }],
    specSilent: true,
  },
  {
    id: 'host-market-before-store-country',
    what: "The storefront's own sub-domain outranks the store's country in the directory",
    input: evidence('ca.store.bambulab.com', { priceText: '$19.99', storeCountry: 'US' }),
    expected: is('CAD', 'host_market'),
    from: [
      {
        ...bareDollarFromStore,
        note: 'parameter ("ca.store.bambulab.com", "bambulab", "", "CAD"): "the storefront, not the US catalog row"',
      },
      {
        file: LEARNED_PY,
        at: 'bare_dollar (lines 184-202)',
        how: 'running the function offline',
        note: 'bare_dollar("ca.store.bambulab.com", None, "US") returned "CAD"',
      },
    ],
    specSilent: true,
  },
  {
    id: 'bare-dollar-on-a-dot-com-takes-the-store-country',
    what: 'A Canadian .com\'s bare "$" is Canadian dollars by the directory\'s country',
    input: evidence('princessauto.com', { priceText: '$50.51', storeCountry: 'CA' }),
    expected: is('CAD', 'store_country'),
    from: [
      bareDollarFromStore,
      {
        file: TEST_RECIPES,
        at: 'test_a_recipe_reads_a_bare_dollar_in_the_stores_currency',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'bare-dollar-on-a-dot-com-nothing-places',
    what: 'A bare "$" on a .com that nothing places is an unknown currency',
    input: evidence('newegg.com', { priceText: '$88' }),
    expected: refused('unknown_currency'),
    from: [
      { ...bareDollarHost, note: 'currency_from_text("$88", "newegg.com") == "USD"' },
      {
        file: TEST_CANADA,
        at: 'test_a_store_whose_name_says_canada_bills_a_bare_dollar_in_cad',
        how: 'test assertion',
        note: 'learned.bare_dollar("newegg.com") == "": "a bare .com still says nothing"',
      },
      {
        file: TEST_RECIPES,
        at: 'test_a_bare_dollar_on_a_store_nothing_places_is_not_taken_on_trust',
        how: 'test assertion',
        note: 'currency_unknown',
      },
    ],
    divergence:
      'money.currency_for_host maps a .com to US and so a bare "$" to USD; the later learned.bare_dollar and the recipe path say a .com names nothing and refuse (currency_unknown). S§2.2 (no default currency) follows the latter.',
  },
  {
    id: 'nothing-says-what-money',
    what: 'No source at all is an unknown currency, never USD',
    input: evidence('toolshop.com'),
    expected: refused('unknown_currency'),
    from: [
      {
        file: TEST_CANADA,
        at: 'test_bare_dollar_without_a_host_is_the_default',
        how: 'test assertion',
        note: 'currency_from_text("$88.41") == "USD"',
      },
      {
        file: TEST_CANADA,
        at: 'test_a_store_whose_name_says_canada_bills_a_bare_dollar_in_cad',
        how: 'test assertion',
        note: 'learned.bare_dollar("toolshop.com") == ""',
      },
      {
        file: MONEY_PY,
        at: 'currency_from_text and detect_currency (lines 83-110): default="USD"',
        how: 'reading the function',
      },
    ],
    divergence:
      'money.currency_from_text and detect_currency default to USD (or a caller-given default). S§2.2: there is no default currency; unknown is a value.',
  },
  {
    id: 'unplaceable-host-is-unknown',
    what: 'A host that names no market, with no other source, is an unknown currency',
    input: evidence('localhost', { priceText: '$88.41' }),
    expected: refused('unknown_currency'),
    from: [
      {
        file: TEST_CANADA,
        at: 'test_bare_dollar_without_a_host_is_the_default',
        how: 'test assertion',
        note: 'currency_from_text("$88.41", "localhost", "CAD") == "CAD": unknown host, default',
      },
    ],
    divergence: 'The predecessor fell back to the default argument. S§2.2: no default currency.',
  },
  // The host's own words (a predecessor heuristic)
  {
    id: 'host-name-says-canada',
    what: 'A .com whose name says Canada bills a bare "$" in Canadian dollars',
    input: evidence('napacanada.com', { priceText: '$12.59' }),
    expected: is('CAD', 'host_name'),
    from: [
      {
        file: TEST_CANADA,
        at: 'test_a_store_whose_name_says_canada_bills_a_bare_dollar_in_cad',
        how: 'test assertion',
      },
      {
        file: LEARNED_PY,
        at: 'country_in_name, _COUNTRY_IN_NAME (lines 205-218)',
        how: 'reading the function',
      },
    ],
    specSilent: true,
  },
  {
    id: 'host-name-says-quebec',
    what: '"quebec" in the host names Canada',
    input: evidence('boutiquequebec.com', { priceText: '$12' }),
    expected: is('CAD', 'host_name'),
    from: [
      {
        file: TEST_CANADA,
        at: 'test_a_store_whose_name_says_canada_bills_a_bare_dollar_in_cad',
        how: 'test assertion',
        note: 'country_in_name("boutiquequebec.com") == "CA"',
      },
    ],
    specSilent: true,
  },
  {
    id: 'host-name-before-store-country',
    what: "The host's own words outrank the directory's country",
    input: evidence('napacanada.com', { priceText: '$12.59', storeCountry: 'US' }),
    expected: is('CAD', 'host_name'),
    from: [
      {
        file: LEARNED_PY,
        at: 'bare_dollar (lines 184-202)',
        how: 'running the function offline',
        note: 'bare_dollar("napacanada.com", None, "US") returned "CAD"',
      },
    ],
    specSilent: true,
  },
  // hreflang / og:locale (spec only: the predecessor read neither)
  {
    id: 'locale-names-the-country',
    what: 'The page\'s en-CA locale makes a bare "$" on a .com Canadian dollars',
    input: evidence('shop.example.com', { locale: 'en-CA', priceText: '$19.99' }),
    expected: is('CAD', 'locale'),
    from: [SPEC_ORDER],
    divergence:
      'The predecessor read no hreflang or og:locale (learned.bare_dollar distrusts page language: "Princess Auto and Canada Computers are Canadian .coms whose pages even say lang=en-US"), and money.currency_from_text gave USD here. S§5.2 puts hreflang/og:locale before the ccTLD.',
  },
  {
    id: 'og-locale-with-underscore',
    what: 'og:locale writes the country after an underscore',
    input: evidence('shop.example.com', { locale: 'fr_CA' }),
    expected: is('CAD', 'locale'),
    from: [SPEC_ORDER],
  },
  {
    id: 'locale-without-a-country',
    what: 'A language-only locale names no country',
    input: evidence('shop.example.com', { locale: 'en' }),
    expected: refused('unknown_currency'),
    from: [SPEC_ORDER],
  },
];
