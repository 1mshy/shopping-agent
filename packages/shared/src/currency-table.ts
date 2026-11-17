// GENERATED FILE. Do not edit by hand.
//
// Source: ISO 4217 List One, "Current currency & funds code list", published by the ISO 4217
// maintenance agency (SIX Financial Information) as XML.
//   URL:       https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
//   Published: 2026-09-17 (the list's Pblshd attribute)
//   SHA-256:   33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff
//   Fetched:   2026-11-17
//
// Every distinct alphabetic code in the list, sorted. Minor units are copied as published;
// "N.A." (no minor unit: precious metals, bond-market units, SDR, XSU, XUA, XTS, XXX) is
// `null`. Fund codes (`IsFund="true"`) are kept, with their published minor units. Rows with
// no code ("No universal currency") are skipped. To refresh: download the list again,
// regenerate this file by the same rules, and re-review packages/shared/test/currency.test.ts.

export const ISO_4217_LIST_ONE = {
  url: 'https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml',
  published: '2026-09-17',
  sha256: '33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff',
} as const;

/** Every active ISO 4217 alphabetic code, sorted. */
export const ISO_CURRENCY_CODES = [
  'AED',
  'AFN',
  'ALL',
  'AMD',
  'AOA',
  'ARS',
  'AUD',
  'AWG',
  'AZN',
  'BAM',
  'BBD',
  'BDT',
  'BHD',
  'BIF',
  'BMD',
  'BND',
  'BOB',
  'BOV',
  'BRL',
  'BSD',
  'BTN',
  'BWP',
  'BYN',
  'BZD',
  'CAD',
  'CDF',
  'CHE',
  'CHF',
  'CHW',
  'CLF',
  'CLP',
  'CNY',
  'COP',
  'COU',
  'CRC',
  'CUP',
  'CVE',
  'CZK',
  'DJF',
  'DKK',
  'DOP',
  'DZD',
  'EGP',
  'ERN',
  'ETB',
  'EUR',
  'FJD',
  'FKP',
  'GBP',
  'GEL',
  'GHS',
  'GIP',
  'GMD',
  'GNF',
  'GTQ',
  'GYD',
  'HKD',
  'HNL',
  'HTG',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'IQD',
  'IRR',
  'ISK',
  'JMD',
  'JOD',
  'JPY',
  'KES',
  'KGS',
  'KHR',
  'KMF',
  'KPW',
  'KRW',
  'KWD',
  'KYD',
  'KZT',
  'LAK',
  'LBP',
  'LKR',
  'LRD',
  'LSL',
  'LYD',
  'MAD',
  'MDL',
  'MGA',
  'MKD',
  'MMK',
  'MNT',
  'MOP',
  'MRU',
  'MUR',
  'MVR',
  'MWK',
  'MXN',
  'MXV',
  'MYR',
  'MZN',
  'NAD',
  'NGN',
  'NIO',
  'NOK',
  'NPR',
  'NZD',
  'OMR',
  'PAB',
  'PEN',
  'PGK',
  'PHP',
  'PKR',
  'PLN',
  'PYG',
  'QAR',
  'RON',
  'RSD',
  'RUB',
  'RWF',
  'SAR',
  'SBD',
  'SCR',
  'SDG',
  'SEK',
  'SGD',
  'SHP',
  'SLE',
  'SOS',
  'SRD',
  'SSP',
  'STN',
  'SVC',
  'SYP',
  'SZL',
  'THB',
  'TJS',
  'TMT',
  'TND',
  'TOP',
  'TRY',
  'TTD',
  'TWD',
  'TZS',
  'UAH',
  'UGX',
  'USD',
  'USN',
  'UYI',
  'UYU',
  'UYW',
  'UZS',
  'VED',
  'VES',
  'VND',
  'VUV',
  'WST',
  'XAD',
  'XAF',
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XCD',
  'XCG',
  'XDR',
  'XOF',
  'XPD',
  'XPF',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
  'YER',
  'ZAR',
  'ZMW',
  'ZWG',
] as const;

