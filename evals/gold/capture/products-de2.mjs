// DE products captured after alternate.de rate-limited (429) the capture: no alternate.de source here.
const S = (src, ...qs) => qs.map((q) => ({ src, q }));
export const PRODUCTS = [
  {
    id: 'makita-ddf487-de',
    country: 'DE',
    category: 'power-tools',
    relevant: 'makita|ddf|dhp',
    queries: [
      ...S(
        'magento:www.toolnation.de',
        'makita ddf487',
        'ddf487',
        'makita akku-bohrschrauber 18v',
        'makita bohrschrauber',
      ),
    ],
  },
  {
    id: 'bosch-gsr-18v-65-de',
    country: 'DE',
    category: 'power-tools',
    relevant: 'bosch|gsr',
    queries: [
      ...S('magento:www.toolnation.de', 'gsr 18v-65', 'bosch gsr 18v', 'bosch akku-bohrschrauber'),
    ],
  },
  {
    id: 'dewalt-dcd791-de',
    country: 'DE',
    category: 'power-tools',
    relevant: 'dewalt|dcd',
    queries: [
      ...S('magento:www.toolnation.de', 'dcd791', 'dewalt dcd', 'dewalt akku-bohrschrauber'),
    ],
  },
  {
    id: 'cosori-turboblaze-6l-de',
    country: 'DE',
    category: 'kitchen-appliances',
    relevant: 'cosori|turboblaze|heißluft|fritteuse',
    preferVariant: 'grau|gray|grey|schwarz',
    otherVariant: true,
    queries: [
      ...S('shopify:www.cosori.de', 'turboblaze', 'heißluftfritteuse', 'zubehör heißluftfritteuse'),
    ],
  },
  {
    id: 'wmf-lono-kettle-de',
    country: 'DE',
    category: 'kitchen-appliances',
    relevant: 'wmf|wasserkocher|lono',
    queries: [...S('magento:www.wmf.com', 'lono wasserkocher', 'wasserkocher', 'lono', 'wmf lono')],
  },
  {
    id: 'dreame-pocket-neo-2-de',
    country: 'DE',
    category: 'personal-care',
    relevant: 'dreame|haartrockner|pocket|hair',
    preferVariant: 'grau|grey|gray',
    otherVariant: true,
    queries: [...S('shopify:de.dreametech.com', 'pocket neo 2', 'pocket', 'haartrockner')],
  },
  {
    id: 'laifen-neo-de',
    country: 'DE',
    category: 'personal-care',
    relevant: 'laifen|haartrockner|neo',
    preferVariant: 'schwarz|black',
    otherVariant: true,
    queries: [...S('shopify:de.laifentech.com', 'laifen neo', 'haartrockner', 'laifen', 'zubehör')],
  },
  {
    id: 'anker-prime-power-bank-de',
    country: 'DE',
    category: 'computing',
    relevant: 'anker|power ?bank|powerbank',
    preferVariant: 'schwarz|black',
    otherVariant: true,
    queries: [
      ...S('shopify:de.anker.com', 'prime powerbank', 'anker prime power bank', 'powerbank 20000'),
    ],
  },
];
