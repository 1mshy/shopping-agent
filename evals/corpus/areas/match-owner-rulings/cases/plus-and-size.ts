// Rulings: "Plus counts the query's way" and "a size in place of a model is not a clash" (S§5.4).
//
// Plus is recorded in matching.py:316-321 ("the plus only the query way: the review took
// PolyTerra PLA+ for PolyTerra PLA, not SUNLU PLA for SUNLU PLA+") and
// reports/2026-10-23-matching.md:74-77. The size ruling is recorded in matching.py:309-311 ("Only
// when both sides write one: a title that gives a size instead of the model is not a clash") and
// reports/2026-10-23-matching.md:78-81 ("so 'Ninja Air Fryer, 4-qt' for the AF101 is not a
// clash"); the Phase 1 hand check called such a listing "plausible but not confirmed".
//
// The owner's ruling of 2026-11-23 adds: a name suffix that changes the line (Duo vs Duo Plus) or
// the material (PLA+ vs Silk PLA+) makes a different product, `other_model` or `variant`, never
// `exact`. The orchestrator's reading the same day: "Plus counts the query's way" stays for the
// material-grade mark as the predecessor's review took it, does not extend to model names, and
// matte and silk are other lines (in the ruling's scope), not finishes. Where the ruling names
// `other_model` or `variant`, a case that had `other_line` for a suffix of the asked name now
// expects that pair.
import {
  code,
  REVIEW_RULE,
  report,
  review,
  run,
  S54_JUDGE,
  S54_RULINGS,
  SUFFIX_READING,
  SUFFIX_RULING,
  test,
} from '../../match-title-rules/evidence.ts';
import { asked, listing, type MatchCase } from '../contract.ts';

const PLUS_COMMENT = code(
  'pricewatch/src/pricewatch/matching.py:316-321, 327-332 ("Plus" judged the query\'s way only)',
);
const PLUS_REPORT = report(
  'reports/2026-10-23-matching.md:74-77 ("SUNLU PLA+" needs a PLA+ in the listing; "PolyTerra ' +
    'PLA+" still matches "PolyTerra PLA", "as the review took it")',
);
const CLASS3 = report(
  'reports/2026-10-23-matching.md:27-29 (class 3, "other lines and brands": "SUNLU PLA for SUNLU ' +
    'PLA+, Polymaker PLA Pro")',
);
const OTHER = 'test_another_model_of_the_family_is_not_the_product';
const RENAMED = 'test_the_product_under_another_stores_name_still_matches';
const SUNLU = 'SUNLU PLA+ 1.75mm 1kg';

const SIZE_COMMENT = code(
  'pricewatch/src/pricewatch/matching.py:309-314 ("a title that gives a size instead of the ' +
    'model is not a clash")',
);
const SIZE_REPORT = report(
  'reports/2026-10-23-matching.md:78-81 ("only when both sides write one, so \'Ninja Air ' +
    'Fryer, 4-qt\' for the AF101 is not a clash")',
);
const PHASE1 = report(
  'reports/2026-10-14-web-discovery.md:127-129 ("Match plausible but not confirmed": ' +
    'homedepot.ca "Ninja 3.8L Air Fryer in Black" for "Ninja AF101". "The AF101 is the 3.8 L ' +
    'model, but the title does not name it.")',
);
const SIZE_LABEL =
  'the ruling makes it no clash, so no rejection; the title names no model, so nothing positive ' +
  'confirms the AF101 (the Phase 1 hand check: "plausible but not confirmed"); the code tiers ' +
  'leave it to the judge: unknown';
const SIZE_DIVERGENCE =
  'The predecessor scores it as the product (75, over every floor). S§5.4: "a match needs ' +
  'positive evidence", and a size is not the model; the ruling only keeps it from being a clash.';

