// The hand reviews' rule and their per-store labels, on titles no predecessor test covers.
//
// Both review files state one rule ("about"): a store counts when one of its rows is the product
// itself, "any colour or finish, new, open box or renewed"; rejected are "accessories and parts,
// another model or generation, another capacity or size, a bundle, kit or multi-pack when no row
// is the product, a multi-capacity listing whose price is another capacity's, and a look-alike".
// A label is per store, so a title is used here only when the label names it (or the store had
// that one row). Condition (open box, renewed) is not part of the relation: these cases label
// identity only, and grouping by condition is the result groups' business (S§5.4).
//
// Where the predecessor's own matcher still accepted a rejected title (it scores at or over 65),
// its rules never decided that relation, so the case also allows `unknown`: the code tiers may
// hand it to the judge, but must not call it exact. The exception is a listing an owner's ruling
// decides (another-line-silk, the ruling of 2026-11-23): the rules must reject it.
import {
  REVIEW_RULE,
  report,
  review,
  run,
  S54_JUDGE,
  SUFFIX_READING,
  SUFFIX_RULING,
  test,
} from '../../match-title-rules/evidence.ts';
import { asked, listing, type MatchCase } from '../contract.ts';

const RENAMED = 'test_the_product_under_another_stores_name_still_matches';
const STILL_ACCEPTED =
  "the predecessor's matcher still accepts it, so its rules never decided this; the code tiers " +
  'may leave it to the judge (unknown) but not call it exact';
const CLASS3_LEFT = report(
  'reports/2026-10-23-matching.md:214-221 (class 3 left alone: "needs brand-line knowledge")',
);
const CLASS2_LEFT = report(
  'reports/2026-10-23-matching.md:222-226 (class 2 leftovers: the Ender-5 Max at 68.6, the ' +
    'Powerbeats Pro 2 at 66.0)',
);
const SUNLU = 'SUNLU PLA+ 1.75mm 1kg';
const POLYTERRA = 'Polymaker PolyTerra PLA 1kg';

