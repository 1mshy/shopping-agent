// Coupon cases. The texts are the visible text of the predecessor's fixture
// (tests/fixtures/amazon_pdp_coupon.html, a hand-built amazon.ca page) with each test's label
// swapped in, one copy of the coupon widget. Amounts are integer minor units converted by hand
// from the predecessor's Decimals.
import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import type { CouponCase, CouponReading } from '../contract.ts';

const BIGBOX_PY = 'pricewatch/src/pricewatch/stores/bigbox.py';
const TEST_AMAZON = 'pricewatch/tests/test_amazon.py';

const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });
const STICKER = cad(16773);
const money = (amountMinor: number, currency: MinorUnitCurrency): Money => ({
  amountMinor,
  currency,
});
const NONE: CouponReading = { kind: 'none' };

const ranCoupon = (text: string, price: string, result: string) =>
  ({
    file: BIGBOX_PY,
    at: 'coupon_in_text (lines 122-168)',
    how: 'running the function offline',
    note: `coupon_in_text(${JSON.stringify(text)}, Decimal("${price}")) returned ${result}`,
  }) as const;
const fromTest = (at: string, note?: string) =>
  ({ file: TEST_AMAZON, at, how: 'test assertion', ...(note ? { note } : {}) }) as const;

export const cases: readonly CouponCase[] = [
  {
    id: 'sunlu-heater-clip-coupon',
    what: 'The missed incident: CA$167.73 sticker with an "Apply $117.74 coupon" clip coupon',
    input: { sticker: STICKER, text: 'Coupon: Apply $117.74 coupon Terms' },
    expected: { kind: 'amount_off', amountOff: cad(11774), effective: cad(4999) },
    from: [
      fromTest(
        'test_clip_coupon_is_taken_off_the_sticker_price',
        'price 49.99, sticker 167.73, coupon "117.74 off"',
      ),
      {
        file: BIGBOX_PY,
        at: 'comment, lines 60-63 (the 2026-09-02 incident)',
        how: 'reading the function',
      },
      ranCoupon(
        'Coupon: Apply $117.74 coupon Terms',
        '167.73',
        "{'amount': '117.74', 'effective': Decimal('49.99')}",
      ),
    ],
    divergence:
      'The predecessor replaced the tracked price with the price after the coupon and kept the sticker in extra.sticker_price (AmazonAdapter._parse, lines 406-411). S§4.1 keeps the sticker as the sticker, the coupon as an amount off, and derives the effective price in code.',
  },
  {
    id: 'percentage-coupon',
    what: 'A 20% coupon comes off the sticker, rounded to the cent',
    input: { sticker: STICKER, text: 'Coupon: Save 20% with coupon Terms' },
    expected: {
      kind: 'percent_off',
      basisPoints: 2000,
      amountOff: cad(3355),
      effective: cad(13418),
    },
    from: [
      fromTest('test_percent_coupon_is_applied', 'price 134.18: "167.73 × 0.8, rounded"'),
      ranCoupon(
        'Coupon: Save 20% with coupon Terms',
        '167.73',
        "{'percent': 20.0, 'effective': Decimal('134.18')}",
      ),
    ],
    specSilent: true,
  },
  {
    id: 'percentage-rounds-half-up',
    what: '10% of $10.05 leaves $9.045, which rounds half up to $9.05',
    input: { sticker: money(1005, 'USD'), text: 'Coupon: Save 10% with coupon Terms' },
    expected: {
      kind: 'percent_off',
      basisPoints: 1000,
      amountOff: money(100, 'USD'),
      effective: money(905, 'USD'),
    },
    from: [
      ranCoupon(
        'Coupon: Save 10% with coupon Terms',
        '10.05',
        "{'percent': 10.0, 'effective': Decimal('9.05')}",
      ),
      {
        file: BIGBOX_PY,
        at: 'coupon_in_text, line 164 (ROUND_HALF_UP)',
        how: 'reading the function',
      },
    ],
    specSilent: true,
  },
  {
    id: 'percentage-with-a-decimal',
    what: 'A 12.5% coupon is 1250 basis points',
    input: { sticker: STICKER, text: 'Coupon: Save 12.5% with coupon Terms' },
    expected: {
      kind: 'percent_off',
      basisPoints: 1250,
      amountOff: cad(2097),
      effective: cad(14676),
    },
    from: [
      ranCoupon(
        'Coupon: Save 12.5% with coupon Terms',
        '167.73',
        "{'percent': 12.5, 'effective': Decimal('146.76')}",
      ),
    ],
    specSilent: true,
  },
  {
    id: 'nearest-figure-to-the-word-coupon-wins',
    what: '"Save 5% with Subscribe & Save" after the coupon does not displace it',
    input: {
      sticker: STICKER,
      text: 'Coupon: Apply $117.74 coupon Save 5% with Subscribe & Save Terms',
    },
    expected: { kind: 'amount_off', amountOff: cad(11774), effective: cad(4999) },
    from: [
      fromTest('test_the_figure_nearest_the_word_coupon_wins', 'price 49.99'),
      ranCoupon(
        'Coupon: Apply $117.74 coupon Save 5% with Subscribe & Save Terms',
        '167.73',
        'None',
      ),
    ],
    divergence:
      'Predecessor test and predecessor function disagree on this text. The test passes only because _region_text joins overlapping widget regions, repeating the label so that a copy of "$117.74" sits more than 40 characters before "Subscribe" (run offline on the fixture: 49.99). On the widget\'s text read once, coupon_in_text drops the $117.74 figure because "Subscribe" falls inside its 40-character look-ahead (line 142) and returns None. The case follows the test\'s stated intent: the subscription words belong to the 5%, not to the coupon.',
  },
  {
    id: 'subscribe-and-save-is-not-a-coupon',
    what: 'A coupon badge beside "Save 5% with Subscribe & Save" offers no coupon',
    input: { sticker: STICKER, text: 'Coupon: Save 5% with Subscribe & Save Terms' },
    expected: NONE,
    from: [
      fromTest('test_subscribe_and_save_beside_a_bare_coupon_badge_is_not_a_coupon'),
      ranCoupon('Coupon: Save 5% with Subscribe & Save Terms', '167.73', 'None'),
    ],
  },
  {
    id: 'promotion-without-a-coupon',
    what: 'A promotion widget with no coupon figure in it',
    input: {
      sticker: STICKER,
      text: 'Coupon: Offer 90 days free of Amazon Music with purchase Terms Terms',
    },
    expected: NONE,
    from: [
      fromTest(
        'test_a_promotion_without_a_coupon_is_ignored',
        'real text from an amazon.ca listing',
      ),
      ranCoupon(
        'Coupon: Offer 90 days free of Amazon Music with purchase Terms Terms',
        '167.73',
        'None',
      ),
    ],
  },
  {
    id: 'coupon-badge-without-a-figure',
    what: 'A bare "Coupon:" badge with no figure; the page bundle\'s strings are not visible text',
    input: { sticker: STICKER, text: 'Coupon: Terms' },
    expected: NONE,
    from: [
      fromTest(
        'test_page_bundle_strings_are_not_a_coupon',
        'the a-state script declaring "{number} off coupon" is dropped by _region_text before this text exists',
      ),
      ranCoupon('Coupon: Terms', '167.73', 'None'),
    ],
  },
  {
    id: 'coupon-larger-than-the-sticker',
    what: 'A $200 coupon on a $167.73 item is a misread, not a free product',
    input: { sticker: STICKER, text: 'Coupon: Apply $200 coupon Terms' },
    expected: NONE,
    from: [
      fromTest('test_a_coupon_larger_than_the_price_is_a_misread'),
      ranCoupon('Coupon: Apply $200 coupon Terms', '167.73', 'None'),
    ],
  },
  {
    id: 'coupon-equal-to-the-sticker',
    what: 'A coupon equal to the sticker is a misread too',
    input: { sticker: STICKER, text: 'Coupon: Apply $167.73 coupon Terms' },
    expected: NONE,
    from: [ranCoupon('Coupon: Apply $167.73 coupon Terms', '167.73', 'None')],
  },
  {
    id: 'hundred-percent-is-a-misread',
    what: 'A 100% coupon is outside (0, 100) and ignored',
    input: { sticker: STICKER, text: 'Coupon: Save 100% with coupon Terms' },
    expected: NONE,
    from: [ranCoupon('Coupon: Save 100% with coupon Terms', '167.73', 'None')],
  },
  {
    id: 'search-card-coupon-beside-the-sticker',
    what: 'On a search card the sticker sits near the word coupon too; the $117.74 is the coupon',
    input: { sticker: STICKER, text: '$167.73 Save $117.74 with coupon' },
    expected: { kind: 'amount_off', amountOff: cad(11774), effective: cad(4999) },
    from: [
      fromTest(
        'test_search_card_coupon_is_flagged_but_the_sticker_is_kept',
        'coupon "117.74 off", checkout about 49.99, card price stays 167.73',
      ),
      ranCoupon(
        '$167.73 Save $117.74 with coupon',
        '167.73',
        "{'amount': '117.74', 'effective': Decimal('49.99')}",
      ),
    ],
  },
  {
    id: 'french-amount-after-the-figure',
    what: 'A Canadian French coupon writes the dollar sign after the amount',
    input: { sticker: STICKER, text: 'Coupon : Appliquer un coupon de 40 $ Conditions' },
    expected: { kind: 'amount_off', amountOff: cad(4000), effective: cad(12773) },
    from: [
      ranCoupon(
        'Coupon : Appliquer un coupon de 40 $ Conditions',
        '167.73',
        "{'amount': '40', 'effective': Decimal('127.73')}",
      ),
      {
        file: BIGBOX_PY,
        at: 'comment, lines 74-76 (French "coupon de 40 $")',
        how: 'reading the function',
      },
    ],
  },
  {
    id: 'saving-without-the-word-coupon',
    what: 'A saving with no word "coupon" near it is not a coupon',
    input: { sticker: STICKER, text: 'Save $40 today' },
    expected: NONE,
    from: [ranCoupon('Save $40 today', '167.73', 'None')],
  },
];
