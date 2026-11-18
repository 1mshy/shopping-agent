// Listings the predecessor accepted as the product (a score at or over the compare floor of 65, a
// rank kept, or a title check passed). Each is the nearest accept of a reject rule: a "for" that
// is a purpose, a part the product comes with, a feature list, another store's naming. Where the
// predecessor's own words call the listing a variant or a bundle, the case follows S§5.4 and says
// so in `divergence`.
import { asked, listing, type MatchCase } from '../contract.ts';
import { REVIEW_RULE, review, run, S54_JUDGE, S54_RULES, test } from '../evidence.ts';

const ITSELF = 'test_the_product_itself_is_not_an_accessory';
const RENAMED = 'test_the_product_under_another_stores_name_still_matches';

const ACCEPTED =
  'the predecessor accepts it as the product (asserted: score at or over 65, the compare and ' +
  'discover floor); the title names the asked model, so the match rests on positive evidence';

function itself(
  id: string,
  what: string,
  query: string,
  title: string,
  more: Partial<MatchCase> = {},
): MatchCase {
  return {
    id,
    what,
    input: { asked: asked(query), listing: listing(title) },
    expected: { relation: 'exact' },
    from: [test('test_matching.py', ITSELF, `[${query}]`), S54_RULES],
    label: `not an accessory (accessory_for is false, asserted); ${ACCEPTED}`,
    ...more,
  };
}

function renamed(
  id: string,
  what: string,
  query: string,
  title: string,
  more: Partial<MatchCase> = {},
): MatchCase {
  return {
    id,
    what,
    input: { asked: asked(query), listing: listing(title) },
    expected: { relation: 'exact' },
    from: [test('test_matching.py', RENAMED, `[${query}]`), S54_RULES],
    label: ACCEPTED,
    ...more,
  };
}

const CONFIGURATION =
  'The title carries a configuration word the query does not name; the predecessor accepts it ' +
  '(asserted), and S§5.4 says a missing attribute is not a conflict. Confirm exact, or say it is ' +
  'a variant ("variants in configuration are not matches").';

