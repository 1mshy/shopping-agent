// Financing cases: each text is a payment figure the predecessor met, and each must be refused
// as `instalment`; beside them, the real price on the same page must still read.
import type { PriceTextCase } from '../contract.ts';

const MONEY_PY = 'pricewatch/src/pricewatch/money.py';
const EXTRACT_PY = 'pricewatch/src/pricewatch/extract.py';
const PAYMENT_WORDS = {
  file: EXTRACT_PY,
  at: '_OTHER_MONEY and _NOT_A_UNITS_PRICE (lines 446-470: "per month|monthly|mo|month|bi-weekly|financ*|installments?|payments?|mois")',
  how: 'reading the function',
} as const;
const ranParsePrice = (text: string, result: string) =>
  ({
    file: MONEY_PY,
    at: 'parse_price (lines 24-64)',
    how: 'running the function offline',
    note: `parse_price(${JSON.stringify(text)}) returned ${result}`,
  }) as const;
const PARSER_TOOK_IT =
  "money.parse_price returned the payment as an amount; only the displayed-price reader (by its label words) or an adapter (by waiting for the product price selector) kept it out. Here the reader refuses it, which S§2.1 and S§5.2 need: a figure the engine stores must be the listing's price.";

export const cases: readonly PriceTextCase[] = [
  {
    id: 'target-monthly-payment-beside-the-price',
    what: 'Target renders "$24/mo" before the product price: a payment, not the price',
    input: { text: '$24/mo', currency: 'USD' },
    expected: { ok: false, code: 'instalment' },
    from: [
      {
        file: 'pricewatch/tests/test_retail_reliability.py',
        at: 'test_target_waits_for_product_price_ignoring_installments',
        how: 'test assertion',
        note: 'the read must be 199.99, not the "$24/mo" figure on the same page',
      },
      ranParsePrice('$24/mo', "Decimal('24')"),
      PAYMENT_WORDS,
    ],
    divergence: PARSER_TOOK_IT,
  },
  {
    id: 'target-product-price-still-reads',
    what: 'The product price on the same Target page is read normally',
    input: { text: '$199.99', currency: 'USD' },
    expected: { ok: true, money: { amountMinor: 19999, currency: 'USD' } },
    from: [
      {
        file: 'pricewatch/tests/test_retail_reliability.py',
        at: 'test_target_waits_for_product_price_ignoring_installments',
        how: 'test assertion',
      },
    ],
  },
  {
    id: 'per-month-suffix',
    what: 'A TV page showing "$49.99/mo" shows a payment',
    input: { text: '$49.99/mo', currency: 'USD' },
    expected: { ok: false, code: 'instalment' },
    from: [
      {
        file: 'pricewatch/tests/test_displayed_price.py',
        at: 'test_anything_ambiguous_displays_nothing ("a payment")',
        how: 'test assertion',
      },
      ranParsePrice('$49.99/mo', "Decimal('49.99')"),
    ],
    divergence: PARSER_TOOK_IT,
  },
  {
    id: 'per-month-for-a-term',
    what: '"Or $120.00/mo for 12 months" names a payment over a term',
    input: { text: 'Or $120.00/mo for 12 months', currency: 'CAD' },
    expected: { ok: false, code: 'instalment' },
    from: [
      {
        file: 'pricewatch/tests/test_displayed_price.py',
        at: 'test_a_threshold_or_a_payment_confirms_nothing',
        how: 'test assertion',
        note: 'the banner confirms nothing: it is not the 120.00 price',
      },
      ranParsePrice('Or $120.00/mo for 12 months', "Decimal('120.00')"),
    ],
    divergence: PARSER_TOOK_IT,
  },
  {
    id: 'affirm-pay-over-time-block',
    what: 'An Affirm block: the figure after a pay-over-time blurb is a payment',
    input: {
      text: 'Pay in 4 interest-free payments, or as low as monthly with Affirm. Check your purchasing power in seconds without affecting your credit score. Learn more about financing options. $49.99',
      currency: 'USD',
    },
    expected: { ok: false, code: 'instalment' },
    from: [
      {
        file: 'pricewatch/tests/test_figures_offered.py',
        at: 'test_a_financing_block_too_long_to_read_is_no_price',
        how: 'test assertion',
        note: "the JSON-LD 120.00 stands; observing 49.99 is refused (observed_unconfirmed). The text is the block's visible text with the price element's figure, joined",
      },
      {
        file: 'reports/2026-10-18-pre-explorer-fixes.md',
        at: 'B1 (line 256) and round 5',
        how: 'reading the function',
        note: 'at a3b9f1f this layout read 49.99 as the displayed price',
      },
      PAYMENT_WORDS,
    ],
  },
  {
    id: 'four-payments-of',
    what: '"4 interest-free payments of $30.00" is a payment plan, not 4 and not 30',
    input: { text: '4 interest-free payments of $30.00', currency: 'USD' },
    expected: { ok: false, code: 'instalment' },
    from: [ranParsePrice('4 interest-free payments of $30.00', "Decimal('4')"), PAYMENT_WORDS],
    divergence: PARSER_TOOK_IT,
  },
  {
    id: 'bi-weekly-payment',
    what: 'A bi-weekly payment is a payment',
    input: { text: '$12.50 bi-weekly', currency: 'CAD' },
    expected: { ok: false, code: 'instalment' },
    from: [ranParsePrice('$12.50 bi-weekly', "Decimal('12.50')"), PAYMENT_WORDS],
    divergence: PARSER_TOOK_IT,
  },
  {
    id: 'french-per-month',
    what: 'A Quebec page\'s "49,99 $/mois" is a monthly payment',
    input: { text: '49,99 $/mois', currency: 'CAD' },
    expected: { ok: false, code: 'instalment' },
    from: [ranParsePrice('49,99 $/mois', "Decimal('49.99')"), PAYMENT_WORDS],
    divergence: PARSER_TOOK_IT,
  },
];
