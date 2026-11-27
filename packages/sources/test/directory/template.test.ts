import { expect, it } from 'vitest';
import { searchDeclaredTemplate } from '../../src/directory/template.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://shop.example',
  marketPrefix: '/ca',
  query: 'Kettle & tea',
  market: MARKET_CA,
};
it.each(['{searchTerms}', '{search_term_string}'])(
  'executes a declared HTML template containing %s',
  async (slot) => {
    const url = 'https://shop.example/ca/find?q=Kettle%20%26%20tea';
    const { sent, context } = fakeContext({
      [url]: {
        contentType: 'text/html',
        body: '<nav><a href="/ca/help">Help</a></nav><a href="/ca/products/kettle"><strong>Kettle</strong> and tea</a><a href="/us/products/wrong">US kettle</a><a href="https://elsewhere.example/ca/products/x">X</a>',
      },
    });
    const result = await searchDeclaredTemplate(input, '/ca/find?q=' + slot, context);
    expect(result).toEqual({
      kind: 'results',
      candidates: [
        {
          url: 'https://shop.example/ca/products/kettle',
          storeHost: 'shop.example',
          marketPrefix: '/ca',
          title: 'Kettle and tea',
          brand: null,
          sku: null,
          mpn: null,
          gtin: null,
          variant: {},
        },
      ],
    });
    expect(sent).toEqual([{ url, rung: 'http' }]);
  },
);
it('rejects off-store templates before fetching and preserves a failed store response', async () => {
  const { sent, context } = fakeContext({
    'https://shop.example/s?q=Kettle%20%26%20tea': { status: 429 },
  });
  expect(
    await searchDeclaredTemplate(input, 'https://external.example/{searchTerms}', context),
  ).toEqual({ kind: 'unsupported' });
  expect(sent).toEqual([]);
  expect(await searchDeclaredTemplate(input, '/s?q={searchTerms}', context)).toMatchObject({
    kind: 'fetch_failed',
    outcome: { kind: 'rate_limited' },
  });
});
