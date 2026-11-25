// The word classes the title rules read (S§5.4 tier 2). Each list is a class of words, not a list
// of products: a word is here because it plays the same role in any listing of any store. English
// and German, the languages of the markets the gold set was captured in (CA, US, DE).

const set = (words: string): ReadonlySet<string> => new Set(words.trim().split(/\s+/));

/**
 * Words a title puts before or around the name that say nothing about which product it is:
 * condition, promotion, provenance. A leading run of them is skipped before the first name word.
 */
export const FILLER = set(`
  new brand original official genuine authentic open box openbox newopenbox refurbished renewed
  used preowned pre owned certified excellent good fair like generalüberholt neu promo sale deal
  hot best exclusive only at the a an limited latest upgraded upgrade 2nd
`);

/**
 * Category and description words a store may add or drop without changing the product. They never
 * count as missing from a listing, and never as a line word of their own.
 */
export const GENERIC = set(`
  printer printers 3d fdm resin filament filaments spool spools roll rolls drucker 3d-drucker
  machine device unit tool tools electric cordless wireless rechargeable portable smart
  and or of in to by the a an with for von und mit für
  series model version type style size colour color
  kit set pack
`);

/**
 * Relation phrases: what follows names the thing the listing is used with, not the listing
 * ("HotEnd for Bambu Lab X1C", "Case Compatible with Philips Sonicare 4100").
 */
export const RELATION_RE =
  /\b(?:compatible\s+(?:with|w\/|for)|for\s+use\s+with|works\s+with|fits?|to\s+fit|replacement\s+for|designed\s+for|suitable\s+for|made\s+for|kompatibel\s+mit|passend\s+für|geeignet\s+für|for|für|pour|para)\b/;

/**
 * Inclusion markers: what follows is what the listing comes with ("with MagSafe Charging Case",
 * "Includes 2 filters"). Cut before judging the name, or every included part reads as the product.
 */
export const INCLUSION_RE =
  /\b(?:with|includes?|including|included|inkl|inklusive|mit)\b|(?<=^|[\s)])\+/;

/** A "+" that joins two things ("Pitcher + Filters", "(20K, 220W)+Cable"), not a grade mark ("PLA+"). */
export const JOINING_PLUS_RE = /(?<=^|[\s)])\+/;

/**
 * Part, accessory and service nouns: a listing whose name ends in one is a part for the product,
 * not the product. Matched on the prepared text; multi-word forms first.
 */
export const PART_NOUN_RE = new RegExp(
  '\\b(?:' +
    [
      // Multi-word forms first: the alternation takes the first that matches at a position.
      '(?:build|pei|engineering|effect|flex|platform|smooth|textured|cool|print|steel|magnetic|spring|glass cover) plates?',
      '(?:extruder|drive|idler) gears?(?: assembly)?',
      '(?:timing|drive|gt2) belts?',
      '(?:lcd|touch) screens?',
      '(?:pfa|fep|nfep|acf|release) films?',
      'extruders?(?: units?)?',
      'hot ?ends?',
      'print beds?',
      'resin tanks?',
      'screen protectors?',
      'ptfe(?: tubes?| tubing)?',
      'bowden tubes?',
      'heat ?breaks?',
      'heat(?:er|ing) blocks?',
      'power suppl(?:y|ies)',
      'main ?boards?',
      'toolhead boards?',
      'charging (?:stations?|stands?|docks?|pads?)',
      'wireless chargers?',
      'wall adapters?',
      'tempered glass',
      'ear ?tips',
      'ear ?pads',
      'grill pans?',
      'sealing rings?',
      'replacement (?:heads?|blades?|filters?|foils?)',
      'shaver heads?',
      'brush heads?',
      'foils?(?: and cutters?)?',
      'water filters?',
      'storage bags?',
      'travel cases?',
      'nozzles?',
      'plates',
      'buildplates?',
      'vats?',
      'gears',
      'pulleys?',
      'cables?',
      'cords?',
      'antennas?',
      'socks?',
      'thermistors?',
      'psu',
      '(?<!charging )cases?',
      'covers?',
      'sleeves?',
      'pouch(?:es)?',
      'holders?',
      'adapters?',
      'protectors?',
      'earpads',
      'cushions?',
      'straps?',
      'lanyards?',
      'lids?',
      'racks?',
      'liners?',
      'blades?',
      'cutters?',
      'filters?',
      'chucks?',
      'connectors?',
      'splicers?',
      'fans?',
      'batter(?:y|ies)',
      'bags?',
      'workshops?',
      'courses?',
      'training',
      'warranty',
      // German forms, compounds included ("Bauplatte", "Effektplatte", "Schnellwechsel-Düse").
      'kabel',
      'kamera',
      'heizblock(?:-kit)?',
      '[a-zäöü]*platten?',
      '[a-zäöü]*düsen?(?:kit)?',
      'ohrpolster',
      'einlage',
      'reisetasche',
      'reiseetui',
      'tasche',
      'garantieverlängerung',
    ].join('|') +
    ')\\b',
);

