import { expect, it } from 'vitest';
import { searchUcp } from '../../src/index.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const origin = 'https://merchant.example';
const endpoint = origin + '/api/ucp/mcp';
const input = { origin, endpoint, marketPrefix: '/en-ca', query: 'whole bean', market: MARKET_CA };
const product = {
  title: 'Coffee Beans',
  url: origin + '/products/beans',
  variants: [
    {
      id: 'gid://shopify/ProductVariant/123',
      sku: 'FT-12OZ',
      price: { amount: 1850, currency: 'CAD' },
      options: [{ name: 'Bag size', label: '12 oz' }],
    },
  ],
};
const rpc = (products: unknown[]) => ({
  jsonrpc: '2.0',
  id: 1,
  result: { structuredContent: { products } },
});
const reply = (body: string, contentType = 'application/json') =>
  fakeContext({ [endpoint]: { body, contentType } }).context;
const candidate = {
  url: origin + '/en-ca/products/beans?variant=123',
  storeHost: 'merchant.example',
  marketPrefix: '/en-ca',
  title: 'Coffee Beans',
  sku: 'FT-12OZ',
  gtin: null,
  mpn: null,
  brand: null,
  variant: { 'Bag size': '12 oz' },
};

it('reads a documented product permalink and variant GID, keeps the selected SKU, and emits no price', async () => {
  expect(await searchUcp(input, reply(JSON.stringify(rpc([product]))))).toEqual({
    kind: 'results',
    candidates: [candidate],
  });
});

it('reads a correlated JSON-RPC event with a text content payload', async () => {
  const event = {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ products: [product] }) }] },
  };
  const body =
    'event: message\ndata: ' +
    JSON.stringify(event) +
    '\r\n\r\ndata: ' +
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' }) +
    '\n\n';
  expect(await searchUcp(input, reply(body, 'text/event-stream'))).toEqual({
    kind: 'results',
    candidates: [candidate],
  });
});

it('drops foreign currency, foreign origin, different locale, and checkout-only records', async () => {
  const products = [
    { ...product, variants: [{ ...product.variants[0], price: { amount: 12, currency: 'USD' } }] },
    { ...product, url: 'https://other.example/products/beans' },
    { ...product, url: origin + '/en-us/products/beans' },
    { ...product, url: origin + '/checkout' },
  ];
  expect(await searchUcp(input, reply(JSON.stringify(rpc(products))))).toEqual({
    kind: 'results',
    candidates: [],
  });
});

it.each([
  origin + '/other',
  'https://other.example/api/ucp/mcp',
  origin + '/api/ucp/mcp?session=1',
  'https://catalog.shopify.com/api/ucp/mcp',
])('declines unsupported binding %s without a request', async (endpoint) => {
  const f = fakeContext({});
  expect(await searchUcp({ ...input, endpoint }, f.context)).toEqual({ kind: 'unsupported' });
  expect(f.sent).toHaveLength(0);
});
it('does not accept the global Shopify binding as a storefront', async () => {
  const f = fakeContext({});
  expect(
    await searchUcp(
      {
        ...input,
        origin: 'https://catalog.shopify.com',
        endpoint: 'https://catalog.shopify.com/api/ucp/mcp',
      },
      f.context,
    ),
  ).toEqual({ kind: 'unsupported' });
  expect(f.sent).toHaveLength(0);
});
it('preserves the typed fetch outcome and identifies an unsupported tool', async () => {
  expect(
    await searchUcp(input, fakeContext({ [endpoint]: { status: 429 } }).context),
  ).toMatchObject({ kind: 'fetch_failed', outcome: { kind: 'rate_limited' } });
  expect(
    await searchUcp(
      input,
      reply(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
      ),
    ),
  ).toEqual({ kind: 'unsupported' });
});
it.each([
  { ...rpc([product]), id: 2 },
  { ...rpc([product]), result: { isError: true, structuredContent: { products: [product] } } },
  {
    ...rpc([product]),
    result: { structuredContent: { ucp: { status: 'error' }, products: [product] } },
  },
])('rejects mismatching or failed responses', async (envelope) => {
  expect(await searchUcp(input, reply(JSON.stringify(envelope)))).toEqual({
    kind: 'invalid_response',
  });
});
