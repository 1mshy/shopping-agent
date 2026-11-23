const S = (src, ...qs) => qs.map((q) => ({ src, q }));
export const PRODUCTS = [
  {
    id: 'oneblade-ca',
    country: 'CA',
    category: 'personal-care',
    relevant: 'oneblade|philips',
    queries: [
      ...S('bby', 'philips oneblade'),
      ...S('shopify:perlastore.ca', 'oneblade'),
      ...S('bby', 'oneblade replacement blade'),
    ],
  },
  {
    id: 'braun-series-9-ca',
    country: 'CA',
    category: 'personal-care',
    relevant: 'braun|series',
    queries: [
      ...S('bby', 'braun series 9 pro'),
      ...S('shopify:perlastore.ca', 'braun series 9'),
      ...S('bby', 'braun shaver head'),
    ],
  },
  {
    id: 'ninja-creami-ca',
    country: 'CA',
    category: 'kitchen-appliances',
    relevant: 'ninja|creami',
    queries: [
      ...S('bby', 'ninja creami'),
      ...S('magento:www.visions.ca', 'ninja creami'),
      ...S('bby', 'ninja creami pints'),
    ],
  },
  {
    id: 'breville-barista-express-ca',
    country: 'CA',
    category: 'kitchen-appliances',
    relevant: 'breville|barista',
    queries: [
      ...S('bby', 'breville barista express'),
      ...S('magento:www.visions.ca', 'breville barista'),
      ...S('bby', 'breville espresso'),
    ],
  },
];