/** Named anywhere in a product's own name, the listing is not the product. */
export const PART_ANYWHERE_RE =
  /\b(?:accessor(?:y|ies)|zubehör(?:set)?|spare parts?|replacement parts?|upgrade kits?|stickers?|decals?|toolheads?|(?:left|right) ear|ersatzkopf|ersatzteil)\b/;

/** Words a part's name may carry after its part noun ("Build Plate 235x235mm Textured PEI Sheet"). */
export const PART_TRAILER = set(`
  textured smooth flexible spring steel magnetic pei sheet sheets plate plates assembly assemblies
  replacement replacements upgrade upgrades spare pcs pc piece pieces hub only oem black white grey
  gray red blue green clear transparent unit units kit kits tube tubes series pack set
  - and or for x
`);

/**
 * Qualifiers that make a different product of the same name: an A1 is not an A1 mini, a Kobra 3
 * Max is not a Kobra 3, a K-Mini Go is not a K-Mini (S§5.4 "variant words"). `plus` is judged
 * separately when it marks a material grade (PLA+, PLA Plus).
 */
export const QUALIFIERS = set(`
  go pro max plus mini ultra lite se xl xxl air neo slim nano fe evo mate premium special elite
  sport
`);

/** Words that mark a bundle: several products sold as one listing. */
export const BUNDLE_RE =
  /\b(?:bundle|bundel|starter (?:pack|kit|set)|basic kit|essentials kit|gift (?:set|box)|value pack|combo ?kit|comboset|combipack|kombo|werkzeugsatz|dealset|toolkit|komplettpaket|complete package)\b/;

/** Words that mark an edition: a variant of the same product sold under its own part number. */
export const EDITION_WORDS = set('business mac');

/** Heatsink words: an SSD with a heatsink is another part number than the bare drive. */
export const HEATSINK_RE = /\b(?:heat ?sink|kühlkörper)\b/;
export const WITHOUT_RE = /\b(?:without|ohne|w\/o|no|exkl|excl)\b/;

/** Filament and resin materials. A line word next to one changes the material line. */
export const MATERIALS = set('pla petg abs asa tpu pc pa nylon pva hips pet');

/**
 * Words that, next to a material, name another material line (S§5.4: "matte and silk are other
 * lines", the orchestrator's reading of the owner's ruling of 2026-11-23).
 */
export const MATERIAL_LINES = set(`
  silk matte matt marble wood glow galaxy sparkle metallic rainbow gradient neon dual lw ht cf
  translucent hs
`);

/** Size adjectives: a store's word for the size, compared through the stated capacity instead. */
export const SIZE_ADJECTIVES = set('small medium large grand big little');

/** Colour words and their German forms, folded to one key per colour. */
export const COLOURS: ReadonlyMap<string, string> = new Map([
  ...[
    'black',
    'white',
    'grey',
    'silver',
    'gold',
    'blue',
    'red',
    'green',
    'yellow',
    'pink',
    'purple',
    'orange',
    'brown',
    'beige',
    'cream',
    'navy',
    'rose',
    'midnight',
    'champagne',
    'titanium',
    'platinum',
    'ivory',
    'mint',
    'teal',
    'bronze',
    'copper',
    'tan',
    'sand',
    'stone',
    'graphite',
    'truffle',
    'stainless',
    'orchid',
    'lavender',
  ].map((c) => [c, c] as [string, string]),
  ['gray', 'grey'],
  ['schwarz', 'black'],
  ['weiß', 'white'],
  ['weiss', 'white'],
  ['grau', 'grey'],
  ['silber', 'silver'],
  ['blau', 'blue'],
  ['rot', 'red'],
  ['grün', 'green'],
  ['gruen', 'green'],
  ['gelb', 'yellow'],
  ['rosa', 'pink'],
  ['lila', 'purple'],
  ['violett', 'purple'],
  ['violet', 'purple'],
  ['braun', 'brown'],
  ['champagner', 'champagne'],
]);

/** Shade words that distinguish two colours of one base ("Dark Gray" is not "Light Gray"). */
export const SHADES = set('dark light pale deep bright');

/** Number words, read as digits only where a designator is compared ("Space One" vs "Space 2"). */
export const NUMBER_WORDS: ReadonlyMap<string, string> = new Map([
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
  ['ten', '10'],
]);
