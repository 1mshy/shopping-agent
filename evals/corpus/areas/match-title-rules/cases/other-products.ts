// Another model, generation or line of the family (S§5.4 "model-token conflicts, variant words"),
// and titles that give the rules nothing to confirm. Rows of the predecessor's
// test_another_model_of_the_family_is_not_the_product (each asserts a score under 65) and the
// title-only refusals of test_title_check and test_recipes. The relation comes from the store's
// hand-review label where it names one; the predecessor's failure classes map onto
// MATCH_RELATIONS as: "another model or generation" -> other_model, "another line or brand" ->
// other_line, "another capacity or size" -> variant (reports/2026-10-23-matching.md:106-113).
import { asked, listing, type MatchCase, NOT_EXACT, REJECTED } from '../contract.ts';
import { code, REVIEW_RULE, review, run, S54_JUDGE, S54_RULES, test } from '../evidence.ts';

const FAMILY = 'test_another_model_of_the_family_is_not_the_product';

function family(
  id: string,
  what: string,
  query: string,
  title: string,
  expected: MatchCase['expected'],
  label: string,
  evidence: MatchCase['from'],
  more: Partial<MatchCase> = {},
): MatchCase {
  return {
    id,
    what,
    input: { asked: asked(query), listing: listing(title) },
    expected,
    from: [test('test_matching.py', FAMILY, `[${query}]`), ...evidence, S54_RULES],
    label: `rejected (asserted: score under 65); ${label}`,
    ...more,
  };
}

const GENERATION =
  'the review rule rejects "another model or generation"; a generation is none of the S§5.4 ' +
  'variant attributes (size, colour, capacity, configuration, pack count), so other_model';

