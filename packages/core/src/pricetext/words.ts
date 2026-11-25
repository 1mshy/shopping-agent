// Words that say what a figure's money is, when it is not the item's price: a payment, a floor
// over options, a price per measure, one end of a range. Matched on lower-cased normalised text
// (normalise.ts), as whole words. Erring towards a refusal is the safe side: a refused read keeps
// the last known state (S§2.10), a misread stores a wrong price.

const B = '(?<![\\p{L}\\p{N}])'; // start of a word
const E = '(?![\\p{L}\\p{N}])'; // end of a word

const words = (...alternatives: string[]) => `(?:${alternatives.join('|')})`;
const pattern = (...parts: string[]) => new RegExp(parts.join('|'), 'u');

const PERIODS = words(
  'mo',
  'mos',
  'mon',
  'mth',
  'mths',
  'mnth',
  'months?',
  'mois',
  'monat',
  'mes',
  'mese',
  'maand',
  'mnd',
  'mån',
  'wk',
  'wks',
  'weeks?',
  'semaines?',
  'woche',
  'yr',
  'yrs',
  'years?',
  'an',
  'année',
  'jahr',
  'año',
  'anno',
  'jaar',
  'days?',
  'jour',
  'tag',
);
const PERIOD_WORDS = words(
  'months?',
  'weeks?',
  'years?',
  'mois',
  'semaine',
  'an',
  'année',
  'monat',
  'woche',
  'jahr',
  'mes',
  'año',
  'mese',
  'anno',
  'maand',
  'jaar',
);

/** A financing or pay-later payment, or a recurring charge: "/mo", "monthly", "4 payments of". */
export const INSTALMENT = pattern(
  `/ ?${PERIODS}${E}`,
  `${B}${words('per', 'a', 'an', 'each', 'every', 'par', 'pro', 'al', 'por', 'il', 'le')} ${PERIOD_WORDS}${E}`,
  `${B}${words(
    'monthly',
    'weekly',
    'bi-?weekly',
    'fortnightly',
    'semi-?monthly',
    'yearly',
    'annually',
    'mensuel(?:le)?s?',
    'mensuellement',
    'hebdomadaires?',
    'monatlich',
    'wöchentlich',
    'mensual(?:es)?',
    'mensualmente',
    'mensil[ei]',
    'maandelijks',
    'mensa(?:l|is)',
  )}${E}`,
  `${B}${words(
    'payments?',
    'instal{1,2}ments?',
    'financ(?:e|ed|ing)',
    'financement',
    'finanzierung',
    'finanziamento',
    'financiación',
    'financiamento',
    'interest[- ]free',
    'pay in \\d+',
    'pay later',
    'pay over time',
    'bnpl',
    'affirm',
    'klarna',
    'afterpay',
    'clearpay',
    'sezzle',
    'paybright',
    'versements?',
    'paiements?',
    'mensualités?',
    'ratenzahlung',
    'raten',
    'rateizzazione',
    'cuotas',
    'parcelas',
    'sem juros',
    'sin intereses',
  )}${E}`,
  `\\d ?% ?apr${E}`,
  `${B}\\d{1,2} ?x (?:de|sans frais)${E}`,
);

/** A floor over options, not this listing's price: "From $49.99", "as low as", "ab", "$49+". */
export const LOWER_BOUND = pattern(
  `${B}${words(
    'from',
    'starting',
    'starts at',
    'as low as',
    'ab',
    'à partir de',
    'a partir de',
    'dès',
    'desde',
    'vanaf',
    'från',
    'fra',
    'od',
    'and up',
    'and above',
    'et plus',
  )}${E}`,
  `& up${E}`,
  // "$49.99+" and "49,99 €+" at the end or before punctuation; not "$49.99 + tax", "$5 + $2", "1+1"
  `\\d(?: ?[^\\s\\d\\p{L}]| ?\\p{L}{1,3})? ?\\+(?= ?(?:$|[()\\[\\],;.!/]))`,
);

const UNITS = words(
  'g',
  'gr',
  'grams?',
  'gramm',
  'kg',
  'kgs',
  'kilos?',
  'kilograms?',
  'mg',
  'lb',
  'lbs',
  'pounds?',
  'oz',
  'ounces?',
  'fl\\.? ?oz',
  'l',
  'lt',
  'ltr',
  'lit(?:re|er)s?',
  'ml',
  'cl',
  'dl',
  'm',
  'm2',
  'm²',
  'm3',
  'm³',
  'cm',
  'mm',
  'met(?:re|er)s?',
  'mètres?',
  'sq\\.? ?ft',
  'sqft',
  'ft',
  'feet',
  'foot',
  'in',
  'inch(?:es)?',
  'yd',
  'yards?',
  'units?',
  'unités?',
  'pieces?',
  'pièces?',
  'pc',
  'pcs',
  'ct',
  'count',
  'each',
  'ea',
  'stück',
  'stk',
  'st',
  'sheets?',
  'rolls?',
  'tablets?',
  'capsules?',
  'servings?',
  'doses?',
  'washe?s?',
  'loads?',
  'kwh',
);

/** A unit price: "$1.25 /100 g", "12,99 €/kg", "per lb", "1,25 $ le 100 g". */
export const PER_MEASURE = pattern(
  `(?:/|${B}${words('per', 'pro', 'par', 'le', 'la', 'je', 'por', 'a')} ) ?(?:\\d+(?:[.,]\\d+)? ?)?${UNITS}${E}`,
);

/** One end of an open range: "up to $50" is no price either. */
export const UP_TO = pattern(
  `${B}${words('up to', 'bis zu', "jusqu'à", "jusqu'a", 'hasta', 'fino a')}${E}`,
);

/** What may join the two figures of a range, once marks and spaces are taken out. */
export const RANGE_JOINT = /^(?:-|~|to|bis|à|a|au|tot|till|until|hasta)$/u;

/**
 * Words and signs that mark a figure as approximate, as a site writes its own conversion
 * ("approx. CA$25.00", "≈ €23.10", "~$25", "ca. 25 €"): refused (owner's ruling of 2026-11-23).
 * Matched on lower-cased text.
 */
export const APPROXIMATE = pattern(
  '≈',
  `${B}${words(
    'approx\\.?',
    'approximately',
    'aprox\\.?',
    'aproximadamente',
    'env\\.',
    'environ',
    'circa',
    'ca\\.',
    'ungefähr',
    'about',
  )}(?![\\p{L}\\p{N}$])`,
  `(?<!\\p{N}[^\\s\\p{N}]* ?)~ ?(?=[\\d$€£¥₹\\p{L}])`, // "~$25", not the range "$10 ~ $20"
);