export const theProduct: readonly MatchCase[] = [
  itself(
    'for-is-a-purpose-model-in-brackets',
    '"for Air Frying" is a purpose; the model appears only in brackets later in the title',
    'Ninja AF101 Air Fryer',
    'Air Fryer, 1550-Watt Programmable Base for Air Frying, Roasting, Reheating & Dehydrating ' +
      'with 4-Quart Ceramic Coated Basket (AF101), Black/Gray',
  ),
  {
    id: 'for-business-edition-with-part-number',
    what: '"for Business" edition of the asked mouse, with its own part number',
    input: {
      asked: asked('Logitech MX Master 3S'),
      listing: listing('Logitech MX Master 3S for Business Wireless Rechargeable Mouse 910-006581'),
    },
    expected: { relation: 'variant' },
    from: [
      test('test_matching.py', ITSELF, '[Logitech MX Master 3S]'),
      test(
        'test_amazon.py',
        'test_a_product_variant_named_for_something_is_not_an_accessory',
        '(the test name calls the for-Business listing "a product variant")',
      ),
      S54_JUDGE,
    ],
    label:
      'the predecessor itself names the for-Business listing a product variant (test_amazon.py ' +
      'test name); S§5.4 says variants in configuration are not matches',
    divergence:
      'The predecessor accepted it as the product (score at or over 65; test_matching.py ' +
      'test_the_product_itself_is_not_an_accessory). S§5.4: a variant is not a match.',
    ownerCheck: 'Confirm that the for-Business edition is a variant of the MX Master 3S, not it.',
  },
  itself(
    'for-mac-edition',
    '"For Mac" after the model: a qualifier, not a product it fits',
    'Logitech MX Master 3S',
    'MX Master 3S For Mac',
    { ownerCheck: CONFIGURATION },
  ),
  itself(
    'for-plaque-control-is-a-purpose',
    '"For Plaque Control" is a purpose; the model is written "Protective Clean"',
    'Philips Sonicare ProtectiveClean 4100',
    'Philips Sonicare Protective Clean 4100 Rechargeable Electric Toothbrush For Plaque Control, ' +
      'White/Mint',
  ),
  itself(
    'with-heatsink-for-a-console',
    'an SSD "with Heatsink for PS5": the "for" names where it fits, not what it is',
    'WD Black SN850X 2TB',
    'WD SN850X 2TB Internal SSD PCIe Gen 4 x4 NVMe with Heatsink for PS5 & Desktops',
    { ownerCheck: CONFIGURATION },
  ),
  itself(
    'with-heatsink-compatible-with-a-console',
    'an SSD "with Heatsink", "Compatible with PlayStation®5", its own part number in brackets',
    'Samsung 990 Pro 2TB',
    'SAMSUNG SSD 990 PRO with Heatsink 2TB, PCIe 4.0, Sew. Read Speeds Up-to 7,450MB/s, ' +
      'Compatible with PlayStation®5 (MZ-V9P2T0CW)',
    { ownerCheck: CONFIGURATION },
  ),
  itself(
    'included-case-is-not-the-product',
    'the earbuds "with MagSafe Wireless Charging Case": a part it comes with',
    'Apple AirPods Pro 2',
    'Apple AirPods Pro 2nd Generation with MagSafe Wireless Charging Case (USB‑C)',
  ),
  itself(
    'one-brush-head-included',
    '"1 Brush Head": a count of what is in the box, not a part sold alone',
    'Philips Sonicare ProtectiveClean 4100',
    'Philips Sonicare 4100 Rechargeable Electric Toothbrush, 1 Brush Head, White',
  ),
  itself(
    'lcd-as-a-feature-12k',
    '"10-Inch 12K Mono LCD" in a printer\'s feature list',
    'Elegoo Saturn 4 Ultra',
    'Saturn 4 Ultra Resin 3D Printer, 10-Inch 12K Mono LCD, 150mm/h High Speed Printing, Smart ' +
      'Automatic Leveling, Intelligent Detection, WiFi-Transfer',
    {
      ownerCheck:
        'The predecessor accepted both a 12K and a 16K Saturn 4 Ultra for "Elegoo Saturn 4 ' +
        'Ultra" (see lcd-as-a-feature-16k). Confirm both are exact for a query that names ' +
        'neither, or say the resolution makes a variant.',
    },
  ),
  itself(
    'lcd-as-a-feature-16k',
    '"16K" and "Smart Tank Heating" as features of the printer',
    'Elegoo Saturn 4 Ultra',
    'Saturn 4 Ultra 16K Resin 3D Printer, Smart Tank Heating, 150mm/h',
    { ownerCheck: 'See lcd-as-a-feature-12k.' },
  ),
  {
    id: 'pitcher-plus-a-filter-pack',
    what: 'the pitcher "+" a separately sold pack of replacement filters',
    input: {
      asked: asked('Brita Large 10 Cup Water Filter Pitcher'),
      listing: listing(
        'Brita Large 10 Cup Water Filter Pitcher + BRITA Water Filter Pitcher Advanced ' +
          'Replacement Filters (1 Count)',
      ),
    },
    expected: { relation: 'bundle' },
    from: [
      test('test_matching.py', ITSELF, '[Brita Large 10 Cup Water Filter Pitcher]'),
      REVIEW_RULE,
      run('score = 100.0'),
      S54_JUDGE,
    ],
    label:
      'two products sold together, the pitcher and a filter pack: the review rule rejects a ' +
      'bundle as not the product, and MATCH_RELATIONS names it bundle',
    divergence:
      'The predecessor scores it as the product (asserted at or over 65; the run gives 100). ' +
      'The hand-review rule and S§5.4 (exact means one barcode) make the bundle not the product.',
  },
  itself(
    'grand-instead-of-large',
    'the store calls it "Grand" and puts the 10 Cup at the end',
    'Brita Large 10 Cup Water Filter Pitcher',
    'Brita® Grand Water Filter Pitcher with Standard Replacement Filter, BPA Free, 10 Cup, White',
  ),
  itself(
    'extruder-as-a-feature',
    '"All-Metal Extruder" at the end of a printer\'s feature list',
    'Creality K1C',
    'Creality K1C 3D Printer With AI Camera 600mm/s High Speed Printing Auto Leveling Carbon ' +
      'Fiber Filled All-Metal Extruder Printer',
  ),
  itself(
    'dash-before-a-feature-list',
    'a dash, then the feature list, ending in "Build Volume"',
    'Creality K1C',
    'Creality K1C Enclosed FDM 3D Printer - AI Camera, Auto Bed Leveling, 600mm/s, 45dB, ' +
      '300°C – 220 x 220 x 250mm Build Volume',
  ),
  itself(
    'nozzle-as-the-last-feature',
    '"Hardened Steel Nozzle" as the last feature of the printer',
    'Creality K1C',
    'Creality K1C 3D Printer, 600mm/s, Sprite Direct Extruder, Hardened Steel Nozzle',
  ),
  itself(
    'kit-with-battery-and-charger',
    'the drill kit "with 2Ah Battery & Charger", which is what the D1 kit is',
    'DEWALT DCD793D1',
    'DEWALT DCD793D1 20V MAX Brushless 1/2" Compact Drill Driver Kit with 2Ah Battery & Charger',
  ),
  {
    id: 'accessory-query-matches-the-accessory',
    what: 'a query that asks for an accessory still matches that accessory',
    input: {
      asked: asked('travel case for logitech mx master 3s'),
      listing: listing('Hard Travel Case for Logitech MX Master 3S'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_an_accessory_query_still_matches_the_accessory'),
      test('test_amazon.py', 'test_an_accessory_query_still_returns_accessories'),
      S54_RULES,
    ],
    label:
      'asserted: accessory_for is false and is_match is true (score at or over 72) when the ' +
      'query itself asks for an accessory',
  },
  renamed(
    'feature-list-after-a-dash',
    'the model, then a dash and a feature list',
    'Bambu Lab A1 mini',
    'Bambu Lab A1 mini FDM 3D Printer - Camera, Auto Bed Leveling, 500mm/s, 48 dB',
  ),
  renamed(
    'hyphen-joined-to-the-colour',
    'the colour joined by a hyphen without a space',
    'Keurig K-Mini',
    'Keurig K-Mini Single Serve K-Cup Pod Coffee Maker- Black',
  ),
  renamed(
    'second-generation-written-out',
    '"(2nd generation)" for the "2" of the query',
    'Apple AirPods Pro 2',
    'Apple AirPods Pro (2nd generation) In-Ear Noise Cancelling Truly Wireless Headphones - White',
  ),
  renamed(
    'capacity-after-a-slash',
    'the capacity joined to the model by a slash',
    'Raspberry Pi 5 8GB',
    'Raspberry Pi 5/8GB',
  ),
  renamed(
    'sku-before-the-name',
    'a store SKU ("PI5-8GB") before the name',
    'Raspberry Pi 5 8GB',
    'PI5-8GB, Raspberry Pi 5 - 8GB',
  ),
  renamed(
    'max-after-a-voltage-is-a-platform',
    '"20V MAX" names a battery platform, not a Max variant',
    'DEWALT DCD793D1 20V',
    'DEWALT DCD793D1 20V MAX Compact Brushless Drill/Driver',
    {
      from: [
        test('test_matching.py', RENAMED, '[DEWALT DCD793D1 20V] (comment: "a battery platform")'),
        test(
          'test_recipes.py',
          'test_near_miss_titles_are_caught',
          '[DEWALT DCD793D1 20V] -> None',
        ),
        test('test_matching.py', 'test_variant_words_and_designators', '("20V MAX" -> no word)'),
        S54_RULES,
      ],
    },
  ),
  renamed(
    'brand-left-out-model-and-capacity-kept',
    'no brand in the title; model and capacity match',
    'Samsung 990 Pro 2TB',
    '990 PRO PCIe 4.0 NVMe SSD, 2TB',
  ),
  renamed(
    'another-model-code-of-the-same-name',
    'the store\'s "Sonicare 4100" with a model code (HX3681/23) the query does not name',
    'Philips Sonicare ProtectiveClean 4100',
    'Philips Sonicare 4100 Electric Toothbrush (HX3681/23) - White',
    {
      from: [
        test('test_matching.py', RENAMED, '[Philips Sonicare ProtectiveClean 4100]'),
        review(
          'phase5',
          'sonicare-4100',
          'bestbuyca',
          'catalog: travel cases (the web read the 4100 itself)',
          ['before'],
        ),
        S54_RULES,
      ],
      label: `${ACCEPTED}; the review says Best Buy's web row, this title, is the 4100 itself`,
      ownerCheck:
        'The reviews accept both HX3681/23 (this) and HX6810 (match-owner-rulings ' +
        'model-code-hx6810-50, model-code-hx6810) as "the 4100". Confirm both share the identity ' +
        'asked for.',
    },
  ),
  {
    id: 'same-model-other-wording-kit',
    what: 'the same model and "kit" in another store\'s wording',
    input: {
      asked: asked('Prusa MK4S kit'),
      listing: listing('Original Prusa MK4S 3D Printer kit'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_model_clash_is_a_different_product', '(same > clash)'),
      run('score("Prusa MK4S kit", title) = 100.0, at or over is_match\'s 72'),
    ],
    label: 'the test ranks it over the clash; running the matcher gives 100, a match',
  },
  {
    id: 'same-words-other-order',
    what: "the query's words in another order",
    input: {
      asked: asked('Polymaker PolyTerra PLA 1kg matte black'),
      listing: listing('Polymaker PolyTerra PLA matte black 1kg'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_vague_candidate_cannot_outrank_specific_query', '(specific)'),
      run('score(query, title) = 100.0'),
    ],
    label: 'the test ranks it over a vague title; running the matcher gives 100, a match',
  },
  {
    id: 'rank-keeps-the-kit',
    what: 'rank keeps the kit for a query that names no configuration',
    input: { asked: asked('Prusa MK4S'), listing: listing('Original Prusa MK4S 3D Printer kit') },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_rank_filters_and_orders', '(kept at threshold 60)'),
      run('score("Prusa MK4S", title) = 100.0'),
    ],
    label: 'kept by rank (asserted, two of three kept); running the matcher gives 100',
    ownerCheck: CONFIGURATION,
  },
  {
    id: 'rank-keeps-the-assembled',
    what: 'rank keeps the assembled printer for a query that names no configuration',
    input: { asked: asked('Prusa MK4S'), listing: listing('Prusa MK4S assembled') },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_rank_filters_and_orders', '(kept at threshold 60)'),
      run('score("Prusa MK4S", title) = 100.0'),
    ],
    label: 'kept by rank (asserted); running the matcher gives 100',
    ownerCheck: `${CONFIGURATION} (Kit and assembled are both kept for the same query.)`,
  },
  {
    id: 'near-miss-free-cordless-title',
    what: 'the model with the platform, "Cordless" and a chuck size',
    input: {
      asked: asked('DEWALT DCD793D1'),
      listing: listing('DEWALT DCD793D1 20V MAX Compact Brushless Cordless 1/2-in Drill/Driver'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_recipes.py', 'test_near_miss_titles_are_caught', '[DEWALT DCD793D1] -> None'),
      run('score = 100.0, over the recipe title floor of 60'),
    ],
    label: 'no variant word (asserted) and a score of 100 (run): the recipe title check accepts it',
  },
  {
    id: 'near-miss-free-colour-after-comma',
    what: 'the asked model with a colour after a comma',
    input: {
      asked: asked('Keurig K-Mini'),
      listing: listing('Keurig K-Mini Single Serve Coffee Maker, Black'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_recipes.py', 'test_near_miss_titles_are_caught', '[Keurig K-Mini] -> None'),
      run('score = 100.0'),
    ],
    label: 'no variant word (asserted) and a score of 100 (run)',
  },
  {
    id: 'near-miss-free-marketing-word',
    what: '"Performance" after the model is a description, not a variant word',
    input: {
      asked: asked('Logitech MX Master 3S'),
      listing: listing('Logitech MX Master 3S Performance Wireless Mouse'),
    },
    expected: { relation: 'exact' },
    from: [
      test(
        'test_recipes.py',
        'test_near_miss_titles_are_caught',
        '[Logitech MX Master 3S] -> None',
      ),
      run('score = 100.0'),
    ],
    label: 'no variant word (asserted) and a score of 100 (run)',
  },
  {
    id: 'for-business-ranked-over-an-accessory',
    what: 'Amazon ranks the for-Business edition first, over grip tape for the mouse',
    input: {
      asked: asked('logitech mx master 3s'),
      listing: listing('Logitech MX Master 3S for Business, Graphite'),
    },
    expected: { relation: 'variant' },
    from: [
      test(
        'test_amazon.py',
        'test_a_product_variant_named_for_something_is_not_an_accessory',
        '(ranked first; the test name calls it "a product variant")',
      ),
      run('score = 100.0'),
      S54_JUDGE,
    ],
    label:
      'the predecessor names it "a product variant" in the test name; S§5.4: variants in ' +
      'configuration are not matches',
    divergence:
      'The predecessor ranks it first as the product for the query. S§5.4: a variant is not a ' +
      'match.',
    ownerCheck: 'See for-business-edition-with-part-number.',
  },
];