export const plusAndSize: readonly MatchCase[] = [
  {
    id: 'plus-asked-listing-plain',
    what: 'SUNLU PLA for a SUNLU PLA+ query',
    input: { asked: asked(SUNLU), listing: listing('SUNLU PLA 3D Printer Filament 1KG') },
    expected: { oneOf: ['other_model', 'variant'] },
    from: [
      test('test_matching.py', OTHER, `[${SUNLU}]`),
      review('phase5', 'sunlu-pla-plus', 'sunlu', 'SUNLU PLA and Silk PLA+, not PLA+'),
      PLUS_COMMENT,
      CLASS3,
      S54_RULINGS,
    ],
    label:
      'rejected (asserted); the listing lacks the "+" that sets the material of the asked line, ' +
      `so it follows ${SUFFIX_RULING}. The relation is that pair: the case expected other_line ` +
      'before the ruling, from the report filing SUNLU PLA for SUNLU PLA+ under class 3, "other ' +
      'lines and brands"',
  },
  {
    id: 'plus-asked-listing-matte',
    what: 'SUNLU PLA Matte for a SUNLU PLA+ query',
    input: { asked: asked(SUNLU), listing: listing('Sunlu 1.75mm, 1kg/spool, PLA Matte (Black)') },
    expected: { oneOf: ['other_model', 'variant'] },
    from: [
      test('test_matching.py', OTHER, `[${SUNLU}]`),
      review(
        'phase5',
        'sunlu-pla-plus',
        'canadacomputers',
        'SUNLU matte, high-speed and Silk PLA+, not PLA+',
      ),
      report(
        "reports/2026-10-23-matching.md:217-219 (\"'silk' and 'matte' are finishes the review " +
          'rejected too")',
      ),
      PLUS_COMMENT,
      S54_RULINGS,
    ],
    label:
      'rejected (asserted); the review rejects it as not PLA+. Matte is another line, not a finish ' +
      `(${SUFFIX_READING}), and the material differs (PLA, not PLA+), so it follows ` +
      `${SUFFIX_RULING}. The case expected other_line before the ruling (the review's class 3 ` +
      'line); the open question whether matte is a finish is settled by that reading',
  },
  {
    id: 'plus-asked-listing-another-brand',
    what: 'Polymaker PolyTerra PLA for a SUNLU PLA+ query',
    input: { asked: asked(SUNLU), listing: listing('Polymaker Polyterra PLA 1.75mm 1kg') },
    expected: { relation: 'other_line' },
    from: [
      test('test_matching.py', OTHER, `[${SUNLU}]`),
      review('phase5', 'sunlu-pla-plus', 'voxelfactory', 'Polymaker filament'),
      PLUS_REPORT,
      CLASS3,
    ],
    label:
      'rejected (asserted); another brand, which the predecessor files with other lines (class 3 ' +
      '"another line or brand")',
  },
  {
    id: 'plus-asked-listing-plus-2-0',
    what: 'SUNLU PLA+ 2.0 for a SUNLU PLA+ query: the review took it',
    input: {
      asked: asked(SUNLU),
      listing: listing('SUNLU PLA+ 2.0 3D Printer Filament, 1.75mm, 1KG Black'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', RENAMED, `[${SUNLU}]`),
      review(
        'phase5',
        'sunlu-pla-plus',
        'amazon',
        'catalog: matte PLA, PLA, Silk PLA+ (the web read SUNLU PLA+ 2.0 1 kg)',
        ['before'],
      ),
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "sunlu-pla-plus/amazon (SUNLU ' +
          'PLA+ 2.0 in the catalog too)" are no longer rejected',
      },
      S54_RULINGS,
    ],
    label: 'a match (asserted), and both reviews count the PLA+ 2.0 as SUNLU PLA+ itself',
    ownerCheck:
      `Kept exact as the reviews took it, but ${SUFFIX_RULING} may reach it: "2.0" is a name ` +
      'suffix, SUNLU sells PLA+ and PLA+ 2.0 side by side, and the gold set (matcher-v1, prompt ' +
      'gold-label.v1) labels "SUNLU PLA+ 2.0, Upgraded PLA+" other_model under a SUNLU PLA+ ' +
      'product (sunlu-pla-plus-s13, -s14). Confirm exact, or say 2.0 makes another product.',
  },
  {
    id: 'plus-written-as-a-word',
    what: '"PLA Plus" in the query, "PLA+" in the listing',
    input: {
      asked: asked('SUNLU PLA Plus Filament 1.75mm 1kg'),
      listing: listing('SUNLU PLA+ 1.75mm 1kg'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', RENAMED, '[SUNLU PLA Plus Filament 1.75mm 1kg]'),
      code('pricewatch/src/pricewatch/matching.py:159-165 ("PLA+" and "PLA Plus" are one word)'),
      S54_RULINGS,
    ],
    label: 'a match (asserted): "PLA+" and "PLA Plus" are the same mark',
  },
  {
    id: 'plus-only-in-the-listing',
    what: "PolyTerra PLA+ for a PolyTerra PLA query: the plus counts only the query's way",
    input: {
      asked: asked('Polymaker PolyTerra PLA 1kg'),
      listing: listing('PolyTerra™ PLA+ Black - 1.75mm 1kg'),
    },
    expected: { relation: 'exact' },
    from: [
      test('test_matching.py', RENAMED, '[Polymaker PolyTerra PLA 1kg] ("the review took it")'),
      PLUS_COMMENT,
      PLUS_REPORT,
      S54_RULINGS,
    ],
    label:
      'a match (asserted); the comment and report say the review took it, and it stays exact ' +
      `under ${SUFFIX_READING}`,
    ownerCheck:
      `Kept exact under the orchestrator's reading, but ${SUFFIX_RULING} reads against it: PLA+ ` +
      'for PLA is a material suffix, the gold-set prompt gold-label.v1 writes the ruling as ' +
      '"PLA vs PLA+ is never exact", and the gold set labels this same title other_model under ' +
      "its PolyTerra PLA product (polyterra-pla-s17). Confirm exact (Plus counts the query's way " +
      'for a material grade), or say it is other_model or variant.',
  },
  {
    id: 'plus-of-another-item-in-a-bundle',
    what: 'the printer with a "Mercury Plus" washer: the Plus is the washer\'s, and it is a bundle',
    input: {
      asked: asked('Elegoo Saturn 4 Ultra'),
      listing: listing('Saturn 4 Ultra 16K with Mercury Plus V2.0 Bundle'),
    },
    expected: { relation: 'bundle' },
    from: [
      test('test_matching.py', RENAMED, '[Elegoo Saturn 4 Ultra] ("the Plus is the washer\'s")'),
      run('score = 72.0'),
      REVIEW_RULE,
      S54_JUDGE,
    ],
    label:
      'the title says "Bundle" and names a second product; the review rule rejects a bundle as ' +
      'not the product',
    divergence:
      'The predecessor accepts it as the product (asserted at or over 65; its point is only that ' +
      "the Plus is not the printer's). The hand-review rule and S§5.4 (exact means one barcode) " +
      'make a bundle not the product.',
  },
  {
    id: 'plus-only-in-the-listing-another-model',
    what: 'Instant Pot Duo Plus for an Instant Pot Duo query',
    input: {
      asked: asked('Instant Pot Duo 6 Quart'),
      listing: listing('Instant Pot Duo Plus 9-in-1 6 Quart'),
    },
    expected: { oneOf: ['other_model', 'variant'] },
    from: [
      test(
        'test_recipes.py',
        'test_near_miss_titles_are_caught',
        '[Instant Pot Duo 6 Quart] -> "plus"',
      ),
      code(
        'pricewatch/src/pricewatch/recipes.py:857-858 (words that "make it another product": ' +
          '"Duo Plus")',
      ),
      run("matching.score = 100.0: the matcher, judging Plus the query's way, accepts it"),
    ],
    label:
      'the recipe check names "plus" (asserted) and its comment calls the Duo Plus another ' +
      `product; this is the example of ${SUFFIX_RULING}, which names the pair and does not ` +
      `choose between them; "Plus counts the query's way" does not reach model names (${SUFFIX_READING})`,
    divergence:
      'The predecessor disagrees with itself: its matcher, applying "Plus counts the query\'s ' +
      'way" to model names, accepts the Duo Plus for the Duo (100), while its recipe check ' +
      "rejects it. The case follows the owner's ruling of 2026-11-23: never exact.",
  },
  {
    id: 'size-in-place-of-the-model-litres',
    what: 'a Ninja air fryer named by its size (3.79L), not its model, sold open box',
    input: {
      asked: asked('Ninja AF101 Air Fryer'),
      listing: listing('Ninja Air Fryer - 3.79L - Black - Open Box'),
    },
    expected: { relation: 'unknown' },
    from: [
      test('test_matching.py', RENAMED, '[Ninja AF101 Air Fryer]'),
      run('score = 75.0'),
      SIZE_COMMENT,
      SIZE_REPORT,
      PHASE1,
      S54_RULINGS,
      S54_JUDGE,
    ],
    label: SIZE_LABEL,
    divergence: SIZE_DIVERGENCE,
  },
  {
    id: 'size-in-place-of-the-model-quarts',
    what: 'a Ninja air fryer named by its size (4-qt), not its model',
    input: {
      asked: asked('Ninja AF101 Air Fryer'),
      listing: listing('Ninja® Non-Stick Air Fryer with Cool-Touch Handle, 4-qt'),
    },
    expected: { relation: 'unknown' },
    from: [
      test('test_matching.py', RENAMED, '[Ninja AF101 Air Fryer]'),
      run('score = 75.0'),
      SIZE_COMMENT,
      SIZE_REPORT,
      PHASE1,
      S54_RULINGS,
      S54_JUDGE,
    ],
    label: SIZE_LABEL,
    divergence: SIZE_DIVERGENCE,
  },
  {
    id: 'size-in-place-of-the-model-phase-1',
    what: 'the Phase 1 hand check\'s own example: "Ninja 3.8L Air Fryer in Black"',
    input: {
      asked: asked('Ninja AF101 Air Fryer'),
      listing: listing('Ninja 3.8L Air Fryer in Black'),
    },
    expected: { relation: 'unknown' },
    from: [PHASE1, run('score = 75.0'), SIZE_COMMENT, S54_RULINGS, S54_JUDGE],
    label: SIZE_LABEL,
    divergence: SIZE_DIVERGENCE,
  },
];
