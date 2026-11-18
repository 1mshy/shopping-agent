// Price text cases. Every expected amount is integer minor units, converted by hand from the
// predecessor's Decimal; the text as read stays in the input.
import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import type { PriceTextCase, PriceTextExpected, PriceTextRefusalCode } from '../contract.ts';

const MONEY_PY = 'pricewatch/src/pricewatch/money.py';
const TEST_MONEY = 'pricewatch/tests/test_money.py';
const EXTRACT_PY = 'pricewatch/src/pricewatch/extract.py';
const TEST_DISPLAYED = 'pricewatch/tests/test_displayed_price.py';

const price = (amountMinor: number, currency: MinorUnitCurrency): PriceTextExpected => ({
  ok: true,
  money: { amountMinor, currency },
});
const refused = (code: PriceTextRefusalCode): PriceTextExpected => ({ ok: false, code });

const ranParsePrice = (text: string, result: string) =>
  ({
    file: MONEY_PY,
    at: 'parse_price (lines 24-64)',
    how: 'running the function offline',
    note: `parse_price(${JSON.stringify(text)}) returned ${result}`,
  }) as const;

export const cases: readonly PriceTextCase[] = [
  // Separators
  {
    id: 'comma-thousands-dot-decimal',
    what: 'US layout: comma thousands, dot decimal, leading dollar sign',
    input: { text: '$1,234.56', currency: 'USD' },
    expected: price(123456, 'USD'),
    from: [{ file: TEST_MONEY, at: 'test_us_format', how: 'test assertion' }],
  },
  {
    id: 'dot-thousands-comma-decimal',
    what: 'European layout: dot thousands, comma decimal, euro sign after',
    input: { text: '1.234,56 €', currency: 'EUR' },
    expected: price(123456, 'EUR'),
    from: [{ file: TEST_MONEY, at: 'test_eu_format', how: 'test assertion' }],
  },
  {
    id: 'space-thousands-comma-decimal',
    what: 'A space as thousands separator with a decimal comma',
    input: { text: '1 299,95', currency: 'CAD' },
    expected: price(129995, 'CAD'),
    from: [{ file: TEST_MONEY, at: 'test_space_thousands', how: 'test assertion' }],
  },
  {
    id: 'comma-with-three-digit-tail-is-thousands',
    what: 'One comma followed by three digits groups thousands',
    input: { text: '1,299', currency: 'USD' },
    expected: price(129900, 'USD'),
    from: [{ file: TEST_MONEY, at: 'test_bare_comma_thousands_vs_decimal', how: 'test assertion' }],
  },
  {
    id: 'comma-with-two-digit-tail-is-decimal',
    what: 'One comma followed by two digits is a decimal comma',
    input: { text: '12,99', currency: 'EUR' },
    expected: price(1299, 'EUR'),
    from: [{ file: TEST_MONEY, at: 'test_bare_comma_thousands_vs_decimal', how: 'test assertion' }],
  },
  {
    id: 'several-commas-are-thousands',
    what: 'Several commas are thousands groups, never cents',
    input: { text: '1,299,000', currency: 'USD' },
    expected: price(129900000, 'USD'),
    from: [
      ranParsePrice('1,299,000', "Decimal('1299000')"),
      { file: MONEY_PY, at: 'parse_price comment, lines 52-54', how: 'reading the function' },
    ],
  },
  {
    id: 'several-dots-are-thousands',
    what: 'Several dots are European thousands groups',
    input: { text: '1.234.567', currency: 'EUR' },
    expected: price(123456700, 'EUR'),
    from: [ranParsePrice('1.234.567', "Decimal('1234567')")],
  },
  {
    id: 'no-break-spaces',
    what: 'No-break spaces as thousands separator and before the mark (Quebec layout)',
    input: { text: '1 299,99 $', currency: 'CAD' },
    expected: price(129999, 'CAD'),
    from: [
      ranParsePrice('1 299,99 $', "Decimal('1299.99')"),
      { file: MONEY_PY, at: 'parse_price line 39', how: 'reading the function' },
    ],
  },
  {
    id: 'narrow-no-break-space',
    what: 'A narrow no-break space (U+202F) as thousands separator (French layout)',
    input: { text: '1 299,99 €', currency: 'EUR' },
    expected: price(129999, 'EUR'),
    from: [ranParsePrice('1 299,99 €', "Decimal('1299.99')")],
  },
  {
    id: 'apostrophe-thousands',
    what: 'An apostrophe as thousands separator (Swiss layout) with the code after',
    input: { text: "1'299.95 CHF", currency: 'CHF' },
    expected: price(129995, 'CHF'),
    from: [ranParsePrice("1'299.95 CHF", "Decimal('1299.95')")],
  },
  {
    id: 'split-price-pieces-with-spaces',
    what: 'A split buy-box price joined with spaces between its pieces',
    input: { text: '$ 99 . 97', currency: 'USD' },
    expected: price(9997, 'USD'),
    from: [
      ranParsePrice('$ 99 . 97', "Decimal('99.97')"),
      {
        file: 'reports/2026-10-18-pre-explorer-fixes.md',
        at: 'section 1, line 356: split layouts `$ 99` `.` `97`',
        how: 'reading the function',
        note: "the report lists the layout; the joined text is this case's choice",
      },
    ],
  },
  // Currency marks around the figure
  {
    id: 'qualified-dollar-prefix',
    what: 'A qualified dollar sign glued to the figure',
    input: { text: 'C$142', currency: 'CAD' },
    expected: price(14200, 'CAD'),
    from: [{ file: TEST_MONEY, at: 'test_currency_prefixes', how: 'test assertion' }],
  },
  {
    id: 'qualified-dollar-prefix-with-space',
    what: 'A qualified dollar sign, a space, then the figure',
    input: { text: 'US$ 49.99', currency: 'USD' },
    expected: price(4999, 'USD'),
    from: [{ file: TEST_MONEY, at: 'test_currency_prefixes', how: 'test assertion' }],
  },
  {
    id: 'iso-code-prefix',
    what: 'An ISO code before the figure',
    input: { text: 'CAD 138.73', currency: 'CAD' },
    expected: price(13873, 'CAD'),
    from: [{ file: TEST_MONEY, at: 'test_currency_prefixes', how: 'test assertion' }],
  },
  {
    id: 'mark-after-with-space-thousands',
    what: 'Space thousands, decimal comma and the dollar sign after the figure',
    input: { text: '1 299,99 $', currency: 'CAD' },
    expected: price(129999, 'CAD'),
    from: [
      {
        file: TEST_DISPLAYED,
        at: 'test_one_price_in_the_products_own_area_is_displayed, third parameter',
        how: 'test assertion',
      },
    ],
  },
  // Exponents other than 2, and machine decimals
  {
    id: 'zero-exponent-currency',
    what: 'A yen price: comma thousands, no minor unit',
    input: { text: '¥1,299', currency: 'JPY' },
    expected: price(1299, 'JPY'),
    from: [ranParsePrice('¥1,299', "Decimal('1299')")],
  },
  {
    id: 'three-decimal-currency',
    what: 'A single dot with three digits after it is the decimal point of a 3-decimal currency',
    input: { text: 'KWD 12.345', currency: 'KWD' },
    expected: price(12345, 'KWD'),
    from: [
      ranParsePrice('KWD 12.345', "Decimal('12.345')"),
      { file: 'packages/shared/src/currency-table.ts', at: 'KWD exponent 3', how: 'spec' },
    ],
  },
  {
    id: 'json-number-text-with-decimals',
    what: 'A JSON number read as its source text, never through a float',
    input: { text: '49.99', currency: 'USD' },
    expected: price(4999, 'USD'),
    from: [
      {
        file: TEST_MONEY,
        at: 'test_numeric_inputs (parse_price(49.99))',
        how: 'test assertion',
        note: 'the predecessor took a Python float; the text form is the same figure',
      },
    ],
  },
  {
    id: 'json-number-text-integer',
    what: 'A whole-number JSON price read as its source text',
    input: { text: '119', currency: 'USD' },
    expected: price(11900, 'USD'),
    from: [
      { file: TEST_MONEY, at: 'test_numeric_inputs (parse_price(119))', how: 'test assertion' },
    ],
  },
  {
    id: 'zero-padding-beyond-exponent',
    what: 'Zero padding beyond the exponent loses nothing and is accepted',
    input: { text: '1299.00', currency: 'JPY' },
    expected: price(1299, 'JPY'),
    from: [
      ranParsePrice('1299.00', "Decimal('1299.00')"),
      { file: 'packages/core/src/money.ts', at: 'moneyFromDecimal', how: 'spec' },
    ],
  },
  // No price at all
  {
    id: 'words-without-a-figure',
    what: 'Text with no figure is no price',
    input: { text: 'free shipping', currency: 'USD' },
    expected: refused('no_amount'),
    from: [{ file: TEST_MONEY, at: 'test_garbage_and_zero', how: 'test assertion' }],
  },
  {
    id: 'empty-text',
    what: 'Empty text is no price',
    input: { text: '', currency: 'USD' },
    expected: refused('no_amount'),
    from: [{ file: TEST_MONEY, at: 'test_garbage_and_zero', how: 'test assertion' }],
  },
  {
    id: 'free-is-not-zero',
    what: '"Free" is no figure, not a zero price',
    input: { text: 'Free', currency: 'USD' },
    expected: refused('no_amount'),
    from: [ranParsePrice('Free', 'None')],
  },
  {
    id: 'zero-figure',
    what: 'A zero is never a price',
    input: { text: '0', currency: 'USD' },
    expected: refused('zero'),
    from: [
      {
        file: TEST_MONEY,
        at: 'test_garbage_and_zero (parse_price(0) is None)',
        how: 'test assertion',
      },
    ],
    specSilent: true,
  },
  {
    id: 'zero-with-mark-and-cents',
    what: 'A zero written as money is still no price',
    input: { text: '$0.00', currency: 'USD' },
    expected: refused('zero'),
    from: [ranParsePrice('$0.00', 'None')],
    specSilent: true,
  },
  // Precision: never rounded
  {
    id: 'float-noise-is-refused-not-trimmed',
    what: 'Binary-float noise in a JSON-LD price is more precision than USD has',
    input: { text: '99.30000000000001', currency: 'USD' },
    expected: refused('excess_precision'),
    from: [
      { file: TEST_MONEY, at: 'test_float_noise_is_trimmed_from_prices', how: 'test assertion' },
      { file: MONEY_PY, at: '_trim (lines 67-72)', how: 'reading the function' },
    ],
    divergence:
      'The predecessor quantized it to 99.3000 and kept 99.3 (money._trim, a Canadian Tire JSON-LD price). S§2.2 and the core money rule (progress, workstream 2a) refuse a non-zero digit beyond the exponent and never round, so the observation keeps the text and no amount.',
  },
  {
    id: 'sub-cent-price-is-refused',
    what: 'A price below one cent cannot be integer cents',
    input: { text: '0.0042', currency: 'USD' },
    expected: refused('excess_precision'),
    from: [
      { file: TEST_MONEY, at: 'test_float_noise_is_trimmed_from_prices', how: 'test assertion' },
    ],
    divergence:
      'The predecessor kept Decimal("0.0042") (sub-cent unit prices such as DigiKey\'s 0.0962 USD). S§2.2 stores integer minor units only, so the figure is refused and kept as text.',
  },
  {
    id: 'half-yen-is-refused',
    what: 'A fraction of a yen is more precision than JPY has',
    input: { text: '1299.5', currency: 'JPY' },
    expected: refused('excess_precision'),
    from: [
      ranParsePrice('1299.5', "Decimal('1299.5')"),
      { file: 'packages/core/src/money.ts', at: 'moneyFromDecimal', how: 'spec' },
    ],
    divergence:
      'The predecessor returned Decimal("1299.5") whatever the currency (it had no minor-unit table). S§2.2 refuses a non-zero digit beyond the exponent.',
  },
  {
    id: 'single-dot-with-three-digit-tail',
    what: 'A single dot is read as the decimal point, so "1.299 €" has too many cents for EUR',
    input: { text: '1.299 €', currency: 'EUR' },
    expected: refused('excess_precision'),
    from: [ranParsePrice('1.299 €', "Decimal('1.299')")],
    divergence:
      'The predecessor returned Decimal("1.299") and would have stored a 1.30-euro price for what a German page means as 1,299 euros. With the exponent applied the reading is refused rather than rounded. Open question for the owner: whether a dot followed by exactly three digits should be read as thousands in a 2-decimal currency.',
  },
  // More than one figure
  {
    id: 'two-figures-are-not-one-price',
    what: 'Two prices in one text: neither is taken',
    input: { text: '$219.99 $199.99', currency: 'USD' },
    expected: refused('several_amounts'),
    from: [
      ranParsePrice('$219.99 $199.99', "Decimal('219.99')"),
      {
        file: TEST_DISPLAYED,
        at: 'test_anything_ambiguous_displays_nothing ("two figures")',
        how: 'test assertion',
      },
    ],
    divergence:
      "money.parse_price took the first figure (219.99). S§5.2: more than one distinct price is multiple_prices, not a guess; the predecessor's own displayed-price reader also refused two figures.",
  },
  {
    id: 'range-is-not-a-price',
    what: "A price range is not one variant's price",
    input: { text: '$10.00 - $20.00', currency: 'USD' },
    expected: refused('range'),
    from: [ranParsePrice('$10.00 - $20.00', "Decimal('10.00')")],
    divergence:
      "money.parse_price returned the low end (10.00), and extract read an AggregateOffer's lowPrice the same way. S§5.2 variant coupling: a range is never attached to a variant.",
  },
  {
    id: 'from-price-is-a-lower-bound',
    what: '"From" names a floor over options, not this listing\'s price',
    input: { text: 'From $49.99', currency: 'USD' },
    expected: refused('lower_bound'),
    from: [
      ranParsePrice('From $49.99', "Decimal('49.99')"),
      {
        file: EXTRACT_PY,
        at: '_OTHER_MONEY (lines 446-458: "from|starting|as low as")',
        how: 'reading the function',
      },
    ],
    divergence:
      'money.parse_price returned 49.99; only the displayed-price reader set "from" money aside. S§5.2 variant coupling: the cheapest option is never attached to the requested variant.',
  },
  {
    id: 'price-per-measure',
    what: "A price per 100 g is a unit price, not the item's",
    input: { text: '$1.25 /100 g', currency: 'CAD' },
    expected: refused('per_measure'),
    from: [
      ranParsePrice('$1.25 /100 g', "Decimal('1.25')"),
      {
        file: TEST_DISPLAYED,
        at: 'test_anything_ambiguous_displays_nothing ("per measure")',
        how: 'test assertion',
      },
      { file: EXTRACT_PY, at: '_PER_MEASURE (lines 490-493)', how: 'reading the function' },
    ],
    divergence:
      'money.parse_price returned 1.25; the displayed-price reader refused it. S§4.1 keeps a unit price in unit_price with its unit, never as the sticker.',
  },
  // A mark that disagrees with the resolved currency
  {
    id: 'qualified-mark-names-another-currency',
    what: 'A "US$" figure is not read as Canadian dollars',
    input: { text: 'US$ 49.99', currency: 'CAD' },
    expected: refused('mark_mismatch'),
    from: [
      {
        file: 'pricewatch/src/pricewatch/recipes.py',
        at: 'find_price.located, lines 528-534 (currency_mismatch)',
        how: 'reading the function',
        note: 'the page names its money beside the figure; another currency is refused',
      },
    ],
  },
  {
    id: 'bare-dollar-is-no-euro',
    what: 'A bare "$" is a dollar, never a euro',
    input: { text: '$12', currency: 'EUR' },
    expected: refused('mark_mismatch'),
    from: [
      {
        file: EXTRACT_PY,
        at: '_other_money (lines 1732-1747)',
        how: 'running the function offline',
        note: '_other_money("$", "EUR", "shop.com") returned "dollars (a bare \'$\')"',
      },
    ],
  },
];
