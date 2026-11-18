// Regional storefront cases. Storefront countries and currencies are what the predecessor derived
// from each host (money.region_for_host, currency_for_host); in Agentic Dasher they come from the
// store directory. The ASINs are the predecessor's test listings.
import type { RegionalUrlCase, Storefronts, UserMarket } from '../contract.ts';

const TEST_AMAZON = 'pricewatch/tests/test_amazon.py';
const TEST_PREFERENCES = 'pricewatch/tests/test_preferences.py';
const BIGBOX_PY = 'pricewatch/src/pricewatch/stores/bigbox.py';
const BASE_PY = 'pricewatch/src/pricewatch/stores/base.py';

const AMAZON: Storefronts = [
  { host: 'amazon.com', country: 'US', currency: 'USD' },
  { host: 'amazon.ca', country: 'CA', currency: 'CAD' },
  { host: 'amazon.co.uk', country: 'GB', currency: 'GBP' },
  { host: 'amazon.de', country: 'DE', currency: 'EUR' },
];
const US_STORE = { host: 'us.store.bambulab.com', country: 'US', currency: 'USD' } as const;
const CA_STORE = { host: 'ca.store.bambulab.com', country: 'CA', currency: 'CAD' } as const;
const EU_STORE = { host: 'eu.store.bambulab.com', country: null, currency: 'EUR' } as const;

const CANADA: UserMarket = { country: 'CA', currency: 'CAD' };
const FRANCE: UserMarket = { country: 'FR', currency: 'EUR' };
const GERMANY: UserMarket = { country: 'DE', currency: 'EUR' };
const BRITAIN: UserMarket = { country: 'GB', currency: 'GBP' };
const USA: UserMarket = { country: 'US', currency: 'USD' };
const AUSTRALIA: UserMarket = { country: 'AU', currency: 'AUD' };

const ranRegionalUrl = (market: string, url: string, result: string) =>
  ({
    file: BIGBOX_PY,
    at: 'AmazonAdapter.regional_url (lines 431-448) with StoreAdapter.storefront',
    how: 'running the function offline',
    note: `preferred region/currency ${market}: regional_url(${JSON.stringify(url)}) returned ${result}`,
  }) as const;

