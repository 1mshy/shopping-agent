import { expect, it } from 'vitest';
import { searchBestBuyCanada } from '../../src/directory/bestbuy.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://www.bestbuy.ca',
  marketPrefix: '/en-ca',
  market: MARKET_CA,
  query: 'MX 3S',
};
const endpoint =
  'https://www.bestbuy.ca/api/v2/json/search?query=MX+3S&lang=en-CA&pageSize=10&page=1';
it('accepts first-party products with matching URL and SKU, while leaving the price for a direct read', async () => {
  const item = {
    sku: '19467786',
    name: 'Logitech MX 3S',
    productUrl: '/en-ca/product/mx-3s/19467786',
    isMarketplace: false,
    salePrice: 1,
  };
  const products = [
    item,
    { ...item, isMarketplace: true },
    { ...item, sku: '99999999' },
    { ...item, productUrl: 'https://other.example/en-ca/product/mx-3s/19467786' },
  ];
  const { sent, context } = fakeContext({ [endpoint]: { body: JSON.stringify({ products }) } });
  expect(await searchBestBuyCanada(input, context)).toEqual({
    kind: 'results',
    candidates: [
      {
        url: 'https://www.bestbuy.ca/en-ca/product/mx-3s/19467786',
        storeHost: 'www.bestbuy.ca',
        marketPrefix: '/en-ca',
        title: item.name,
        sku: item.sku,
        brand: null,
        mpn: null,
        gtin: null,
        variant: {},
      },
    ],
  });
  expect(sent).toHaveLength(1);
});
it('does not query another regional storefront and preserves a failure', async () => {
  const { sent, context } = fakeContext({ [endpoint]: { status: 429 } });
  expect(
    await searchBestBuyCanada({ ...input, market: { ...MARKET_CA, country: 'US' } }, context),
  ).toEqual({ kind: 'unsupported' });
  expect(sent).toHaveLength(0);
  expect(await searchBestBuyCanada(input, context)).toMatchObject({
    kind: 'fetch_failed',
    outcome: { kind: 'rate_limited' },
  });
});
