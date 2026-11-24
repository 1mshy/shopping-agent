// The identifiers a listing states (its MPN or model number, its canonical URL's path) against
// the model number in what was asked. Ported from the predecessor's recipe title check
// (recipes._title_check and _names_the_product, tests/test_title_check.py), reduced to the
// listing fields a reader produces: which places on a page count as the page's own (canonical vs
// fetched URL, the first "Model #" label under the <h1>, the page's own JSON-LD Product) is the
// readers' business and is not ported here.
//
// The predecessor had no GTIN rule at all (no check digit, no GTIN equality; recipes.py:899 lists
// gtin fields as places a model number may appear, and no model-number pattern matches a bare
// GTIN), so no case here tests a GTIN. It had no brand + MPN equality on structured fields either:
// its query was one string, so these cases set only `asked.name`.
//
// A model number in the URL path is supporting evidence, never identity on its own (settled by
// the orchestrator 2026-11-23, the owner may overrule): the two cases where the predecessor
// accepted a listing on its URL alone now expect `unknown`, and a stated model number (MPN or
// title) wins over the URL.
import { code, S54_JUDGE, spec, test, URL_SETTLED } from '../../match-title-rules/evidence.ts';
import { asked, listing, type MatchCase, NOT_EXACT } from '../contract.ts';

const RONA_URL =
  'https://www.rona.ca/en/product/dewalt-20-v-max-brushless-compact-drill-driver-kit-with-' +
  'battery-charger-dcd793d1-00277649';
const RONA_NAME = 'DEWALT 20 V MAX Brushless Compact Drill/Driver Kit with Battery/Charger';
const HH_URL =
  'https://www.homehardware.ca/en/20v-max-12-lithium-ion-cordless-compact-driver-drill-kit-with-' +
  'battery-charger-tool-bag/p/1239024';
const HH_NAME =
  'DEWALT 20V Max 1/2" Lithium-ion Cordless Compact Driver Drill Kit - with Battery, Charger, & ' +
  'Tool Bag';

const TC = 'test_title_check.py';
const NAMES = code(
  'pricewatch/src/pricewatch/recipes.py:1052-1088 (_names_the_product: accepted when every model ' +
    "designator of the query is the page's own and the title carries the query's other words; " +
    'refused when a place that states a model states only other ones)',
);
const VARIANT_IN = code(
  'pricewatch/src/pricewatch/recipes.py:887-894 (_variant_in: a variant word right after a query ' +
    'word in a slug or part number)',
);
const TIER1 = spec('S§5.4 tier 1: "normalised brand + MPN equality"');
const URL_RULE =
  `${URL_SETTLED}. The predecessor read model numbers and variant words from the listing's own ` +
  'URL path (recipes.py:958-971, 985-991) and accepted a listing on the URL alone';
const URL_ONLY_LABEL =
  'the predecessor accepted it (asserted) because the model number is in the URL path; the ' +
  'title names no model and the listing states no MPN, so the URL is the only identity ' +
  'evidence. Under the settled rule it supports but cannot establish identity: no rejection is ' +
  'true either, so the code tiers leave it to the judge (who is not shown the URL): unknown';
const COMBO =
  'near_miss (asserted) names "combo"; the 2026-10-23 report calls Combo listings bundles and the ' +
  'predecessor treats the word as a variant word, so bundle or variant (see match-owner-rulings)';

