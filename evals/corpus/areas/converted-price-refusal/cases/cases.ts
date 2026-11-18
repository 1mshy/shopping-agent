// Converted-figure cases. A converted figure is refused at currency resolution (`converted`), and a
// page that says two things about its money is refused too (`conflict`). The incidents themselves
// (the SUNLU and heater listings on amazon.com) are in `known-failure-converted-currency`.
import type { CurrencyCase } from '../contract.ts';
import { evidence } from '../contract.ts';

const BIGBOX_PY = 'pricewatch/src/pricewatch/stores/bigbox.py';
const RECIPES_PY = 'pricewatch/src/pricewatch/recipes.py';
const TEST_AMAZON = 'pricewatch/tests/test_amazon.py';
const ADAPTER_FLAGS_ONLY =
  "The predecessor's adapter returned the figure as a price in the shown currency, flagged extra.converted_from, and left the refusal to its callers (web_discovery.usable, recipes); S§5.2 refuses a converted-looking figure at currency resolution, so it never becomes an amount.";

export const cases: readonly CurrencyCase[] = [
  {
    id: 'qualified-dollar-against-the-declared-currency',
    what: 'amazon.com bills USD; a "CDN$" figure there is a conversion for a visitor abroad',
    input: evidence('amazon.com', { platform: 'USD', priceText: 'CDN$ 138.83' }),
    expected: { ok: false, code: 'converted' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_com_keeps_the_currency_it_actually_displayed (third assertion: currency CAD)',
        how: 'test assertion',
      },
      {
        file: BIGBOX_PY,
        at: 'AmazonAdapter._parse, lines 391-420 (currency != native → converted_from)',
        how: 'reading the function',
        note: 'native = currency_for_host("amazon.com") = USD; here it is the adapter row for amazon.com',
      },
    ],
    divergence: ADAPTER_FLAGS_ONLY,
  },
  {
    id: 'buy-box-state-names-another-currency',
    what: "amazon.com's buy-box state labels the selected amount CAD: converted",
    input: evidence('amazon.com', { platform: 'USD', priceText: 'CAD' }),
    expected: { ok: false, code: 'converted' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_buy_box_json_currency_symbol_is_read_on_com',
        how: 'test assertion',
        note: 'result currency CAD on amazon.com, whose native currency is USD',
      },
      {
        file: 'pricewatch/tests/test_retail_reliability.py',
        at: 'test_amazon_dom_amount_keeps_matching_converted_currency',
        how: 'test assertion',
      },
      {
        file: BIGBOX_PY,
        at: 'AmazonAdapter._parse, lines 365-376',
        how: 'reading the function',
        note: 'the price text becomes the state\'s currencySymbol ("CAD") when its priceAmount matches the buy box',
      },
    ],
    divergence: ADAPTER_FLAGS_ONLY,
  },
  {
    id: 'bare-dollar-on-a-regional-marketplace',
    what: 'amazon.ca bills CAD whatever symbol its markup uses: not converted',
    input: evidence('amazon.ca', { platform: 'CAD', priceText: '$167.73' }),
    expected: { ok: true, currency: 'CAD', source: 'platform' },
    from: [
      {
        file: TEST_AMAZON,
        at: 'test_regional_marketplaces_bill_in_their_own_currency_whatever_the_symbol',
        how: 'test assertion',
      },
      { file: BIGBOX_PY, at: '_TLD_CURRENCY (lines 28-33)', how: 'reading the function' },
    ],
  },
  {
    id: 'mark-agreeing-with-the-declared-currency',
    what: 'A figure written "$120.00 CAD" where the data declares CAD is not converted',
    input: evidence('shop.example.com', { priceCurrency: 'CAD', priceText: '$120.00 CAD' }),
    expected: { ok: true, currency: 'CAD', source: 'price_currency' },
    from: [
      {
        file: RECIPES_PY,
        at: 'find_price.located, lines 527-534',
        how: 'reading the function',
        note: 'an explicit mark equal to the currency is accepted and counts as named',
      },
    ],
  },
  {
    id: 'bare-dollar-on-a-ca-page-declaring-usd',
    what: 'A .ca page whose data says USD beside a bare "$" contradicts itself',
    input: evidence('outillage.ca', { priceCurrency: 'USD', priceText: '$219.99' }),
    expected: { ok: false, code: 'conflict' },
    from: [
      {
        file: 'pricewatch/tests/test_recipes.py',
        at: 'test_a_page_that_contradicts_itself_about_its_currency_is_refused',
        how: 'test assertion',
        note: 'currency_conflict with store_currency CAD and data_currency USD',
      },
      { file: RECIPES_PY, at: '_refuse_conflict (lines 671-685)', how: 'reading the function' },
    ],
    specSilent: true,
  },
  {
    id: 'bare-dollar-on-a-com-declaring-usd',
    what: 'A .com names no market, so its bare "$" does not contradict a USD declaration',
    input: evidence('shop.example.com', { priceCurrency: 'USD', priceText: '$120.00' }),
    expected: { ok: true, currency: 'USD', source: 'price_currency' },
    from: [
      {
        file: RECIPES_PY,
        at: '_refuse_conflict, lines 676-678 (only a host that names a market)',
        how: 'reading the function',
      },
    ],
    specSilent: true,
  },
];
