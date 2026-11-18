// Known failure: wrong variant (plan P0 workstream 3), the matching half. Each case is a listing
// the predecessor's engine accepted as the product although it differs in configuration, capacity,
// size or pack count, as its own hand checks found. The engine's acceptance is shown by the row
// being in a run's results (the eval JSON lists only rows the matcher kept). Whether the 2026-10-23
// matcher still accepts it is stated from an offline run.
//
// Reading failures (the right listing, another variant's price attached, S§5.2 "Variant
// coupling") are not here: they belong to the Phase 1 readers unit.
import {
  REVIEW_RULE,
  report,
  review,
  run,
  S54_JUDGE,
  test,
} from '../../match-title-rules/evidence.ts';
import { asked, listing, type MatchCase } from '../contract.ts';

function accepted(file: string, path: string): ReturnType<typeof report> {
  return report(
    `reports/${file} ${path} (a row the engine kept, so accepted as the product: rows reach the ` +
      "results through matching.rank / score at the caller's floor, reports/2026-10-23-" +
      'matching.md:184-191)',
  );
}

const BRITA = 'Brita Large 10 Cup Water Filter Pitcher';
const CAPACITY = spec54('capacity');

function spec54(what: string) {
  return {
    kind: 'spec' as const,
    ref: `docs/spec.md S§5.4: "variants in size, colour, capacity, configuration or pack count are not matches" (here: ${what})`,
  };
}