/** ISO 4217 minor units per code; `null` where the list says "N.A.". */
export const ISO_MINOR_UNITS = {
  AED: 2, // UAE Dirham
  AFN: 2, // Afghani
  ALL: 2, // Lek
  AMD: 2, // Armenian Dram
  AOA: 2, // Kwanza
  ARS: 2, // Argentine Peso
  AUD: 2, // Australian Dollar
  AWG: 2, // Aruban Florin
  AZN: 2, // Azerbaijan Manat
  BAM: 2, // Convertible Mark
  BBD: 2, // Barbados Dollar
  BDT: 2, // Taka
  BHD: 3, // Bahraini Dinar
  BIF: 0, // Burundi Franc
  BMD: 2, // Bermudian Dollar
  BND: 2, // Brunei Dollar
  BOB: 2, // Boliviano
  BOV: 2, // Mvdol (fund)
  BRL: 2, // Brazilian Real
  BSD: 2, // Bahamian Dollar
  BTN: 2, // Ngultrum
  BWP: 2, // Pula
  BYN: 2, // Belarusian Ruble
  BZD: 2, // Belize Dollar
  CAD: 2, // Canadian Dollar
  CDF: 2, // Congolese Franc
  CHE: 2, // WIR Euro (fund)
  CHF: 2, // Swiss Franc
  CHW: 2, // WIR Franc (fund)
  CLF: 4, // Unidad de Fomento (fund)
  CLP: 0, // Chilean Peso
  CNY: 2, // Yuan Renminbi
  COP: 2, // Colombian Peso
  COU: 2, // Unidad de Valor Real (fund)
  CRC: 2, // Costa Rican Colon
  CUP: 2, // Cuban Peso
  CVE: 2, // Cabo Verde Escudo
  CZK: 2, // Czech Koruna
  DJF: 0, // Djibouti Franc
  DKK: 2, // Danish Krone
  DOP: 2, // Dominican Peso
  DZD: 2, // Algerian Dinar
  EGP: 2, // Egyptian Pound
  ERN: 2, // Nakfa
  ETB: 2, // Ethiopian Birr
  EUR: 2, // Euro
  FJD: 2, // Fiji Dollar
  FKP: 2, // Falkland Islands Pound
  GBP: 2, // Pound Sterling
  GEL: 2, // Lari
  GHS: 2, // Ghana Cedi
  GIP: 2, // Gibraltar Pound
  GMD: 2, // Dalasi
  GNF: 0, // Guinean Franc
  GTQ: 2, // Quetzal
  GYD: 2, // Guyana Dollar
  HKD: 2, // Hong Kong Dollar
  HNL: 2, // Lempira
  HTG: 2, // Gourde
  HUF: 2, // Forint
  IDR: 2, // Rupiah
  ILS: 2, // New Israeli Sheqel
  INR: 2, // Indian Rupee
  IQD: 3, // Iraqi Dinar
  IRR: 2, // Iranian Rial
  ISK: 0, // Iceland Krona
  JMD: 2, // Jamaican Dollar
  JOD: 3, // Jordanian Dinar
  JPY: 0, // Yen
  KES: 2, // Kenyan Shilling
  KGS: 2, // Som
  KHR: 2, // Riel
  KMF: 0, // Comorian Franc
  KPW: 2, // North Korean Won
  KRW: 0, // Won
  KWD: 3, // Kuwaiti Dinar
  KYD: 2, // Cayman Islands Dollar
  KZT: 2, // Tenge
  LAK: 2, // Lao Kip
  LBP: 2, // Lebanese Pound
  LKR: 2, // Sri Lanka Rupee
  LRD: 2, // Liberian Dollar
  LSL: 2, // Loti
  LYD: 3, // Libyan Dinar
  MAD: 2, // Moroccan Dirham
  MDL: 2, // Moldovan Leu
  MGA: 2, // Malagasy Ariary
  MKD: 2, // Denar
  MMK: 2, // Kyat
  MNT: 2, // Tugrik
  MOP: 2, // Pataca
  MRU: 2, // Ouguiya
  MUR: 2, // Mauritius Rupee
  MVR: 2, // Rufiyaa
  MWK: 2, // Malawi Kwacha
  MXN: 2, // Mexican Peso
  MXV: 2, // Mexican Unidad de Inversion (UDI) (fund)
  MYR: 2, // Malaysian Ringgit
  MZN: 2, // Mozambique Metical
  NAD: 2, // Namibia Dollar
  NGN: 2, // Naira
  NIO: 2, // Cordoba Oro
  NOK: 2, // Norwegian Krone
  NPR: 2, // Nepalese Rupee
  NZD: 2, // New Zealand Dollar
  OMR: 3, // Rial Omani
  PAB: 2, // Balboa
  PEN: 2, // Sol
  PGK: 2, // Kina
  PHP: 2, // Philippine Peso
  PKR: 2, // Pakistan Rupee
  PLN: 2, // Zloty
  PYG: 0, // Guarani
  QAR: 2, // Qatari Rial
  RON: 2, // Romanian Leu
  RSD: 2, // Serbian Dinar
  RUB: 2, // Russian Ruble
  RWF: 0, // Rwanda Franc
  SAR: 2, // Saudi Riyal
  SBD: 2, // Solomon Islands Dollar
  SCR: 2, // Seychelles Rupee
  SDG: 2, // Sudanese Pound
  SEK: 2, // Swedish Krona
  SGD: 2, // Singapore Dollar
  SHP: 2, // Saint Helena Pound
  SLE: 2, // Leone
  SOS: 2, // Somali Shilling
  SRD: 2, // Surinam Dollar
  SSP: 2, // South Sudanese Pound
  STN: 2, // Dobra
  SVC: 2, // El Salvador Colon
  SYP: 2, // Syrian Pound
  SZL: 2, // Lilangeni
  THB: 2, // Baht
  TJS: 2, // Somoni
  TMT: 2, // Turkmenistan New Manat
  TND: 3, // Tunisian Dinar
  TOP: 2, // Pa’anga
  TRY: 2, // Turkish Lira
  TTD: 2, // Trinidad and Tobago Dollar
  TWD: 2, // New Taiwan Dollar
  TZS: 2, // Tanzanian Shilling
  UAH: 2, // Hryvnia
  UGX: 0, // Uganda Shilling
  USD: 2, // US Dollar
  USN: 2, // US Dollar (Next day) (fund)
  UYI: 0, // Uruguay Peso en Unidades Indexadas (UI) (fund)
  UYU: 2, // Peso Uruguayo
  UYW: 4, // Unidad Previsional (fund)
  UZS: 2, // Uzbekistan Sum
  VED: 2, // Bolívar Soberano
  VES: 2, // Bolívar Soberano
  VND: 0, // Dong
  VUV: 0, // Vatu
  WST: 2, // Tala
  XAD: 2, // Arab Accounting Dinar (fund)
  XAF: 0, // CFA Franc BEAC
  XAG: null, // Silver
  XAU: null, // Gold
  XBA: null, // Bond Markets Unit European Composite Unit (EURCO)
  XBB: null, // Bond Markets Unit European Monetary Unit (E.M.U.-6)
  XBC: null, // Bond Markets Unit European Unit of Account 9 (E.U.A.-9)
  XBD: null, // Bond Markets Unit European Unit of Account 17 (E.U.A.-17)
  XCD: 2, // East Caribbean Dollar
  XCG: 2, // Caribbean Guilder
  XDR: null, // SDR (Special Drawing Right)
  XOF: 0, // CFA Franc BCEAO
  XPD: null, // Palladium
  XPF: 0, // CFP Franc
  XPT: null, // Platinum
  XSU: null, // Sucre
  XTS: null, // Codes specifically reserved for testing purposes
  XUA: null, // ADB Unit of Account
  XXX: null, // The codes assigned for transactions where no currency is involved
  YER: 2, // Yemeni Rial
  ZAR: 2, // Rand
  ZMW: 2, // Zambian Kwacha
  ZWG: 2, // Zimbabwe Gold
} as const satisfies Record<(typeof ISO_CURRENCY_CODES)[number], number | null>;

/** Codes the list marks as funds (`IsFund="true"`). */
export const ISO_FUND_CODES = [
  'BOV',
  'CHE',
  'CHW',
  'CLF',
  'COU',
  'MXV',
  'USN',
  'UYI',
  'UYW',
  'XAD',
] as const;