export const otherProducts: readonly MatchCase[] = [
  family(
    'full-size-for-the-mini',
    'the full-size model for a query that asks for the mini',
    'Bambu Lab A1 mini',
    'Bambu Lab A1 3D Printer',
    { oneOf: ['variant', 'other_model'] },
    'the review rejects the A1 for the A1 mini ("not mini") without naming a class, and the ' +
      'predecessor calls "mini" a qualifier that makes "a different product of the same name"; ' +
      'whether mini is a size variant or another model the evidence does not say',
    [
      review('phase5', 'a1-mini', '3dprintingcanada', 'hotend, the A1 Combo (not mini), a plate'),
      code('pricewatch/src/pricewatch/matching.py:50-53 ("an A1 is not an A1 mini")'),
    ],
  ),
  family(
    'max-model-of-the-line',
    '"Kobra 3 Max" for "Kobra 3 Combo"',
    'Anycubic Kobra 3 Combo',
    'Anycubic Kobra 3 Max',
    { relation: 'other_model' },
    'the review labels it another model',
    [review('phase5', 'kobra-3-combo', 'anycubic', 'Kobra 3 Max, Kobra 4 Combo (other models)')],
  ),
  family(
    'max-v2-combo-of-the-line',
    '"Kobra 3 Max V2 Combo" for "Kobra 3 Combo": both say Combo, the model differs',
    'Anycubic Kobra 3 Combo',
    'Anycubic Kobra 3 Max V2 Combo',
    { relation: 'other_model' },
    'the review rejects it and labels the Kobra 3 Max another model',
    [
      review(
        'phase5',
        'kobra-3-combo',
        'anycubic.au',
        'Kobra 3 Max V2 Combo, a Max bundle, Kobra 4 Combo',
      ),
      review('phase5', 'kobra-3-combo', 'anycubic', 'Kobra 3 Max, Kobra 4 Combo (other models)'),
    ],
  ),
  family(
    'next-number-of-the-line',
    '"Kobra 4 Combo" for "Kobra 3 Combo": a bare-number designator clash',
    'Anycubic Kobra 3 Combo',
    'Anycubic Kobra 4 Combo',
    { relation: 'other_model' },
    'the review labels it another model; the predecessor clashes "Kobra 3" with "Kobra 4"',
    [
      review('phase5', 'kobra-3-combo', 'anycubic', 'Kobra 3 Max, Kobra 4 Combo (other models)'),
      code('pricewatch/src/pricewatch/matching.py:168-187, 309-314 (number designators)'),
    ],
  ),
  family(
    'go-after-the-model',
    '"K-Mini Go" for "K-Mini"',
    'Keurig K-Mini',
    'Keurig® K-Mini® Go Single Serve Coffee Maker',
    { relation: 'other_model' },
    'the review labels it another model',
    [
      review('phase5', 'keurig-k-mini', 'keurig.ca', 'K-Mini Go (another model)'),
      {
        kind: 'report',
        ref: 'reports/2026-10-14-web-discovery.md:116 ("the K-Mini **Go**, a different model")',
      },
    ],
  ),
  family(
    'mate-plus-after-the-model',
    '"K-Mini Mate Plus" for "K-Mini"',
    'Keurig K-Mini',
    'Keurig K-Mini Mate Plus Single Serve Coffee Maker - Black',
    { relation: 'other_model' },
    'the review labels it another model',
    [review('phase5', 'keurig-k-mini', 'staples.ca', 'K-Mini Mate Plus (another model)')],
  ),
  family(
    'next-generation-bare-title',
    '"AirPods Pro 3" for "AirPods Pro 2"',
    'Apple AirPods Pro 2',
    'Apple AirPods Pro 3',
    { relation: 'other_model' },
    GENERATION,
    [review('phase5', 'airpods-pro-2', 'canadiantire.ca', 'AirPods Pro 3'), REVIEW_RULE, S54_JUDGE],
  ),
  family(
    'next-generation-with-description',
    '"AirPods Pro 3" with a dash and a description',
    'Apple AirPods Pro 2',
    'Apple AirPods Pro 3 - true wireless earphones with mic',
    { relation: 'other_model' },
    GENERATION,
    [review('phase5', 'airpods-pro-2', 'cdw.ca', 'AirPods Pro 3, AirPods Max 2'), REVIEW_RULE],
  ),
  family(
    'max-line-same-number',
    '"AirPods Max 2" for "AirPods Pro 2": same number, another word',
    'Apple AirPods Pro 2',
    'Apple AirPods Max 2 - headphones with mic',
    { oneOf: ['other_model', 'other_line'] },
    'the review rejects it without a class; whether AirPods Max is another model or another ' +
      'line of the brand the evidence does not say',
    [review('phase5', 'airpods-pro-2', 'cdw.ca', 'AirPods Pro 3, AirPods Max 2')],
  ),
  family(
    'previous-generation-board',
    '"Raspberry Pi 4 Model B" for "Raspberry Pi 5 8GB"',
    'Raspberry Pi 5 8GB',
    'Raspberry Pi 4 Model B',
    { relation: 'other_model' },
    GENERATION,
    [review('phase5', 'raspberry-pi-5', 'filastruder', 'Raspberry Pi 4'), REVIEW_RULE],
  ),
  family(
    'previous-generation-kit-same-ram',
    'a Pi 4 kit with the asked 8GB: another generation, sold as a kit',
    'Raspberry Pi 5 8GB',
    'Raspberry Pi 4 Basic Kit - 8GB',
    { oneOf: ['other_model', 'bundle'] },
    'the review rejects "Raspberry Pi 4 kits": another generation and a kit, and the evidence ' +
      'does not say which label wins',
    [
      review(
        'phase5',
        'raspberry-pi-5',
        'shoppurilite.ca',
        'Raspberry Pi 4 kits, a 16 GB Pi 5 kit',
      ),
    ],
  ),
  family(
    'another-line-of-the-brand',
    '"Polymaker PLA Pro" for "Polymaker PolyTerra PLA 1kg"',
    'Polymaker PolyTerra PLA 1kg',
    'Polymaker™ PLA Pro',
    { relation: 'other_line' },
    'the review labels it another Polymaker line',
    [review('phase5', 'polyterra-pla', 'polymaker', 'PLA Pro (another Polymaker line)')],
  ),
  {
    id: 'model-token-clash',
    what: '"MK3S+" for "MK4S": same family, another model designator',
    input: {
      asked: asked('Prusa MK4S kit'),
      listing: listing('Original Prusa MK3S+ 3D Printer kit'),
    },
    expected: { relation: 'other_model' },
    from: [
      test('test_matching.py', 'test_model_clash_is_a_different_product', '(clash < 72)'),
      code(
        'pricewatch/src/pricewatch/matching.py:302-308 ("Same family, different model (MK4S vs ' +
          'MK3S) — that is a different product")',
      ),
      run('score = 47.0'),
      S54_RULES,
    ],
    label: "the predecessor's model-token clash, which its comment calls a different model",
  },
  {
    id: 'one-word-title',
    what: 'a title that is only the material ("PLA")',
    input: {
      asked: asked('Polymaker PolyTerra PLA 1kg matte black'),
      listing: listing('PLA'),
    },
    expected: { oneOf: NOT_EXACT },
    from: [
      test(
        'test_matching.py',
        'test_vague_candidate_cannot_outrank_specific_query',
        '(vague < 72)',
      ),
      run("score = 66.67: under is_match's 72, yet over the compare floor of 65"),
      S54_JUDGE,
    ],
    label:
      'the predecessor says it is not a match (asserted under 72) and nothing more; the title ' +
      'conflicts with nothing and confirms nothing, so any label but exact',
  },
  {
    id: 'unrelated-product',
    what: 'a garden hose in the results for a printer',
    input: { asked: asked('Prusa MK4S'), listing: listing('Garden hose 25ft') },
    expected: { oneOf: REJECTED },
    from: [
      test('test_matching.py', 'test_rank_filters_and_orders', '(dropped at threshold 60)'),
      run('score = 16.0'),
    ],
    label:
      'the predecessor drops it outright; MATCH_RELATIONS has no "unrelated", so any decided ' +
      'rejection',
  },
  {
    id: 'go-is-a-near-miss',
    what: 'the recipe check names "go" as the word that makes it another product',
    input: {
      asked: asked('Keurig K-Mini'),
      listing: listing('Keurig K-Mini Go Single Serve K-Cup Pod Coffee Maker'),
    },
    expected: { relation: 'other_model' },
    from: [
      test('test_recipes.py', 'test_near_miss_titles_are_caught', '[Keurig K-Mini] -> "go"'),
      review('phase5', 'keurig-k-mini', 'keurig.ca', 'K-Mini Go (another model)'),
      run('score = 55.0'),
    ],
    label: 'near_miss names "go" (asserted); the review labels the K-Mini Go another model',
  },
  {
    id: 'mate-is-a-near-miss',
    what: 'the recipe check names "mate" as the word that makes it another product',
    input: {
      asked: asked('keurig k-mini'),
      listing: listing('Keurig K-Mini Mate Single Serve Coffee Maker'),
    },
    expected: { oneOf: ['other_model', 'variant'] },
    from: [
      test('test_title_check.py', 'test_mate_is_a_variant_word', '(near_miss)'),
      review('phase5', 'keurig-k-mini', 'staples.ca', 'K-Mini Mate Plus (another model)'),
      run('score = 55.0'),
    ],
    label:
      'near_miss (asserted) means "a different product"; the review labels the Mate Plus another ' +
      'model, but no label names the Mate alone, so other_model or variant',
  },
  {
    id: 'title-without-the-model-number',
    what: 'the right drill under a name that leaves out the model number the query names',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT 20 V MAX Brushless Compact Drill/Driver Kit with Battery/Charger'),
    },
    expected: { relation: 'unknown' },
    from: [
      test(
        'test_title_check.py',
        'test_rona_its_html_title_names_the_model',
        '(first assertion: the name alone is refused title_mismatch)',
      ),
      run('score = 45.71'),
      S54_JUDGE,
    ],
    label:
      'the docstring says this is the right DCD793D1 page (Rona, 2026-10-19), so no rejection is ' +
      'true; the title gives no positive evidence of the model, so the code tiers cannot confirm ' +
      'it and leave it to the judge: unknown',
  },
  {
    id: 'brand-only-name',
    what: 'a name that matches the query on the brand alone',
    input: {
      asked: asked('samsung af1'),
      listing: listing('Samsung 17.5 cu. ft. French Door Refrigerator'),
    },
    expected: { oneOf: NOT_EXACT },
    from: [
      test(
        'test_title_check.py',
        'test_a_name_that_matches_only_on_the_brand_is_not_enough',
        "(this text is the page's <h1>; refused title_mismatch)",
      ),
      run('score = 67.37: over the compare floor of 65, yet refused for not naming the model'),
      S54_JUDGE,
    ],
    label:
      'refused because only the brand matches; the evidence says not the product and nothing ' +
      'about which relation',
  },
];