export const wrongVariant: readonly MatchCase[] = [
  {
    id: 'printer-without-the-ams-for-the-combo',
    what: 'the P1S alone accepted for the P1S Combo; on a watch it would have read as a 48% drop',
    input: { asked: asked('Bambu Lab P1S Combo'), listing: listing('Bambu Lab P1S Printer') },
    expected: { relation: 'variant' },
    from: [
      accepted('2026-10-14-web-discovery.json', '$.products[0].web_results[6] (nex3d.com)'),
      accepted('2026-10-23-phase5-evaluation.json', '$.products[0].learned_results[2] (nex3d.com)'),
      report(
        'reports/2026-10-14-web-discovery.md:113-118 ("Wrong product": nex3d.com "Bambu Lab P1S ' +
          'Printer", "the printer without the AMS"; cause: "combo is a stopword")',
      ),
      report(
        'reports/2026-10-14-web-discovery.md:308-311 ("on a watch, that near-miss would have ' +
          'read as a 48% drop")',
      ),
      review('phase5', 'p1s-combo', 'nex3d.com', 'P1S without the AMS, a pulley'),
      run('score = 55.0: rejected since 51db126'),
      spec54('configuration'),
    ],
    label:
      'the hand checks call it the printer without the AMS: another configuration of the asked ' +
      'product, a variant (see match-owner-rulings combo-asked-listing-without-the-ams)',
  },
  {
    id: 'edition-without-the-receiver',
    what: 'the MX Master 3S Bluetooth Edition (no USB receiver) counted as the MX Master 3S',
    input: {
      asked: asked('Logitech MX Master 3S'),
      listing: listing('MX Master 3S Bluetooth Edition'),
    },
    expected: { relation: 'variant' },
    from: [
      accepted('2026-10-14-web-discovery.json', '$.products[7].web_results[5] (logitech.com)'),
      accepted('2026-10-23-matching-eval.json', '$.products[7].web_results[5] (logitech.com)'),
      report(
        'reports/2026-10-14-web-discovery.md:119-120 ("Variant, counted (1)": "the same mouse ' +
          'sold without the USB receiver")',
      ),
      report(
        "docs/plans/2026-10-14-browser-agent-progress.md:3563 (logitech.com's sample is the " +
          'Bluetooth Edition; "\'edition\' is not a variant word")',
      ),
      run('score = 71.16: still accepted at 51db126'),
      spec54('configuration'),
    ],
    label: 'the Phase 1 hand check names it a variant; S§5.4: a variant is not a match',
    divergence:
      'The predecessor accepts it (71.16 at 51db126) and its hand check counted it. S§5.4: ' +
      'variants in configuration are not matches.',
    ownerCheck:
      'The hand check counted the receiver-less edition. Confirm it is a variant for a query that ' +
      'does not name the receiver.',
  },
  {
    id: 'six-cup-for-ten-cup',
    what: 'the Small 6 Cup pitcher accepted for the Large 10 Cup',
    input: {
      asked: asked(BRITA),
      listing: listing(
        'Brita Small 6 Cup Water Filter Pitcher with 1 Brita Standard Filter, Made Without BPA, ' +
          'Black',
      ),
    },
    expected: { relation: 'variant' },
    from: [
      accepted(
        '2026-10-23-phase5-evaluation.json',
        '$.products[19].learned_results[2] (shoppurilite.ca)',
      ),
      review('phase5', 'brita-10-cup', 'shoppurilite.ca', '6-cup pitcher'),
      REVIEW_RULE,
      test('test_matching.py', 'test_another_model_of_the_family_is_not_the_product', `[${BRITA}]`),
      report('reports/2026-10-23-matching.md:78-80 ("10 cup" vs "6 cup" now clash)'),
      CAPACITY,
    ],
    label:
      'the review rejects it under "another capacity or size"; S§5.4 calls a capacity difference ' +
      'a variant',
  },
  {
    id: 'six-cup-space-saver-for-ten-cup',
    what: 'the 6 Cup Space Saver pitcher accepted for the Large 10 Cup',
    input: {
      asked: asked(BRITA),
      listing: listing(
        'Brita Space Saver Water Filter Pitcher with 1 Standard Filter, 6 Cup - White',
      ),
    },
    expected: { oneOf: ['variant', 'other_model'] },
    from: [
      accepted(
        '2026-10-23-phase5-evaluation.json',
        '$.products[19].learned_results[1] (staples.ca)',
      ),
      review('phase5', 'brita-10-cup', 'staples.ca', '6-cup Space Saver pitcher'),
      REVIEW_RULE,
      run('score = 52.02: rejected since 51db126'),
      CAPACITY,
    ],
    label:
      'rejected for its capacity (6 cup) and it carries another range name (Space Saver): a ' +
      'variant or another model, which the evidence does not choose',
  },
  {
    id: 'larger-air-fryer-for-the-model',
    what: 'the 5.5 qt Air Fryer XL (AF150) accepted for the AF101',
    input: {
      asked: asked('Ninja AF101 Air Fryer'),
      listing: listing('Ninja 5.5qt Air Fryer XL - Black/Grey'),
    },
    expected: { relation: 'other_model' },
    from: [
      accepted(
        '2026-10-23-phase5-evaluation.json',
        '$.products[15].learned_results[2] (staples.ca)',
      ),
      review('phase5', 'ninja-af101', 'staples.ca', '5.5 qt Air Fryer XL (AF150, another model)'),
      test(
        'test_matching.py',
        'test_another_model_of_the_family_is_not_the_product',
        '[Ninja AF101 Air Fryer]',
      ),
      report('reports/2026-10-23-matching.md:63-70 ("Air Fryer XL" for the AF101, a variant word)'),
    ],
    label: 'a size difference, but the review names it another model (the AF150), so other_model',
  },
  {
    id: 'four-spool-pack-for-one-spool',
    what: 'a 4 kg pack (4 x 1 kg) accepted for a 1 kg spool, still accepted after the fix',
    input: {
      asked: asked('SUNLU PLA+ 1.75mm 1kg'),
      listing: listing(
        'SUNLU PLA+2.0 3D Printer Filament Refill 1.75mm, 4KG, 1KG/Roll, Black*4 | Hig...Opens in ' +
          'a new window or tab',
      ),
    },
    expected: { oneOf: ['variant', 'unknown'] },
    from: [
      accepted('2026-10-23-phase5-evaluation.json', '$.products[6].catalog_results[13] (ebay)'),
      accepted('2026-10-23-matching-eval.json', '$.products[6].catalog_results[0] (ebay)'),
      review('phase5', 'sunlu-pla-plus', 'ebay', '4 kg and 10 kg packs, SUNLU PETG'),
      REVIEW_RULE,
      run('score = 100.0: still accepted at 51db126'),
      spec54('pack count'),
    ],
    label:
      'the review rejects the multi-pack; S§5.4 calls a pack-count difference a variant; the ' +
      "predecessor's matcher still accepts it, so its rules never decided this and a rules tier " +
      'may leave it to the judge, but not call it exact',
  },
  {
    id: 'sixteen-gb-kit-for-eight-gb-board',
    what: 'a Pi 5 16GB starter kit accepted for the Pi 5 8GB',
    input: {
      asked: asked('Raspberry Pi 5 8GB'),
      listing: listing(
        'iRasptek Starter Kit for Raspberry Pi 5 RAM 16GB - 256GB Edition of OS-Bookworm ' +
          'Pre-Installed (Aluminum Case)',
      ),
    },
    expected: { oneOf: ['bundle', 'variant'] },
    from: [
      accepted(
        '2026-10-23-phase5-evaluation.json',
        '$.products[12].learned_results[9] (shoppurilite.ca)',
      ),
      review(
        'phase5',
        'raspberry-pi-5',
        'shoppurilite.ca',
        'Raspberry Pi 4 kits, a 16 GB Pi 5 kit',
      ),
      run('accessory_for = True, score = 40.0: rejected since 51db126, but as an accessory'),
      CAPACITY,
      S54_JUDGE,
    ],
    label:
      'another capacity (16 GB for 8 GB) sold as a kit: a variant and a bundle at once, and the ' +
      'evidence does not say which label wins; not an accessory, whatever the 2026-10-23 matcher ' +
      'reads',
  },
];
