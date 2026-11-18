// Ruling: "combo counts both ways" (S§5.4). Recorded in reports/2026-10-23-matching.md:63-73
// ("'Combo' counts wherever it sits, and 'w/ AMS' / 'with AMS' is an alias for it, which is how
// the review judged these bundles both ways"), matching.py:44-53, and the review entries
// p1s-combo.bambulab / nex3d.com ("P1S without the AMS") and a1-mini.west3d ("only the A1 mini
// Combo (with AMS lite)"). Each rejection below has its nearest accept: a Combo listing for a
// Combo query, however the store writes it.
import {
  code,
  report,
  review,
  run,
  S54_JUDGE,
  S54_RULINGS,
  test,
} from '../../match-title-rules/evidence.ts';
import { asked, listing, type MatchCase } from '../contract.ts';

const RULING = report(
  'reports/2026-10-23-matching.md:63-73 ("Combo" counts wherever it sits; "w/ AMS" is an alias; ' +
    '"how the review judged these bundles both ways")',
);
const COMMENT = code(
  "pricewatch/src/pricewatch/matching.py:44-53 (\"Bambu's bundle is 'the Combo'; stores also " +
    'write it as the printer \'w/ AMS\'. Same SKU"; "the A1 mini Combo is a different SKU from the ' +
    'A1 mini (2026-10-23 review)")',
);
const IN_LISTING =
  'the listing is the asked product sold as a Combo, which the report calls a bundle and the ' +
  'predecessor treats as a variant word; the evidence does not choose between bundle and variant';

