// Accessory and part rejects (S§5.4 tier 2). Rows of the predecessor's
// test_a_part_for_the_product_is_not_the_product (each asserts accessory_for(query, title) and a
// score under 60), with the hand-review label of the store where it names the row, plus the
// title-only parts of test_title_check and test_amazon that are accessories.
import { asked, type Evidence, listing, type MatchCase } from '../contract.ts';
import { code, report, review, run, S54_RULES, test } from '../evidence.ts';

const PART_LABEL =
  'the predecessor rejects it as a part, add-on or service for the product: accessory_for(query, ' +
  "title) is true (asserted) and caps the score at 40 (matching.py:225-238, 336-337); that is S§5.4's " +
  'accessory and part reject, accessory_or_part';

function part(
  id: string,
  what: string,
  query: string,
  title: string,
  extra: readonly Evidence[] = [],
  more: Partial<MatchCase> = {},
): MatchCase {
  return {
    id,
    what,
    input: { asked: asked(query), listing: listing(title) },
    expected: { relation: 'accessory_or_part' },
    from: [
      test('test_matching.py', 'test_a_part_for_the_product_is_not_the_product', `[${query}]`),
      ...extra,
      S54_RULES,
    ],
    label: PART_LABEL,
    ...more,
  };
}

const P1S = 'Bambu Lab P1S Combo';
const A1M = 'Bambu Lab A1 mini';
const K1C = 'Creality K1C';
const SATURN = 'Elegoo Saturn 4 Ultra';
const AIRPODS = 'Apple AirPods Pro 2';
const SONICARE = 'Philips Sonicare ProtectiveClean 4100';
const PI5 = 'Raspberry Pi 5 8GB';