export const cases: readonly RegionalUrlCase[] = [
  // Which storefront to search
  {
    id: 'search-the-users-country-storefront',
    what: "A Canadian shopper searches the store's Canadian storefront",
    subject: 'searchStorefront',
    input: { market: CANADA, storefronts: [US_STORE, CA_STORE] },
    expected: 'ca.store.bambulab.com',
    from: [
      {
        file: TEST_PREFERENCES,
        at: 'test_storefront_prefers_the_users_region',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'search-a-shared-currency-storefront',
    what: 'No German storefront, but the euro one bills the right money',
    subject: 'searchStorefront',
    input: { market: GERMANY, storefronts: [US_STORE, EU_STORE] },
    expected: 'eu.store.bambulab.com',
    from: [
      {
        file: TEST_PREFERENCES,
        at: 'test_storefront_falls_back_to_a_shared_currency',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'search-the-primary-without-a-regional-option',
    what: 'No storefront for Canada or in CAD: the primary is searched',
    subject: 'searchStorefront',
    input: {
      market: CANADA,
      storefronts: [
        { host: 'us.elegoo.com', country: 'US', currency: 'USD' },
        { host: 'elegoo.com', country: 'US', currency: 'USD' },
      ],
    },
    expected: 'us.elegoo.com',
    from: [
      {
        file: TEST_PREFERENCES,
        at: 'test_storefront_keeps_primary_when_no_regional_option',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'search-amazon-de-for-a-french-shopper',
    what: 'Amazon has no French storefront here; amazon.de bills euros, so it is searched',
    subject: 'searchStorefront',
    input: { market: FRANCE, storefronts: AMAZON },
    expected: 'amazon.de',
    from: [
      {
        file: BASE_PY,
        at: 'StoreAdapter.storefront (lines 119-142)',
        how: 'running the function offline',
        note: 'Amazon domains, preferred FR/EUR: storefront() returned "amazon.de"',
      },
    ],
  },
  // Where a pasted link belongs
  {
    id: 'amazon-com-link-moves-to-amazon-ca',
    what: "A Canadian shopper's amazon.com link is the same ASIN on amazon.ca",
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/dp/B0FQVHHBQV',
      market: CANADA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.ca/dp/B0FQVHHBQV' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_a_com_link_maps_onto_the_shoppers_marketplace',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'link-already-on-the-regional-storefront',
    what: 'An amazon.ca link for a Canadian shopper stays as it is',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.ca/dp/B0FQVHHBQV',
      market: CANADA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'unchanged', reason: 'already_regional' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_a_com_link_maps_onto_the_shoppers_marketplace ("already there")',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'search-page-has-no-listing-id',
    what: 'A search-results link carries no ASIN and stays as it is',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/s?k=heater',
      market: CANADA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'unchanged', reason: 'no_listing_id' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_a_com_link_maps_onto_the_shoppers_marketplace ("no ASIN")',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'country-without-its-own-marketplace',
    what: 'A French shopper keeps the amazon.com link: amazon.de does not sell to France here',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/dp/B0FQVHHBQV',
      market: FRANCE,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'unchanged', reason: 'no_storefront_for_market' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_a_region_without_its_own_marketplace_keeps_the_link',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'country-with-neither-storefront-nor-currency',
    what: 'An Australian shopper keeps the link: no Australian storefront, none bills AUD',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/dp/B0FQVHHBQV',
      market: AUSTRALIA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'unchanged', reason: 'no_storefront_for_market' },
    from: [ranRegionalUrl('AU/AUD', 'https://www.amazon.com/dp/B0FQVHHBQV', 'None')],
  },
  {
    id: 'gp-product-path-is-mapped',
    what: 'The /gp/product/ form of a listing link is mapped too',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/gp/product/B0FQVHHBQV',
      market: CANADA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.ca/dp/B0FQVHHBQV' },
    from: [
      ranRegionalUrl(
        'CA/CAD',
        'https://www.amazon.com/gp/product/B0FQVHHBQV',
        '"https://www.amazon.ca/dp/B0FQVHHBQV"',
      ),
    ],
  },
  {
    id: 'mobile-gp-aw-d-path-is-mapped',
    what: 'The mobile /gp/aw/d/ form of a listing link is mapped too',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/gp/aw/d/B0FQVHHBQV',
      market: CANADA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.ca/dp/B0FQVHHBQV' },
    from: [
      ranRegionalUrl(
        'CA/CAD',
        'https://www.amazon.com/gp/aw/d/B0FQVHHBQV',
        '"https://www.amazon.ca/dp/B0FQVHHBQV"',
      ),
    ],
  },
  {
    id: 'ref-path-and-query-are-dropped',
    what: "A British shopper's amazon.ca link with a ref path and query becomes a bare /dp/ link",
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.ca/dp/B0FQVHHBQV/ref=sr_1_1?keywords=x',
      market: BRITAIN,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.co.uk/dp/B0FQVHHBQV' },
    from: [
      ranRegionalUrl(
        'GB/GBP',
        'https://www.amazon.ca/dp/B0FQVHHBQV/ref=sr_1_1?keywords=x',
        '"https://www.amazon.co.uk/dp/B0FQVHHBQV"',
      ),
    ],
  },
  {
    id: 'canadian-link-moves-to-amazon-com-for-a-us-shopper',
    what: "The mapping runs both ways: a US shopper's amazon.ca link goes to amazon.com",
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.ca/dp/B0FQVHHBQV',
      market: USA,
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.com/dp/B0FQVHHBQV' },
    from: [
      ranRegionalUrl(
        'US/USD',
        'https://www.amazon.ca/dp/B0FQVHHBQV',
        '"https://www.amazon.com/dp/B0FQVHHBQV"',
      ),
    ],
  },
];
