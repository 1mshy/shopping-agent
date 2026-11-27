import { expect, it } from 'vitest';
import { searchMagento } from '../../src/directory/search.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://shop.example',
  marketPrefix: '/ca',
  query: 'test "jacket"',
  market: MARKET_CA,
  magentoGeneration: 2 as const,
};

it('uses one scoped GraphQL GET and a returned store rewrite', async () => {
  const items = [
    {
      name: 'Test Jacket',
      sku: 'TJ02',
      url_rewrites: [{ url: 'https://other.example/x' }, { url: 'test-jacket.p' }],
    },
    { name: 'Key alone', url_key: 'no-suffix-given' },
    { name: 'Outside market', url_rewrites: [{ url: '/other/item' }] },
  ];
  const result = await searchMagento(input, {
    now: Date.now,
    get(request) {
      const url = new URL(request.url);
      expect(request.rung).toBe('api');
      expect(url.origin + url.pathname).toBe(input.origin + '/ca/graphql');
      expect(JSON.parse(url.searchParams.get('variables') ?? '')).toEqual({ term: input.query });
      expect(url.searchParams.get('query')).toContain('products(search: $term');
      return fakeContext({
        [request.url]: { body: JSON.stringify({ data: { products: { items } } }) },
      }).context.get(request);
    },
  });
  expect(result).toEqual({
    kind: 'results',
    candidates: [
      {
        url: 'https://shop.example/ca/test-jacket.p',
        storeHost: 'shop.example',
        marketPrefix: '/ca',
        title: 'Test Jacket',
        sku: 'TJ02',
        brand: null,
        gtin: null,
        mpn: null,
        variant: {},
      },
    ],
  });
});

it('skips Magento 1 and preserves a typed HTTP failure', async () => {
  const { context, sent } = fakeContext({});
  expect(await searchMagento({ ...input, magentoGeneration: 1 }, context)).toEqual({
    kind: 'unsupported',
  });
  expect(sent).toHaveLength(0);
  expect(
    await searchMagento(input, {
      now: Date.now,
      get(request) {
        return fakeContext({ [request.url]: { status: 429 } }).context.get(request);
      },
    }),
  ).toEqual({
    kind: 'fetch_failed',
    outcome: { kind: 'rate_limited', rung: 'api', retryAfterMs: 30000 },
  });
});