export const accessories: readonly MatchCase[] = [
  part(
    'hotend-for-a-list-of-models',
    'a hotend "for" the printer: the model sits after "for" and none of it before',
    P1S,
    'DiamondBack HotEnd for Bambu Lab X1C, X1E, P1P & P1S',
    [review('phase5', 'p1s-combo', 'e3d', 'hotend')],
  ),
  part(
    'hotend-for-the-brand-only',
    'a hotend "for" the brand, the model not named at all',
    P1S,
    'Mako® 65W High-Power Hotend for Bambu Lab',
    [review('phase5', 'p1s-combo', 'slice', 'hotend')],
  ),
  part(
    'part-noun-heads-the-name',
    'the title is brand plus a part noun ("PTFE Tubes")',
    P1S,
    'Bambu Lab PTFE Tubes',
    [review('phase5', 'p1s-combo', 'voxelfactory', 'PTFE tubes')],
  ),
  part(
    'part-set-off-by-a-dash',
    'brand, dash, part: the dash-separated piece is judged on its own',
    P1S,
    'Bambu Lab - Engineering Plate',
    [review('phase5', 'p1s-combo', 'shop3d', 'build plate')],
  ),
  part(
    'stickers-anywhere-in-the-name',
    '"stickers" named anywhere in the product\'s own name',
    P1S,
    'Bambu Lab Stickers',
    [review('phase5', 'p1s-combo', 'bambulab', 'P1S without the AMS, stickers')],
  ),
  part(
    'antenna-dash-models-it-fits',
    'a part, then a dash and the models it fits',
    A1M,
    'Bambu Lab WiFi Antenna - P1 Series and A1 mini',
    [review('phase5', 'a1-mini', 'digitmakers', 'antenna, plate')],
  ),
  part(
    'board-for-a-series-names-the-model-in-brackets',
    'a replacement board "for" a series, the asked model only in the brackets',
    A1M,
    'Replacement Toolhead Board for Bambu Lab A1 Series 3D Printers (A1 and A1 Mini)',
    [
      review(
        'phase5',
        'a1-mini',
        'west3d',
        'only the A1 mini Combo (with AMS lite), a toolhead board',
      ),
    ],
  ),
  part(
    'plate-for-the-model',
    'a build plate "for" the model',
    A1M,
    'Bambu Smooth PEI Plate for A1 Mini',
    [review('phase5', 'a1-mini', '3dprintingcanada', 'hotend, the A1 Combo (not mini), a plate')],
  ),
  part(
    'plates-for-several-series',
    'plates named for several series, with a dash and a bracketed note',
    A1M,
    'Bambu Lab 3D Effect Plate X1 Series, P1 Series, A1 - (Various Sheets and Plates)',
    [review('phase5', 'a1-mini', 'digitmakers', 'antenna, plate')],
  ),
  part(
    'socks-for-or-models-pack-of-3',
    'silicone socks "for or" a list of models, sold as a pack',
    A1M,
    'Silicone Socks CHT High Flow Hotend for or Bambu Lab A1, H2, X2, P2 (Pack of 3)',
    [review('phase5', 'a1-mini', 'microswiss', 'hotend, silicone socks')],
  ),
  part(
    'cable-dash-model-it-fits',
    'a cable, then a dash and the model it fits',
    A1M,
    'Bambu USB-C Cable - A1 mini',
  ),
  part(
    'gears-by-a-maker',
    'extruder gears "by" another maker, the models listed before the part',
    K1C,
    'Creality K1, K1C & K1 Max Extruder Gears by Fysetc',
    [review('phase5', 'k1c', 'fabreeko', 'extruder gears')],
  ),
  part(
    'cables-for-newer-models',
    'adapter cables "for" a list of models',
    K1C,
    'Hotend Adapter Cables for newer Creality K1, K1 Max, K1C, and K1 SE',
    [review('phase5', 'k1c', 'microswiss', 'hotend, cables')],
  ),
  part(
    'official-build-plate-long-trailer',
    'an "Official" build plate whose name trails sizes, finishes and the models it fits',
    K1C,
    'Official Creality K1C Build Plate 235x235mm Textured PEI Sheet with Nozzle Cleaner Flexible ' +
      'Spring Steel Magnetic Platform Plate for K1/K1C/Ender 3',
    [review('phase5', 'k1c', 'amazon', 'build plate, hotend kit, power supply')],
  ),
  part(
    'power-supply-for-many-printers',
    'a power supply listing several printers before and after "for"',
    K1C,
    'Official K1/K1C/K1 SE/K2 SE 350W Power Supply, Original 3D Printer Switch Power Supply for ' +
      'Creality Ender 3 V3/ V3 SE/KE/ S1 Pro/S1 Plus/ V2/CR 10 SE',
    [review('phase5', 'k1c', 'amazon', 'build plate, hotend kit, power supply')],
  ),
  part(
    'nozzle-kit-after-the-model',
    'the model, then a nozzle kit as the head noun',
    K1C,
    'Official Creality K1C Unicorn Quick Swap Nozzle Kit',
    [review('phase5', 'k1c', '3dprintingcanada', 'build plates, nozzle kit')],
  ),
  part(
    'printer-touch-screen',
    '"3D Printer Touch Screen": the part is the head noun, the printer only qualifies it',
    K1C,
    'Creality K1C 3D Printer Touch Screen',
    [review('phase5', 'k1c', 'spool3d', 'print beds, touch screen')],
  ),
  part(
    'print-bed-dash-no-magnet',
    'a print bed, then a dash and a note',
    K1C,
    'Creality K1C 3D Printer Smooth PEI Flexible Spring Steel Print Bed - No Magnet',
    [review('phase5', 'k1c', 'spool3d', 'print beds, touch screen')],
  ),
  part(
    'accessories-hub',
    '"Accessories" named in the product\'s own name',
    K1C,
    'Creality K1 MAX/k1C/k1 Accessories Hub (Live Exclusive)|| Not All Universal',
    [
      review(
        'phase5',
        'k1c',
        'creality',
        'catalog: accessories hub (the web read the K1C itself)',
        ['before'],
      ),
    ],
  ),
  part(
    'a-workshop-is-a-service',
    'a hands-on workshop sold under the brand: a service, not the product',
    K1C,
    'Private Creality Hands-On Workshop',
    [
      review('phase5', 'k1c', 'voxelfactory', 'a workshop'),
      report('reports/2026-10-23-matching.md:110 (class 1 "accessory, part, service")'),
    ],
    {
      ownerCheck:
        'MATCH_RELATIONS has no label for a service; the predecessor files it with parts (class 1 ' +
        '"accessory, part, service"). Confirm accessory_or_part for services.',
    },
  ),
  part(
    'mainboard-kit-names-the-model',
    'a replacement mainboard kit for the model (found in the 2026-10-23 rerun)',
    K1C,
    'Creality K1C Original Replacement Silent Mainboard Kit, CR4CU220812S12 32 T2209 X2000E ' +
      'Motherboard',
    [
      {
        kind: 'review',
        ref:
          'scripts/eval/2026-10-23-matching-review.json "about": "k1c/amazon (the K1C beside a ' +
          'mainboard kit)": the store counts for its K1C row, not for the kit',
      },
    ],
  ),
  part(
    'lcd-screen-for-the-model',
    'an LCD screen "for" the model, a resolution after it',
    SATURN,
    'ELEGOO LCD Screen for Saturn 4 Ultra 16K',
    [review('phase5', 'saturn-4-ultra', '3dprintingcanada', 'LCD screens')],
  ),
  part(
    'resin-tank-after-the-model',
    'the full model name, then a part noun',
    SATURN,
    'Elegoo Saturn 4 Ultra Resin Tank',
    [review('phase5', 'saturn-4-ultra', 'spool3d', 'resin tank, LCD, build plate')],
  ),
  part(
    'film-pack-for-several-generations',
    'a film pack "for" several generations of the line',
    SATURN,
    'ELEGOO Saturn PFA Film Replacement (5pcs) for Saturn 2/ 8K/ 3/ 4/ 4 Ultra',
    [review('phase5', 'saturn-4-ultra', 'bestbuyca', 'PFA film')],
  ),
  part(
    'hotend-assembly-for-the-line',
    'a hotend assembly "for" the product line, no model number',
    'Anycubic Kobra 3 Combo',
    'AnyCubic Hotend Assembly for Kobra',
    [review('phase5', 'kobra-3-combo', 'spool3d', 'hotend assemblies')],
  ),
  part(
    'charging-station-for-many-devices',
    'a charging station "for" phones, watches and earbuds, the asked model in a long list',
    AIRPODS,
    'Intoval Wireless Charging Station,3 in 1 Charger for Apple iPhone/iWatch/Airpods,iPhone16,15,' +
      '14,13,12,11 (Pro,Pro Max)/XS/XR/XS,Airpods Pro2/Pro/3/4',
    [review('phase5', 'airpods-pro-2', 'shoppurilite.ca', 'charging stations')],
  ),
  part(
    'charger-compatible-with-devices',
    'a wireless charger "compatible with" the device family',
    AIRPODS,
    'UGREEN MagFlow 15W 3-in-1 Fast Wireless Charger, QI2 Certified Magsafe Foldable Charging ' +
      'Stand Compatible with iPhone 16/15/14/13, AirPods 4/3/2/Pro',
    [review('phase5', 'airpods-pro-2', 'shoppurilite.ca', 'charging stations')],
  ),
  part(
    'case-compatible-with-the-model',
    'a case "compatible with" the model and several others',
    SONICARE,
    'Case Compatible with Philips for Sonicare for ProtectiveClean 4100 5100 6100 6500 7500 ' +
      'Rechargeable Electric Toothbrush.Travel Holder Fits for Oral-B 7500 9600 9300 Pro 1000',
    [
      review(
        'phase5',
        'sonicare-4100',
        'bestbuyca',
        'catalog: travel cases (the web read the 4100 itself)',
        ['before'],
      ),
    ],
  ),
  part(
    'travel-case-for-other-brands-first',
    'a travel case "for" another brand first, the asked model after a slash',
    SONICARE,
    'Toothbrush Travel Case for Oral-B 1000 2000, 3000, 3500, 1500/Philips Sonicare 4100 ' +
      'Electric Toothbrush Bag（only box）',
    [review('phase5', 'sonicare-4100', 'aliexpress', 'travel cases')],
  ),
  part(
    'official-case-no-model',
    'an official case of the brand, the model not named',
    PI5,
    'Raspberry Pi Official Case',
    [review('phase5', 'raspberry-pi-5', 'spool3d', 'case, camera cable')],
  ),
  part(
    'camera-cable-no-model',
    'a camera cable of the brand, the model not named',
    PI5,
    'Raspberry Pi Camera Cable',
    [review('phase5', 'raspberry-pi-5', 'spool3d', 'case, camera cable')],
  ),
  part(
    'grill-pan-for-the-model',
    'a grill pan "for" the model and its siblings',
    'Ninja AF101 Air Fryer',
    'Air Fryer Grill Pan for Ninja AF101 4QT XL 5.5 Qt AF150 Max XL 5.5 Quart AF161, 8.2" Round ' +
      'Food Grade, Non-Stick, Dishwasher Safe',
  ),
  {
    id: 'grip-tape-for-the-mouse',
    what: 'grip tape "for" the mouse, which Amazon\'s search ranks under the mouse itself',
    input: {
      asked: asked('logitech mx master 3s'),
      listing: listing('Mouse Grip Tape for Logitech MX Master 3S'),
    },
    expected: { relation: 'accessory_or_part' },
    from: [
      test(
        'test_amazon.py',
        'test_a_product_variant_named_for_something_is_not_an_accessory',
        '(ranked under the mouse)',
      ),
      run('accessory_for("logitech mx master 3s", title) = True, score = 40.0'),
      S54_RULES,
    ],
    label:
      'the test ranks it under the product as the accessory; running the matcher confirms ' +
      'accessory_for is true',
  },
  {
    id: 'chuck-for-the-model-number',
    what: 'a chuck whose name ends "for <the model number>"',
    input: {
      asked: asked('dewalt dcd793d1'),
      listing: listing('DEWALT Replacement Keyless Chuck for DCD793D1'),
    },
    expected: { relation: 'accessory_or_part' },
    from: [
      test(
        'test_title_check.py',
        'test_an_accessory_that_names_the_tool_it_fits_is_not_the_tool',
        '(third assertion: this text as the page <title>, refused)',
      ),
      run('accessory_for("dewalt dcd793d1", title) = True, score = 40.0'),
      S54_RULES,
    ],
    label:
      'the test\'s docstring calls it "an accessory that names the tool it fits"; the model ' +
      'number sits only after "for", which accessory_for reads as a part for the product',
  },
  {
    id: 'battery-for-the-platform',
    what: 'a battery of the same brand and platform, the model number not named',
    input: { asked: asked('dewalt dcd793d1'), listing: listing('DEWALT 20V MAX 2Ah Battery') },
    expected: { oneOf: ['accessory_or_part', 'unknown'] },
    from: [
      test(
        'test_title_check.py',
        'test_an_accessory_that_names_the_tool_it_fits_is_not_the_tool',
        '(second assertion: refused title_mismatch)',
      ),
      run('accessory_for = False, score = 45.71: refused for want of the model, not as a part'),
      code('pricewatch/src/pricewatch/matching.py:82-94 (_PART_RE has no "battery")'),
    ],
    label:
      'the docstring calls it an accessory, so the truth is accessory_or_part; the predecessor ' +
      'refused it only because the title lacks the model number (title_mismatch), so its rules ' +
      'did not decide the relation and a rules tier may leave it unknown',
  },
];