export const reviews: readonly MatchCase[] = [
  {
    id: 'open-box-in-the-title',
    what: 'the product sold open box: condition is not identity',
    input: {
      asked: asked('Bambu Lab A1 mini'),
      listing: listing('Bambu Lab A1 Mini 3D Printer, Bilingual packaging(Open Box)'),
    },
    expected: { relation: 'exact' },
    from: [test('test_matching.py', RENAMED, '[Bambu Lab A1 mini]'), REVIEW_RULE],
    label: 'a match (asserted); the review rule counts open box as the product',
  },
  {
    id: 'open-box-before-the-name',
    what: '"Open Box -" before the name, the included case after "with"',
    input: {
      asked: asked('Apple AirPods Pro 2'),
      listing: listing(
        'Open Box - Apple AirPods Pro (2nd generation) Noise Cancelling True Wireless Earbuds ' +
          'with USB-C MagSafe Charging Case',
      ),
    },
    expected: { relation: 'exact' },
    from: [test('test_matching.py', RENAMED, '[Apple AirPods Pro 2]'), REVIEW_RULE],
    label: 'a match (asserted); the review rule counts open box as the product',
  },
  {
    id: 'a-colour-the-query-does-not-name',
    what: 'one colour of the asked filament, the query naming none',
    input: { asked: asked(POLYTERRA), listing: listing('Polymaker - PolyTerra PLA 1KG (Green)') },
    expected: { relation: 'exact' },
    from: [
      REVIEW_RULE,
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-phase5-review.json polyterra-pla: bestbuyca not rejected; ' +
          'its rows are PolyTerra PLA 1KG in green, white and grey',
      },
      run('score = 100.0'),
      S54_JUDGE,
    ],
    label:
      'the review rule counts "any colour or finish"; S§5.4: a missing attribute is not a ' +
      'conflict, and the query names no colour',
  },
  {
    id: 'a-colour-and-a-range-name',
    what: 'the pitcher in red, with its range name (Huron) and the filter it comes with',
    input: {
      asked: asked('Brita Large 10 Cup Water Filter Pitcher'),
      listing: listing(
        'Brita Large 10 Cup Water Filter Pitcher with 1 Standard Filter, Made Without BPA, Huron, ' +
          'Red',
      ),
    },
    expected: { relation: 'exact' },
    from: [
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "brita-10-cup/walmart [is] the ' +
          'product" (Walmart\'s one row in the rerun)',
      },
      run('score = 100.0'),
    ],
    label: "the rerun's review checked Walmart fresh and found it the product",
  },
  {
    id: 'store-leaves-out-the-brand',
    what: 'the maker\'s own store writes "K1C 3D Printer", no brand',
    input: { asked: asked('Creality K1C'), listing: listing('K1C 3D Printer') },
    expected: { relation: 'exact' },
    from: [
      review(
        'phase5',
        'k1c',
        'creality',
        'catalog: accessories hub (the web read the K1C itself)',
        ['before'],
      ),
      run('score = 92.0'),
    ],
    label: 'the review says the web read (this row) is the K1C itself',
  },
  {
    id: 'the-product-beside-a-part',
    what: 'the K1C itself, from the store whose other row is a mainboard kit',
    input: {
      asked: asked('Creality K1C'),
      listing: listing('Creality K1C 3D Printer Support Carbon Fiber Filament Auto Leveling'),
    },
    expected: { relation: 'exact' },
    from: [
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "k1c/amazon (the K1C beside a ' +
          'mainboard kit)"',
      },
      run('score = 100.0'),
    ],
    label: 'the review names this row the K1C, beside the kit (match-title-rules)',
  },
  {
    id: 'the-bare-board-not-a-kit',
    what: 'the bare Pi 5 8GB, from the store whose catalog rows were kits',
    input: {
      asked: asked('Raspberry Pi 5 8GB'),
      listing: listing(
        'Raspberry Pi 5 8GB 2023 - Newest 2.4 GHz 64-bit Quad Core ARM Processor, Dual-Band ' +
          '802.11ac Wi-Fi, Bluetooth 5.0',
      ),
    },
    expected: { relation: 'exact' },
    from: [
      review(
        'phase5',
        'raspberry-pi-5',
        'amazon',
        'catalog: kits only (the web read the bare Pi 5 8GB)',
        ['before'],
      ),
      run('score = 100.0'),
    ],
    label: 'the review says the web read (this row) is the bare Pi 5 8GB',
  },
  {
    id: 'model-code-hx6810-50',
    what: 'the ProtectiveClean 4100 with its model code HX6810/50',
    input: {
      asked: asked('Philips Sonicare ProtectiveClean 4100'),
      listing: listing(
        'Philips Sonicare ProtectiveClean 4100 Rechargeable Electric Toothbrush - Black - ' +
          'HX6810/50',
      ),
    },
    expected: { relation: 'exact' },
    from: [
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "sonicare-4100/bestbuyca (Best ' +
          'Buy\'s Sonicare 4100 HX6810/50 in the catalog too)"',
      },
      run('score = 100.0'),
    ],
    label: "the rerun's review names this listing the product",
  },
  {
    id: 'model-code-hx6810',
    what: 'the ProtectiveClean 4100 as Walmart writes it, model code HX6810',
    input: {
      asked: asked('Philips Sonicare ProtectiveClean 4100'),
      listing: listing(
        'Philips Sonicare ProtectiveClean 4100 Plaque Control Rechargeable Electric Toothbrush, ' +
          'Black, HX6810',
      ),
    },
    expected: { relation: 'exact' },
    from: [
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "sonicare-4100/walmart [is] the ' +
          'product" (Walmart\'s one row in the rerun)',
      },
      run('score = 100.0'),
    ],
    label: "the rerun's review checked Walmart fresh and found it the product",
  },
  {
    id: 'variant-counted-by-the-hand-check',
    what: 'the Bluetooth Edition (no USB receiver) for the MX Master 3S',
    input: {
      asked: asked('Logitech MX Master 3S'),
      listing: listing('MX Master 3S Bluetooth Edition Wireless Mouse No USB - Graphite'),
    },
    expected: { relation: 'variant' },
    from: [
      test('test_matching.py', RENAMED, '[Logitech MX Master 3S]'),
      report(
        'reports/2026-10-14-web-discovery.md:119-120 ("Variant, counted (1)": logitech.com "MX ' +
          'Master 3S Bluetooth Edition", "the same mouse sold without the USB receiver")',
      ),
      report(
        "docs/plans/2026-10-14-browser-agent-progress.md:3563 (\"'edition' is not a variant " +
          'word); the strict 6 stands")',
      ),
      run('score = 65.45'),
      S54_JUDGE,
    ],
    label:
      'the Phase 1 hand check names it a variant ("the same mouse sold without the USB receiver"); ' +
      'S§5.4: variants in configuration are not matches',
    divergence:
      'The predecessor counted it as the product (the hand check "Variant, counted"; the test ' +
      'asserts a score at or over 65). S§5.4: a variant is not a match.',
  },
  {
    id: 'a-pulley-of-the-brand',
    what: 'a motor drive pulley sold under the brand',
    input: {
      asked: asked('Bambu Lab P1S Combo'),
      listing: listing('Bambu Lab Motor Drive Pulley'),
    },
    expected: { relation: 'accessory_or_part' },
    from: [
      review('phase5', 'p1s-combo', 'nex3d.com', 'P1S without the AMS, a pulley'),
      run('accessory_for = True, score = 39.0'),
    ],
    label: 'the review calls it a pulley, a part; the predecessor rejects it as one',
  },
  {
    id: 'another-model-letter-designator',
    what: 'the Kobra S1 Combo for a Kobra 3 Combo query',
    input: {
      asked: asked('Anycubic Kobra 3 Combo'),
      listing: listing(
        'Kobra S1 Combo 3D Printer, 4 Stunning Multicolor with Anycubic ACE PRO, 600mm/s High ' +
          'Speed and 320℃ Hotend Free-Clog Extruder, Intelligent Drying While Printing, Built-in ' +
          'Camera 250*250*250mm',
      ),
    },
    expected: { relation: 'other_model' },
    from: [
      review('phase5', 'kobra-3-combo', 'amazon', 'Kobra S1 Combo (another model)'),
      report(
        "reports/2026-10-14-web-discovery.md:135-137 (Amazon's Kobra S1 Combo was accepted for " +
          '"Kobra 3 Combo": "no model token in \'Kobra 3\'")',
      ),
      run('score = 55.89'),
    ],
    label: 'the review labels it another model; the 2026-10-23 matcher rejects it',
  },
  {
    id: 'another-line-of-the-brand-polylite',
    what: 'Polymaker PolyLite for a PolyTerra query',
    input: {
      asked: asked(POLYTERRA),
      listing: listing('Polymaker PolyLite PLA 3D Printer Filament 1KG 1.75mm'),
    },
    expected: { oneOf: ['other_line', 'unknown'] },
    from: [
      review(
        'phase5',
        'polyterra-pla',
        'west3d',
        'PolyLite, Panchroma Dual Matte and Gradient (other lines)',
      ),
      run('score = 72.0'),
      CLASS3_LEFT,
    ],
    label: `the review labels it another line; ${STILL_ACCEPTED}`,
  },
  {
    id: 'another-line-of-the-brand-panchroma',
    what: 'Polymaker Panchroma Dual Matte for a PolyTerra query',
    input: {
      asked: asked(POLYTERRA),
      listing: listing('Polymaker Panchroma Dual Matte PLA 3D Printer Filament 1KG 1.75mm'),
    },
    expected: { oneOf: ['other_line', 'unknown'] },
    from: [
      review(
        'phase5',
        'polyterra-pla',
        'west3d',
        'PolyLite, Panchroma Dual Matte and Gradient (other lines)',
      ),
      run('score = 69.55'),
      CLASS3_LEFT,
    ],
    label: `the review labels it another line; ${STILL_ACCEPTED}`,
  },
  {
    id: 'another-line-silk',
    what: 'SUNLU Silk PLA+ for a SUNLU PLA+ query',
    input: {
      asked: asked(SUNLU),
      listing: listing(
        'SUNLU Silk PLA+ Filament 1.75mm, 1kg (2.2lbs) Four Color PLA 3D Printer Filament, ' +
          'Dimensional Accuracy 1.75mm +/- 0.03mm, Red, Yellow, Green, Black',
      ),
    },
    expected: { oneOf: ['other_model', 'variant'] },
    from: [
      review(
        'phase5',
        'sunlu-pla-plus',
        'amazon',
        'catalog: matte PLA, PLA, Silk PLA+ (the web read SUNLU PLA+ 2.0 1 kg)',
        ['before'],
      ),
      review('phase5', 'sunlu-pla-plus', 'hobbywholesale.com', 'SUNLU Silk PLA+ (another line)'),
      run('score = 100.0'),
      CLASS3_LEFT,
    ],
    label:
      'the review labels Silk PLA+ another line, and this is the example of ' +
      `${SUFFIX_RULING}; silk is a line, not a finish (${SUFFIX_READING}). The ruling names the ` +
      'pair and does not choose between them; before it the case expected other_line or unknown',
    divergence:
      "The predecessor's matcher accepts it as the product (score 100), so its rules never " +
      "decided it. The case follows the owner's ruling of 2026-11-23: a decided rejection, never " +
      'exact.',
  },
  {
    id: 'another-brand-same-grade',
    what: 'eSUN PLA+ for a SUNLU PLA+ query',
    input: {
      asked: asked(SUNLU),
      listing: listing('eSUN PLA+ Filament 1.75mm 1kg - 40 Colors Available'),
    },
    expected: { oneOf: ['other_line', 'unknown'] },
    from: [
      review('phase5', 'sunlu-pla-plus', 'digitmakers', 'eSUN filament'),
      run('score = 74.12'),
      CLASS3_LEFT,
    ],
    label: `another brand, which the predecessor files with other lines (class 3); ${STILL_ACCEPTED}`,
  },
  {
    id: 'a-tool-for-the-material',
    what: 'a SUNLU filament splicer for a SUNLU PLA+ query',
    input: {
      asked: asked(SUNLU),
      listing: listing(
        'Sunlu Filament Connector FC01, Fusion Splicer, Weldable to 1.75mm PLA, ABS, PETG',
      ),
    },
    expected: { oneOf: ['accessory_or_part', 'other_line'] },
    from: [
      review('phase5', 'sunlu-pla-plus', 'caz3d.com', 'filament splicer, eSUN filament'),
      run('score = 44.0'),
    ],
    label:
      'the review rejects it as a filament splicer: a tool used with the product or another ' +
      'product line of the brand; the evidence does not choose',
  },
  {
    id: 'another-brand-no-asked-word',
    what: "Creality's Ender PLA for a SUNLU PLA+ query",
    input: { asked: asked(SUNLU), listing: listing('Ender PLA Filament 1.75mm 1kg/Spool') },
    expected: { relation: 'other_line' },
    from: [
      review('phase5', 'sunlu-pla-plus', 'creality3dofficial.com', 'Creality Ender PLA'),
      run('score = 40.76'),
    ],
    label:
      "another brand's filament, which the predecessor files with other lines (class 3); its " +
      'matcher rejects it',
  },
  {
    id: 'a-kit-around-the-board',
    what: 'a Pi 5 8GB "Basic Kit" for the bare board',
    input: {
      asked: asked('Raspberry Pi 5 8GB'),
      listing: listing('Raspberry Pi 5 Basic Kit (8GB RAM | NO SD Card)'),
    },
    expected: { oneOf: ['bundle', 'unknown'] },
    from: [
      review(
        'phase5',
        'raspberry-pi-5',
        'amazon',
        'catalog: kits only (the web read the bare Pi 5 8GB)',
        ['before'],
      ),
      REVIEW_RULE,
      run('score = 100.0'),
    ],
    label: `the review rejects kits, and the rule names a kit with bundles; ${STILL_ACCEPTED}`,
  },
  {
    id: 'another-power-bank-of-the-line',
    what: 'the PowerCore 10K for the 737 PowerCore 24K',
    input: {
      asked: asked('Anker 737 Power Bank PowerCore 24K'),
      listing: listing(
        'Anker PowerCore 10,000 mAh Redux, 10K Power Bank USB-C Power Delivery (18W) Portable ' +
          'Charger for iPhone 15/15 Plus/15 Pro/15 Pro Max, iPhone 14/13/12 Series, Samsung S10, ' +
          'Pixel 3/3XL, iPad Pro 2018',
      ),
    },
    expected: { relation: 'other_model' },
    from: [
      review('phase5', 'anker-737', 'shoppurilite.ca', 'PowerCore 10K (another power bank)'),
      run('score = 50.11'),
    ],
    label: 'the review labels it another power bank of the same brand: another model',
  },
  {
    id: 'a-look-alike-of-another-brand',
    what: 'a "Silver crest Instant Cooker Pot Duo 7-in-1" for the Instant Pot Duo',
    input: {
      asked: asked('Instant Pot Duo 7-in-1 6 Quart'),
      listing: listing(
        // Two spaces after "crest", as the store wrote it.
        '5L 6L Silver crest  Instant Cooker Pot Duo 7-in-1 Stainless Steel Electric Pressure ' +
          'Cooker Silver crest Rice Cooker',
      ),
    },
    expected: { oneOf: ['other_line', 'other_model', 'unknown'] },
    from: [
      review(
        'phase5',
        'instant-pot-duo',
        'aliexpress',
        'a look-alike ("Silver crest Instant Cooker Pot Duo")',
      ),
      run('score = 85.33'),
    ],
    label:
      `a look-alike: MATCH_RELATIONS has no such label, and another brand or another model the ` +
      `evidence does not choose; ${STILL_ACCEPTED}`,
  },
  {
    id: 'a-look-alike-jug',
    what: 'a 3.5 L Marella jug for the Large 10 Cup pitcher',
    input: {
      asked: asked('Brita Large 10 Cup Water Filter Pitcher'),
      listing: listing(
        '3.5L BRITA Marella Ocean Series Filter Water Jug Large Capacity Household Tap Water ' +
          'Filter Pitcher Multilingual Manual',
      ),
    },
    expected: { oneOf: ['other_line', 'other_model', 'unknown'] },
    from: [
      review('phase5', 'brita-10-cup', 'aliexpress', 'a 3.5 L Marella jug, a look-alike'),
      run('score = 79.84'),
    ],
    label:
      `the review calls it a look-alike; another line or another model the evidence does not ` +
      `choose; ${STILL_ACCEPTED}`,
  },
  {
    id: 'another-brand-same-designator',
    what: 'Powerbeats Pro 2 for AirPods Pro 2: they share "Pro 2"',
    input: {
      asked: asked('Apple AirPods Pro 2'),
      listing: listing(
        'Powerbeats Pro 2 Wireless Bluetooth Earbuds - Noise Cancelling, Heart Rate Monitor, ' +
          'IPX4, Up to 45H Battery & Charging Case, Works with Apple & Android - Quick Sand',
      ),
    },
    expected: { oneOf: ['other_line', 'other_model', 'unknown'] },
    from: [
      review('phase5', 'airpods-pro-2', 'amazon', 'AirPods Pro 3, Powerbeats Pro 2'),
      run('score = 66.0'),
      CLASS2_LEFT,
    ],
    label:
      `rejected by the review without a class; another line or another model the evidence does ` +
      `not choose; ${STILL_ACCEPTED}`,
  },
  {
    id: 'another-printer-of-the-brand',
    what: 'the Creality Ender-5 Max for a K1C query',
    input: { asked: asked('Creality K1C'), listing: listing('Creality Ender-5 Max 3D Printer') },
    expected: { oneOf: ['other_model', 'unknown'] },
    from: [
      review('matching', 'k1c', 'rona.ca', 'Ender-5 Max (another printer)'),
      run('score = 68.57'),
      CLASS2_LEFT,
    ],
    label: `the rerun's review labels it another printer: another model; ${STILL_ACCEPTED}`,
  },
];
