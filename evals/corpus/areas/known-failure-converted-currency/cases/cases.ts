// The converted-currency incidents, as recorded. amazon.com's billing currency (USD) is what the
// Amazon adapter's storefront row states; the predecessor took it from the host
// (money.currency_for_host("amazon.com") = "USD", stores/bigbox.py line 392).
import { type ConvertedCurrencyCase, evidence, type Storefronts } from '../contract.ts';

const TEST_AMAZON = 'pricewatch/tests/test_amazon.py';
const TEST_WEB = 'pricewatch/tests/test_web_discovery.py';
const REPORT = 'reports/2026-10-14-web-discovery.md';
const AMAZON: Storefronts = [
  { host: 'amazon.com', country: 'US', currency: 'USD' },
  { host: 'amazon.ca', country: 'CA', currency: 'CAD' },
  { host: 'amazon.co.uk', country: 'GB', currency: 'GBP' },
  { host: 'amazon.de', country: 'DE', currency: 'EUR' },
];
const ADAPTER_FLAGS_ONLY =
  'The predecessor\'s adapter returned the figure in the shown currency with extra.converted_from = "USD" and left the refusal to its callers (web discovery reported it unreadable, reason "converted"); S§5.2 refuses a converted-looking figure at currency resolution, so it never becomes an amount.';

export const cases: readonly ConvertedCurrencyCase[] = [
  {
    id: 'sunlu-amazon-com-link-is-read-on-amazon-ca',
    what: 'The amazon.com SUNLU link web search found is read on amazon.ca for a Canadian shopper',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/SUNLU-PLA-Plus-Filament-Printer/dp/B0DPM2HL5V?th=1',
      market: { country: 'CA', currency: 'CAD' },
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'rewritten', url: 'https://www.amazon.ca/dp/B0DPM2HL5V' },
    from: [
      { file: TEST_WEB, at: 'test_an_amazon_com_link_is_read_on_amazon_ca', how: 'test assertion' },
      {
        file: TEST_WEB,
        at: 'test_an_amazon_com_listing_never_joins_a_cad_watch',
        how: 'test assertion',
      },
      {
        file: REPORT,
        at: 'Code changes after the run, item 6 (lines 289-303)',
        how: 'reading the function',
      },
    ],
  },
  {
    id: 'sunlu-amazon-com-cad-17-45-is-refused',
    what: 'The amazon.com SUNLU read at "CAD 17.45" is a conversion, never a price',
    subject: 'resolveCurrency',
    input: evidence('amazon.com', { platform: 'USD', priceText: 'CAD 17.45' }),
    expected: { ok: false, code: 'converted' },
    from: [
      { file: REPORT, at: 'lines 135-142 and 296-303', how: 'reading the function' },
      {
        file: TEST_WEB,
        at: 'test_an_amazon_com_listing_never_joins_a_cad_watch',
        how: 'test assertion',
        note: 'the 17.45 figure (converted_from USD) never becomes an offer or a baseline',
      },
    ],
    divergence: ADAPTER_FLAGS_ONLY,
  },
  {
    id: 'heater-amazon-com-cad-138-83-is-refused',
    what: 'The heater on amazon.com read as "CAD 138.83" from Canada: refused as converted',
    subject: 'resolveCurrency',
    input: evidence('amazon.com', { platform: 'USD', priceText: 'CAD 138.83' }),
    expected: { ok: false, code: 'converted' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_com_keeps_the_currency_it_actually_displayed',
        how: 'test assertion',
        note: 'converted.extra["converted_from"] == "USD"',
      },
    ],
    divergence: ADAPTER_FLAGS_ONLY,
  },
  {
    id: 'heater-amazon-com-99-99-is-usd',
    what: 'The next read of the same listing shows "$99.99": US dollars, not a drop from CAD 138.83',
    subject: 'resolveCurrency',
    input: evidence('amazon.com', { platform: 'USD', priceText: '$99.99' }),
    expected: { ok: true, currency: 'USD', source: 'platform' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_com_keeps_the_currency_it_actually_displayed',
        how: 'test assertion',
        note: '(plain.price, plain.currency) == (99.99, "USD") with no converted_from',
      },
    ],
  },
  {
    id: 'french-shopper-keeps-the-amazon-com-link',
    what: 'No storefront sells to France: the amazon.com link stays, and its converted figure is refused',
    subject: 'regionalListingUrl',
    input: {
      url: 'https://www.amazon.com/SUNLU-PLA-Plus-Filament-Printer/dp/B0DPM2HL5V?th=1',
      market: { country: 'FR', currency: 'EUR' },
      storefronts: AMAZON,
      listingId: 'amazon_asin',
    },
    expected: { kind: 'unchanged', reason: 'no_storefront_for_market' },
    from: [
      {
        file: TEST_WEB,
        at: 'test_a_converted_figure_is_never_a_verified_price',
        how: 'test assertion',
        note: 'web_discovery.regional_url(COM) is None; the read is reported unreadable, reason "converted"',
      },
    ],
  },
];