export const identifiers: readonly MatchCase[] = [
  {
    id: 'mpn-equals-the-asked-model',
    what: "the listing's MPN is the query's model number; the title has the brand only",
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT Drill kit', { mpn: 'DCD793D1' }),
    },
    expected: { relation: 'exact' },
    from: [
      test(TC, 'test_the_structured_mpn', '(accepted)'),
      test(TC, 'test_an_at_graph_product_counts', '(accepted; the model given as a ProductModel)'),
      NAMES,
      TIER1,
    ],
    label:
      "accepted (asserted): the query's model number is the listing's own and the title carries " +
      "the query's other word, the brand",
  },
  {
    id: 'model-label-equals-the-asked-model',
    what: 'a name without the model number, whose page states the model number as its own',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing(HH_NAME, { mpn: 'DCD793D1', url: HH_URL }),
    },
    expected: { relation: 'exact' },
    from: [
      test(TC, 'test_home_hardware_its_visible_model_label', '(five label forms, all accepted)'),
      NAMES,
      TIER1,
    ],
    label:
      'accepted (asserted) once the page\'s "Model #" label is read as its own model number; the ' +
      "five label spellings are the reader's concern",
  },
  {
    id: 'mpn-with-a-variant-suffix',
    what: 'the MPN is the model number plus "-COMBO"',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT Drill kit', { mpn: 'DCD793D1-COMBO' }),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [test(TC, 'test_a_variant_in_the_structured_mpn_is_a_near_miss'), VARIANT_IN],
    label: COMBO,
  },
  {
    id: 'mpn-of-another-model-over-the-url',
    what: "the MPN states another model; the URL's slug names the asked one",
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT 20V MAX Drill Kit', {
        mpn: 'DCD798D1',
        url: 'https://www.example.ca/en/product/dewalt-dcd793d1-12345',
      }),
    },
    expected: { relation: 'other_model' },
    from: [
      test(
        TC,
        'test_another_model_in_a_name_or_the_mpn_is_not_overridden',
        '(second assertion: structured mpn DCD798D1, refused)',
      ),
      NAMES,
    ],
    label:
      'refused (asserted) by "the matcher\'s clash rule" (module docstring: "named ... as another ' +
      'model"): a stated model number that is only another one is another model; the URL that ' +
      `names the asked one is supporting evidence only (${URL_SETTLED})`,
  },
  {
    id: 'model-label-of-another-model',
    what: "the page's own model number is a sibling's (DCD798D1)",
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing(HH_NAME, { mpn: 'DCD798D1', url: HH_URL }),
    },
    expected: { relation: 'other_model' },
    from: [test(TC, 'test_another_model_on_the_page_is_still_refused'), NAMES],
    label: 'refused (asserted) by the clash rule: the page states another model number',
  },
  {
    id: 'same-model-number-other-brand',
    what: "the model number matches, the brand does not (Milwaukee asked, DEWALT's page)",
    input: {
      asked: asked('milwaukee dcd793d1'),
      listing: listing(RONA_NAME, { mpn: 'DCD793D1', url: RONA_URL }),
    },
    expected: { oneOf: ['other_line', 'other_model'] },
    from: [
      test(
        TC,
        'test_the_model_alone_does_not_excuse_another_brand',
        '(refused; in the test the label sits under an empty <h1> and is not read, so the ' +
          'listing MPN here comes from reading _names_the_product: with it, the title must still ' +
          'carry "milwaukee")',
      ),
      NAMES,
      TIER1,
    ],
    label:
      'refused: another brand with the same model number is not the product; the predecessor ' +
      'files another brand with another line (class 3, "another line or brand") but the ' +
      'evidence does not fix the label',
  },
  {
    id: 'model-word-without-digits',
    what: 'the query\'s model has no digit ("k-mini"); the page states it as its model',
    input: {
      asked: asked('keurig k-mini'),
      listing: listing('Single Serve Coffee Maker', {
        mpn: 'K-MINI',
        url: 'https://www.keurig.ca/p/k-mini',
      }),
    },
    expected: { oneOf: NOT_EXACT },
    from: [
      test(TC, 'test_a_query_with_no_model_number_needs_its_words', '(refused title_mismatch)'),
      code('pricewatch/src/pricewatch/matching.py:33 (_MODEL_RE needs a digit)'),
      TIER1,
    ],
    label:
      "refused (asserted): the title carries none of the query's words; nothing names the brand, " +
      'so brand + MPN equality cannot hold; not exact, relation not given',
  },
  {
    id: 'url-path-names-the-model',
    what: 'a Shopify handle names the model; the title does not; "600mm/s" is not a model',
    input: {
      asked: asked('creality k1c'),
      listing: listing('Creality Fast 3D Printer, 600mm/s', {
        url: 'https://www.creality3dofficial.com/products/creality-k1c-3d-printer',
      }),
    },
    expected: { relation: 'unknown' },
    from: [
      test(TC, 'test_a_platform_page_by_its_url', '(accepted)'),
      test(TC, 'test_a_measurement_is_not_a_model', '(accepted)'),
      NAMES,
    ],
    label: `${URL_ONLY_LABEL}; "600mm/s" is still not a model (asserted)`,
    divergence: `${URL_RULE}; the case expected exact before the rule was settled.`,
  },
  {
    id: 'canonical-url-names-the-model',
    what: "the store's canonical URL names the model; its product name leaves it out",
    input: { asked: asked('dewalt dcd793d1'), listing: listing(RONA_NAME, { url: RONA_URL }) },
    expected: { relation: 'unknown' },
    from: [test(TC, 'test_rona_the_model_in_its_canonical_url_alone_is_enough'), NAMES],
    label:
      `${URL_ONLY_LABEL}; the same title without the URL is unknown in match-title-rules ` +
      'title-without-the-model-number',
    divergence: `${URL_RULE}; the case expected exact before the rule was settled.`,
  },
  {
    id: 'url-path-names-a-variant',
    what: 'a Shopify handle "creality-k1c-combo" for "creality k1c"',
    input: {
      asked: asked('creality k1c'),
      listing: listing('Creality Fast 3D Printer, 600mm/s', {
        url: 'https://www.creality3dofficial.com/products/creality-k1c-combo',
      }),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [test(TC, 'test_a_variant_in_a_shopify_handle_is_a_near_miss'), VARIANT_IN],
    label: COMBO,
    specSilent: true,
  },
  {
    id: 'canonical-slug-names-a-variant',
    what: 'the canonical slug says "dcd793d1-combo-kit"',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT 20V MAX Compact Drill/Driver Kit', {
        url: 'https://www.rona.ca/en/product/dewalt-dcd793d1-combo-kit-00277650',
      }),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [test(TC, 'test_a_variant_in_a_canonical_slug_is_a_near_miss'), VARIANT_IN],
    label: COMBO,
    specSilent: true,
  },
  {
    id: 'title-model-beats-the-url',
    what: 'the title names another model; the URL slug names both',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT DCD798D1 20V MAX Hammer Drill Kit', {
        url: 'https://www.example.ca/en/product/dewalt-dcd793d1-dcd798d1-compare-12345',
      }),
    },
    expected: { relation: 'other_model' },
    from: [test(TC, 'test_another_model_in_the_engines_title_is_not_overridden_by_the_url'), NAMES],
    label:
      'refused (asserted); the docstring: "DCD798D1 in the product\'s name is another product, ' +
      `whatever its URL says"; the URL is supporting evidence only (${URL_SETTLED})`,
  },
  {
    id: 'url-names-the-model-only-after-for',
    what: 'a chuck whose slug names the model only after "for"',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT Replacement Keyless Chuck', {
        url: 'https://www.example.ca/en/product/dewalt-replacement-keyless-chuck-for-dcd793d1-0099',
      }),
    },
    expected: { oneOf: ['accessory_or_part', 'unknown'] },
    from: [
      test(
        TC,
        'test_an_accessory_that_names_the_tool_it_fits_is_not_the_tool',
        '(first assertion)',
      ),
      code(
        'pricewatch/src/pricewatch/recipes.py:918-927 (_own_designators drops a model after "for")',
      ),
    ],
    label:
      'the docstring calls it an accessory that names the tool it fits, so the truth is ' +
      'accessory_or_part; the predecessor refused it for want of the model (title_mismatch), so ' +
      'its rules did not decide the relation and a rules tier may leave it unknown',
    specSilent: true,
  },
  {
    id: 'neither-title-nor-url-names-the-model',
    what: 'a hammer drill kit whose own canonical URL names no model',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT 20V MAX Hammer Drill Kit', {
        url: 'https://www.homehardware.ca/en/20v-max-hammer-drill-kit/p/9999999',
      }),
    },
    expected: { oneOf: NOT_EXACT },
    from: [
      test(
        TC,
        'test_the_url_it_was_fetched_at_is_not_the_pages_word',
        "(second assertion: the canonical is the page's own and names no model; refused)",
      ),
      S54_JUDGE,
    ],
    label:
      'refused (asserted) for want of the model; nothing says which product it is, so any label ' +
      'but exact',
  },
  {
    id: 'model-code-written-without-dashes',
    what: 'Sony writes the model "WHCH520/B" where the query says "wh-ch520"',
    input: {
      asked: asked('sony wh-ch520'),
      listing: listing('WH-CH520 Wireless Headphones', {
        mpn: 'WHCH520/B',
        url: 'https://www.sony.ca/en/audio/headphones/p/whch520-b',
      }),
    },
    expected: { relation: 'exact' },
    from: [
      test(
        TC,
        'test_sonys_bare_model_code_is_the_same_model_as_the_query',
        '(first assertion, accepted; the test passes "WHCH520/B" as the name the engine read and ' +
          '"WH-CH520 Wireless Headphones" as the page\'s <h1>; here the <h1> is the title and the ' +
          'code the MPN)',
      ),
      code(
        'pricewatch/src/pricewatch/recipes.py:930-937 (_model_numbers also reads a model with the ' +
          'dash between two letters dropped)',
      ),
      TIER1,
    ],
    label:
      'accepted (asserted); the docstring: "Not a clash: its <title> names the product". The ' +
      'MPN normalises to the same model once dashes and the "/B" suffix are set aside',
  },
  {
    id: 'model-code-of-the-previous-generation',
    what: 'a WH-1000XM4 page for a "sony wh-1000xm5" query',
    input: {
      asked: asked('sony wh-1000xm5'),
      listing: listing('WH-1000XM4 Wireless Noise Cancelling Headphones', {
        mpn: 'WH1000XM4/B',
        url: 'https://www.sony.ca/en/audio/headphones/p/wh1000xm4-b',
      }),
    },
    expected: { relation: 'other_model' },
    from: [
      test(
        TC,
        'test_sonys_bare_model_code_is_the_same_model_as_the_query',
        '(second assertion, refused; the title here is the page\'s <title> without " | Sony CA", ' +
          'the MPN the name the engine read)',
      ),
      NAMES,
    ],
    label: 'refused (asserted) by the clash rule: every stated model number is another one',
  },
];