export const combo: readonly MatchCase[] = [
  {
    id: 'combo-asked-listing-without-the-ams',
    what: "the printer alone for a Combo query (Bambu Lab's own store)",
    input: { asked: asked('Bambu Lab P1S Combo'), listing: listing('Bambu Lab P1S 3D Printer') },
    expected: { relation: 'variant' },
    from: [
      test('test_matching.py', 'test_another_model_of_the_family_is_not_the_product', '[P1S]'),
      test(
        'test_recipes.py',
        'test_near_miss_titles_are_caught',
        '[Bambu Lab P1S Combo] -> "combo"',
      ),
      review('phase5', 'p1s-combo', 'bambulab', 'P1S without the AMS, stickers'),
      report(
        'reports/2026-10-14-web-discovery.md:113-118 ("Wrong product": the printer without the ' +
          'AMS) and :308-311 ("on a watch, that near-miss would have read as a 48% drop")',
      ),
      RULING,
      S54_RULINGS,
      S54_JUDGE,
    ],
    label:
      'the review says "P1S without the AMS": the same printer in another configuration, which ' +
      'S§5.4 calls a variant; it is not a bundle (it has less) nor another model',
  },
  {
    id: 'combo-in-listing-not-asked',
    what: 'the A1 mini Combo (with AMS lite) for an A1 mini query',
    input: {
      asked: asked('Bambu Lab A1 mini'),
      listing: listing(
        'Bambu Lab A1 Mini Combo, A1 Mini 3D Printer&AMS lite, Multi-Color Printing',
      ),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [
      test('test_matching.py', 'test_another_model_of_the_family_is_not_the_product', '[A1 mini]'),
      RULING,
      COMMENT,
      S54_RULINGS,
    ],
    label: `rejected (asserted: score under 65); ${IN_LISTING}`,
  },
  {
    id: 'combo-in-listing-written-as-and',
    what: 'printer "and" AMS-Lite Combo for an A1 mini query (west3d)',
    input: {
      asked: asked('Bambu Lab A1 mini'),
      listing: listing('Bambu Lab A1 Mini 3D Printer and A1 Mini AMS-Lite Combo'),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [
      review(
        'phase5',
        'a1-mini',
        'west3d',
        'only the A1 mini Combo (with AMS lite), a toolhead board',
      ),
      run('score = 55.0'),
      RULING,
      S54_RULINGS,
    ],
    label: `the review rejects the store for having only the Combo; ${IN_LISTING}`,
  },
  {
    id: 'combo-of-the-full-size-model',
    what: 'the A1 Combo (not mini) for an A1 mini query',
    input: { asked: asked('Bambu Lab A1 mini'), listing: listing('Bambu Lab A1 Combo') },
    expected: { oneOf: ['variant', 'other_model', 'bundle'] },
    from: [
      review('phase5', 'a1-mini', '3dprintingcanada', 'hotend, the A1 Combo (not mini), a plate'),
      run('score = 55.0'),
      RULING,
    ],
    label:
      'rejected by the review for being the A1, not the mini, and it is a Combo too: mini makes a ' +
      'variant or another model (see match-title-rules full-size-for-the-mini), Combo a bundle or ' +
      'a variant',
  },
  {
    id: 'combo-in-listing-recipe-check',
    what: 'the recipe check names "combo" for a Kobra 3 query',
    input: {
      asked: asked('Anycubic Kobra 3'),
      listing: listing('Anycubic Kobra 3 Combo 3D Printer'),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [
      test('test_recipes.py', 'test_near_miss_titles_are_caught', '[Anycubic Kobra 3] -> "combo"'),
      run('score = 55.0'),
      RULING,
      S54_RULINGS,
    ],
    label: `near_miss names "combo" (asserted); ${IN_LISTING}`,
  },
  {
    id: 'combo-kit-in-listing',
    what: 'a "Combo kit" listing for a drill query',
    input: { asked: asked('dewalt dcd793d1'), listing: listing('DEWALT DCD793D1 Combo kit') },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [
      test('test_title_check.py', 'test_a_variant_word_is_still_a_near_miss'),
      test(
        'test_title_check.py',
        'test_a_variant_named_in_the_html_title_is_a_near_miss',
        '(the same word read from the page <title>)',
      ),
      run('score = 55.0'),
      RULING,
      S54_RULINGS,
    ],
    label: `near_miss names "combo" (asserted); ${IN_LISTING}`,
  },
  {
    id: 'combo-asked-listing-a-single-tool',
    what: 'the drill alone for a "Combo" query (the explorer\'s demonstration is refused)',
    input: {
      asked: asked('DEWALT DCD793D1 Combo'),
      listing: listing('DEWALT DCD793D1 20V MAX Compact Brushless Cordless 1/2-in Drill/Driver'),
    },
    expected: { oneOf: ['variant', 'other_model'] },
    from: [
      test(
        'test_recipes.py',
        'test_learn_store_refuses_a_near_miss_product',
        '(the saved Canadian Tire page, whose <h1> is this title; error_code near_miss naming ' +
          '"combo")',
      ),
      RULING,
      S54_RULINGS,
    ],
    label:
      'the listing lacks the Combo the query asks for: not a bundle (it has less), not a part; ' +
      'the evidence does not say whether a variant or another product',
  },
  {
    id: 'combo-written-with-ams',
    what: '"w/ AMS" is the Combo, and "X1-Carbon" is the X1C',
    input: {
      asked: asked('Bambu Lab X1-Carbon Combo'),
      listing: listing('BambuLab X1C 3D Printer w/ AMS'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', 'test_same_product_different_naming', '(is_match at 60)'),
      run('score = 100.0'),
      COMMENT,
      RULING,
    ],
    label: 'a match (asserted); the alias comment says "Same SKU"',
  },
  combined('combo-word-before-the-printer', 'Bambu Lab P1S AMS Combo 3D Printer'),
  combined('combo-printer-and-ams-combo', 'Bambu Lab P1S 3D Printer and P1S AMS Combo'),
  combined(
    'combo-in-brackets-after-a-plus',
    'Bambu Lab P1S + AMS (Combo) 3D Printer - P1SC, Bivolt',
  ),
  {
    ...combined('combo-with-another-ams-generation', 'Bambu Lab P1S Combo - AMS 2 Pro'),
    what: 'the Combo with the "AMS 2 Pro": the Pro qualifies the AMS, not the printer',
    ownerCheck:
      'The predecessor accepts the Combo with the newer AMS 2 Pro as the P1S Combo (its comment: ' +
      '"the Pro is the AMS\'s"). Confirm exact, or say the AMS generation makes a variant.',
  },
  {
    id: 'combo-with-a-year-prefix',
    what: 'the Combo with a "2026 NEW" prefix and a feature list',
    input: {
      asked: asked('Anycubic Kobra 3 Combo'),
      listing: listing(
        '2026 NEW Anycubic Kobra 3 Combo High-Speed Multi-Color 3D Printer With Automatic ' +
          'Filament System',
      ),
    },
    expected: { relation: 'exact' },
    from: [
      test(
        'test_matching.py',
        'test_the_product_under_another_stores_name_still_matches',
        '[Anycubic Kobra 3 Combo]',
      ),
      report(
        'reports/2026-10-23-matching.md:178-180 ("the Kobra 3 Combo from 7 (1 real) to 1 ' +
          '(AliExpress, real)")',
      ),
    ],
    label:
      "a match (asserted: score at or over 65); the report counts AliExpress's as the real one",
  },
];

function combined(id: string, title: string): MatchCase {
  return {
    id,
    what: `the Combo as "${title}"`,
    input: { asked: asked('Bambu Lab P1S Combo'), listing: listing(title) },
    expected: { relation: 'exact' },
    from: [
      test(
        'test_matching.py',
        'test_the_product_under_another_stores_name_still_matches',
        '[Bambu Lab P1S Combo]',
      ),
      RULING,
      S54_RULINGS,
    ],
    label: 'a match (asserted: score at or over 65): "Combo counts wherever it sits" on both sides',
  };
}
