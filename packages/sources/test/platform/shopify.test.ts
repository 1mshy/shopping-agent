// The Shopify platform reader: `/products/<handle>.js` under the storefront's market prefix, the
// selected variant's price only, and a currency the platform itself states (S§2.2, S§2.3, S§5.2).
import { describe, expect, it } from 'vitest';
import { parseShopifyProductUrl, shopifyReader } from '../../src/platform/shopify.ts';
import type { StoreHints } from '../../src/read/contract.ts';
import {
  expectNoRead,
  expectRead,
  expectValidOutcome,
  fakeContext,
  fixture,
  type Reply,
  request,
} from './fake.ts';

const SHOP = 'https://shop.example.com';
const PLA = fixture('shopify/pla-pro.js.json');
const SSD = fixture('shopify/ssd-capacity.js.json');
const SINGLE = fixture('shopify/single-variant.js.json');

function cookie(code: string): string {
  return `cart_currency=${code}; path=/; expires=Wed, 09 Dec 2026 12:00:00 GMT; SameSite=Lax`;
}

function js(body: string, currency: string | null = 'CAD'): Reply {
  return {
    body,
    contentType: 'text/javascript; charset=utf-8',
    setCookies: currency === null ? [] : [cookie(currency)],
  };
}

const cart = (currency: string): Reply => ({
  body: JSON.stringify({ note: null, item_count: 0, items: [], total_price: 0, currency }),
});

function hints(extra: Partial<StoreHints> = {}): StoreHints {
  return {
    platform: 'shopify',
    marketPrefix: '',
    country: null,
    baseCurrency: 'unknown',
    locale: null,
    ...extra,
  };
}

describe('parseShopifyProductUrl', () => {
  it.each([
    [`${SHOP}/products/pla-pro`, '', 'pla-pro', null],
    [`${SHOP}/en-ca/products/pla-pro?variant=2`, '/en-ca', 'pla-pro', '2'],
    [`${SHOP}/collections/filament/products/pla-pro`, '', 'pla-pro', null],
    [`${SHOP}/fr-ca/collections/filament/products/pla-pro/`, '/fr-ca', 'pla-pro', null],
    [`${SHOP}/de/products/pla-pro`, '/de', 'pla-pro', null],
  ])('reads %s', (url, prefix, handle, variant) => {
    const parsed = parseShopifyProductUrl(url);
    expect(parsed?.localePrefix).toBe(prefix);
    expect(parsed?.handle).toBe(handle);
    expect(parsed?.urlVariant ?? null).toBe(variant);
  });

  it.each([
    `${SHOP}/collections/filament`,
    `${SHOP}/products/`,
    `${SHOP}/pages/products/pla-pro`,
    `${SHOP}/products/pla-pro/reviews`,
    'ftp://shop.example.com/products/pla-pro',
    'not a url',
  ])('is not a product path: %s', (url) => {
    expect(parseShopifyProductUrl(url)).toBeNull();
  });
});

describe('shopifyReader.applies', () => {
  it('applies to a product path on a Shopify store, with or without market and collection prefixes', () => {
    for (const path of ['/products/x', '/en-ca/products/x', '/collections/c/products/x']) {
      expect(shopifyReader.applies(request(SHOP + path, { store: hints() }))).toBe(true);
    }
    expect(shopifyReader.applies(request(`${SHOP}/collections/c`, { store: hints() }))).toBe(false);
  });

  it('applies on a product path when the platform is unknown: the probe is one request', () => {
    expect(shopifyReader.applies(request(`${SHOP}/products/x`))).toBe(true);
    expect(
      shopifyReader.applies(
        request(`${SHOP}/products/x`, { store: hints({ platform: 'unknown' }) }),
      ),
    ).toBe(true);
  });

  it('does not apply when the directory names another platform', () => {
    for (const platform of ['woo', 'magento', 'bigcommerce', 'wix', 'other'] as const) {
      expect(
        shopifyReader.applies(request(`${SHOP}/products/x`, { store: hints({ platform }) })),
      ).toBe(false);
    }
  });
});

describe('shopifyReader.read: variants', () => {
  it('prices the variant the URL selects, with the currency from the response cookie', async () => {
    const { context, sent } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA) });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=2`), context),
    );
    expect(read.currency).toBe('CAD');
    expect(read.sticker).toBe(3499);
    expect(read.availability).toBe('out');
    expect(read.identifiers).toEqual({
      brand: null,
      gtin: null,
      mpn: null,
      sku: 'PLA-RD',
      externalId: '2',
    });
    expect(read.variant).toEqual({ Color: 'Red' });
    expect(read.referenceClaimed).toBeNull();
    // The cookie on the product response answered the currency: no /cart.js request.
    expect(sent.map((s) => s.url)).toEqual([`${SHOP}/products/pla-pro.js`]);
    expect(sent[0]?.rung).toBe('api');
  });

  it('never answers with the cheapest variant when several exist and none is selected', async () => {
    // Known failure of the predecessor: it quoted the cheapest available variant.
    const { context, sent } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA) });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro`), context),
    );
    expect(outcome.reason).toBe('variant_not_found');
    expect(outcome.fetch).toBeNull();
    expect(outcome.candidates.map((c) => c.value).join(' | ')).toContain('3699');
    expect(outcome.candidates.map((c) => c.value).join(' | ')).toContain('3499');
    expect(sent).toHaveLength(1);
  });

  it('prices the requested higher-capacity variant, not the cheapest option', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/example-nvme-ssd.js`]: js(SSD, 'USD') });
    const read = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, {
          variant: { options: { capacity: '2tb', Heatsink: 'No' } },
        }),
        context,
      ),
    );
    expect(read.currency).toBe('USD');
    expect(read.sticker).toBe(15999);
    expect(read.variant).toEqual({ Capacity: '2TB', Heatsink: 'No' });
    expect(read.identifiers.externalId).toBe('44000000000002');
    // compare_at_price equal to the price is no claim of a reduction.
    expect(read.referenceClaimed).toBeNull();
  });

  it('selects by SKU and by variant id', async () => {
    const routes = { [`${SHOP}/products/example-nvme-ssd.js`]: js(SSD, 'USD') };
    const bySku = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, { variant: { sku: 'ssd-2t-hs' } }),
        fakeContext(routes).context,
      ),
    );
    expect(bySku.sticker).toBe(17999);
    const byId = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, { variant: { variantId: '44000000000001' } }),
        fakeContext(routes).context,
      ),
    );
    expect(byId.sticker).toBe(9999);
    expect(byId.referenceClaimed).toBe(11999);
  });

  it('refuses a selector that matches several variants or none', async () => {
    const routes = { [`${SHOP}/products/example-nvme-ssd.js`]: js(SSD, 'USD') };
    const partial = expectNoRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, { variant: { options: { Capacity: '2TB' } } }),
        fakeContext(routes).context,
      ),
    );
    expect(partial.reason).toBe('variant_not_found');
    const none = expectNoRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, { variant: { options: { Capacity: '8TB' } } }),
        fakeContext(routes).context,
      ),
    );
    expect(none.reason).toBe('variant_not_found');
    const unknownOption = expectNoRead(
      await shopifyReader.read(
        request(`${SHOP}/products/example-nvme-ssd`, {
          variant: { options: { Capacity: '2TB', Heatsink: 'No', Colour: 'Black' } },
        }),
        fakeContext(routes).context,
      ),
    );
    expect(unknownOption.reason).toBe('variant_not_found');
  });

  it('the selector wins over the URL variant', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA) });
    const read = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/products/pla-pro?variant=2`, { variant: { sku: 'PLA-BK' } }),
        context,
      ),
    );
    expect(read.sticker).toBe(3699);
  });

  it('refuses a URL variant that is not in the product', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA) });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=999`), context),
    );
    expect(outcome.reason).toBe('variant_not_found');
  });

  it('reads a single-variant product with no selector, and no options for Default Title', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(SINGLE, 'USD') });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(read.sticker).toBe(12900);
    expect(read.variant).toEqual({});
    expect(read.title).toBe('Red Rain Coat');
    expect(read.identifiers.sku).toBeNull();
    expect(read.availability).toBe('in');
  });

  it('keeps compare_at_price above the price as a claim, and its barcode as a GTIN', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA) });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=1`), context),
    );
    expect(read.sticker).toBe(3699);
    expect(read.referenceClaimed).toBe(4299);
    expect(read.identifiers.gtin).toBe('0012345678905');
    const values = read.candidates.map((c) => c.value);
    expect(values.some((v) => v.includes('3699'))).toBe(true);
    expect(values.some((v) => v.includes('4299'))).toBe(true);
  });

  it('bounds the work on a product with 10,000 variants', async () => {
    const variants = Array.from({ length: 10_000 }, (_, i) => ({
      id: i + 1,
      title: `V${i + 1}`,
      option1: `V${i + 1}`,
      sku: `SKU-${i + 1}`,
      available: true,
      price: 1000 + i,
    }));
    const body = JSON.stringify({
      id: 1,
      title: 'Many',
      handle: 'many',
      options: ['Size'],
      variants,
    });
    const { context } = fakeContext({ [`${SHOP}/products/many.js`]: js(body, 'USD') });
    const started = performance.now();
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/many?variant=9999`), context),
    );
    expect(read.sticker).toBe(1000 + 9998);
    const none = expectNoRead(await shopifyReader.read(request(`${SHOP}/products/many`), context));
    expect(none.reason).toBe('variant_not_found');
    expect(none.candidates.length).toBeLessThanOrEqual(20);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('shopifyReader.read: currency', () => {
  const REAL_JS = fixture('shopify/real-jpy.js.json');
  const REAL_JSON = fixture('shopify/real-jpy.json.json');
  const AVIOT = 'https://shop.aviot.jp/products/te-v1r-ad2';

  it('reads a real zero-decimal answer: .js 2288000 is ¥22,880 (real answer, 2026-11-24)', async () => {
    const { context, sent } = fakeContext({ [`${AVIOT}.js`]: js(REAL_JS, 'JPY') });
    const read = expectRead(await shopifyReader.read(request(AVIOT), context));
    expect(read.currency).toBe('JPY');
    expect(read.sticker).toBe(22880);
    expect(read.variant).toEqual({});
    expect(read.identifiers.sku).toBe('TE-V1R-AD2');
    expect(sent).toHaveLength(1);
  });

  it('with no cookie, the .json view states the currency beside a price that agrees with .js', async () => {
    // The same session's real .json answer: "22880" JPY for the variant whose .js says 2288000.
    const { context, sent } = fakeContext({
      [`${AVIOT}.js`]: js(REAL_JS, null),
      [`${AVIOT}.json`]: { body: REAL_JSON },
    });
    const read = expectRead(await shopifyReader.read(request(AVIOT), context));
    expect(read.currency).toBe('JPY');
    expect(read.sticker).toBe(22880);
    expect(sent.map((s) => s.url)).toEqual([`${AVIOT}.js`, `${AVIOT}.json`]);
  });

  it('a .json view whose price disagrees with .js is not believed, and /cart.js is not asked', async () => {
    const { context, sent } = fakeContext({
      [`${AVIOT}.js`]: js(REAL_JS, null),
      [`${AVIOT}.json`]: { body: REAL_JSON.replace('"22880"', '"23000"') },
      'https://shop.aviot.jp/cart.js': cart('JPY'),
    });
    const read = expectRead(await shopifyReader.read(request(AVIOT), context));
    expect(read.currency).toBe('unknown');
    expect(read.sticker).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('falls back to /cart.js under the same market prefix when neither cookie nor .json says', async () => {
    const { context, sent } = fakeContext({
      [`${SHOP}/en-ca/products/pla-pro.js`]: js(PLA, null),
      [`${SHOP}/en-ca/cart.js`]: cart('CAD'),
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/en-ca/products/pla-pro?variant=1`), context),
    );
    expect(read.currency).toBe('CAD');
    expect(read.sticker).toBe(3699);
    expect(sent.map((s) => s.url)).toEqual([
      `${SHOP}/en-ca/products/pla-pro.js`,
      `${SHOP}/en-ca/products/pla-pro.json`,
      `${SHOP}/en-ca/cart.js`,
    ]);
  });

  it('with no currency evidence the read keeps the figures as text and no amount', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA, null) });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=1`), context),
    );
    expect(read.currency).toBe('unknown');
    expect(read.sticker).toBeNull();
    expect(read.referenceClaimed).toBeNull();
    expect(read.availability).toBe('in');
    expect(read.candidates.some((c) => c.value.includes('3699'))).toBe(true);
  });

  it('never guesses the currency from the host: a .ca storefront with no evidence stays unknown', async () => {
    const { context } = fakeContext({
      'https://shop.example.ca/products/pla-pro.js': js(PLA, null),
      'https://shop.example.ca/cart.js': { status: 500, body: '' },
    });
    const read = expectRead(
      await shopifyReader.read(
        request('https://shop.example.ca/products/pla-pro?variant=1', {
          store: hints({ country: 'CA', baseCurrency: 'CAD', locale: 'en-CA' }),
        }),
        context,
      ),
    );
    expect(read.currency).toBe('unknown');
  });

  it('reads the market the prefix names, even when it bills another currency than the base', async () => {
    // Known failure: the default market (USD 25.99) is a different price list from /en-ca
    // (CAD 36.99); reading the root or labelling the figure with the base currency is wrong.
    const { context, sent } = fakeContext({
      [`${SHOP}/en-ca/products/pla-pro.js`]: js(PLA, 'CAD'),
      [`${SHOP}/products/pla-pro.js`]: js(fixture('shopify/pla-pro-us.js.json'), 'USD'),
    });
    const read = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/en-ca/products/pla-pro?variant=1`, {
          store: hints({ marketPrefix: '/en-ca', baseCurrency: 'USD', country: 'US' }),
        }),
        context,
      ),
    );
    expect(read.currency).toBe('CAD');
    expect(read.sticker).toBe(3699);
    expect(sent.map((s) => s.url)).toEqual([`${SHOP}/en-ca/products/pla-pro.js`]);
  });

  it("steers a root URL to the store's pinned market prefix", async () => {
    const { context, sent } = fakeContext({
      [`${SHOP}/en-ca/products/pla-pro.js`]: js(PLA, 'CAD'),
    });
    const read = expectRead(
      await shopifyReader.read(
        request(`${SHOP}/collections/filament/products/pla-pro?variant=1`, {
          store: hints({ marketPrefix: '/en-ca' }),
        }),
        context,
      ),
    );
    expect(read.currency).toBe('CAD');
    expect(sent[0]?.url).toBe(`${SHOP}/en-ca/products/pla-pro.js`);
  });

  it('a default-market price in USD read under no prefix is USD, the shop’s own price', async () => {
    const { context } = fakeContext({
      [`${SHOP}/products/pla-pro.js`]: js(fixture('shopify/pla-pro-us.js.json'), 'USD'),
    });
    const read = expectRead(await shopifyReader.read(request(`${SHOP}/products/pla-pro`), context));
    expect(read.currency).toBe('USD');
    expect(read.sticker).toBe(2599);
  });

  it('two different currencies in the cookies are no evidence', async () => {
    const { context, sent } = fakeContext({
      [`${SHOP}/products/pla-pro.js`]: { body: PLA, setCookies: [cookie('CAD'), cookie('USD')] },
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=1`), context),
    );
    expect(read.currency).toBe('unknown');
    expect(sent).toHaveLength(1);
  });

  it('a cookie that clears cart_currency is not evidence', async () => {
    const { context } = fakeContext({
      [`${SHOP}/products/pla-pro.js`]: {
        body: PLA,
        setCookies: ['cart_currency=; path=/; max-age=0', 'cart_currency=USD; Max-Age=0'],
      },
      [`${SHOP}/cart.js`]: cart('CAD'),
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=1`), context),
    );
    expect(read.currency).toBe('CAD');
  });

  it('a stated code that is not a listing currency leaves the currency unknown', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(PLA, 'XXX') });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro?variant=1`), context),
    );
    expect(read.currency).toBe('unknown');
  });

  it('reads a zero-decimal currency: the .js integers are hundredths of a yen', async () => {
    const { context } = fakeContext({
      [`${SHOP}/products/example-earphones.js`]: js(
        fixture('shopify/jpy-earphones.js.json'),
        'JPY',
      ),
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/example-earphones`), context),
    );
    expect(read.currency).toBe('JPY');
    expect(read.sticker).toBe(16500);
    expect(read.referenceClaimed).toBe(19800);
  });

  it('refuses a zero-decimal figure that is not a whole number of yen', async () => {
    const body = fixture('shopify/jpy-earphones.js.json').replaceAll('1650000', '1650050');
    const { context } = fakeContext({ [`${SHOP}/products/example-earphones.js`]: js(body, 'JPY') });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/example-earphones`), context),
    );
    expect(outcome.reason).toBe('unreadable_price');
    expect(outcome.candidates.some((c) => c.value.includes('1650050'))).toBe(true);
  });

  it('refuses a three-decimal currency: hundredths cannot be read as fils', async () => {
    const { context } = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(SINGLE, 'KWD') });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(outcome.reason).toBe('unreadable_price');
    expect(outcome.detail).toContain('KWD');
  });
});

describe('shopifyReader.read: failures and hostile input', () => {
  it('a 404 on the .js endpoint is not_applicable: not Shopify, or not this product', async () => {
    const { context } = fakeContext({});
    expect(await shopifyReader.read(request(`${SHOP}/products/pla-pro`), context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it('any other failed fetch is fetch_failed with the outcome untouched', async () => {
    const wall = { kind: 'wall', rung: 'api', vendor: 'cloudflare', mode: 'challenge' } as const;
    const { context } = fakeContext({
      [`${SHOP}/products/pla-pro.js`]: { status: 403, body: '<html></html>', outcome: wall },
    });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro`), context),
    );
    expect(outcome.reason).toBe('fetch_failed');
    expect(outcome.fetch).toEqual(wall);

    const limited = fakeContext({ [`${SHOP}/products/pla-pro.js`]: { status: 429 } });
    const second = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/pla-pro`), limited.context),
    );
    expect(second.fetch).toEqual({ kind: 'rate_limited', rung: 'api', retryAfterMs: 30_000 });
  });

  it('a context that throws is a fetch failure, not a crash', async () => {
    const outcome = await shopifyReader.read(request(`${SHOP}/products/pla-pro`), {
      get: () => Promise.reject(new Error('boom')),
      now: () => 0,
    });
    expect(expectNoRead(outcome).reason).toBe('fetch_failed');
  });

  it.each([
    ['an HTML challenge served with 200', '<!DOCTYPE html><title>Just a moment...</title>'],
    ['truncated JSON', PLA.slice(0, 200)],
    ['JSON that is not a product', '{"products":[]}'],
    ['a product without variants', '{"id":1,"title":"x","variants":[]}'],
  ])('%s is not_applicable', async (_name, body) => {
    const { context } = fakeContext({ [`${SHOP}/products/pla-pro.js`]: js(body) });
    expect(await shopifyReader.read(request(`${SHOP}/products/pla-pro`), context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it.each([
    ['a price as a word', '"abc"'],
    ['a fractional price', '36.99'],
    ['a negative price', '-3699'],
    ['a price in exponent form', '3.699e3'],
    ['an object', '{"amount":3699}'],
  ])('refuses %s as unreadable, never throwing', async (_name, price) => {
    const body = JSON.stringify(JSON.parse(SINGLE)).replace(
      '"price":12900,"compare',
      `"price":${price},"compare`,
    );
    expect(body).not.toBe(JSON.stringify(JSON.parse(SINGLE)));
    const { context } = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(body, 'USD') });
    const outcome = await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context);
    expectValidOutcome(outcome);
    expect(outcome.kind).toBe('no_read');
    if (outcome.kind === 'no_read') expect(outcome.reason).toBe('unreadable_price');
  });

  it('a zero price is a placeholder, not a price', async () => {
    const body = SINGLE.replaceAll('12900', '0');
    const { context } = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(body, 'USD') });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(outcome.reason).toBe('no_price');
  });

  it('a missing price on an available variant is no_price; on a sold-out one it is a stock read', async () => {
    const product = JSON.parse(SINGLE);
    delete product.variants[0].price;
    const missing = JSON.stringify(product);
    const { context } = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(missing, 'USD') });
    const outcome = expectNoRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(outcome.reason).toBe('no_price');

    product.variants[0].available = false;
    const soldOut = JSON.stringify(product);
    const second = fakeContext({ [`${SHOP}/products/red-rain-coat.js`]: js(soldOut, 'USD') });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), second.context),
    );
    expect(read.sticker).toBeNull();
    expect(read.availability).toBe('out');
  });

  it('reads a payload of several MB', async () => {
    const product = JSON.parse(SINGLE);
    product.description = 'x'.repeat(3_000_000);
    const { context } = fakeContext({
      [`${SHOP}/products/red-rain-coat.js`]: js(JSON.stringify(product), 'USD'),
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(read.sticker).toBe(12900);
  });

  it('fields of the wrong type are read as unknown, never thrown on', async () => {
    const product = JSON.parse(SINGLE);
    product.title = { en: 'x' };
    product.variants[0].available = 'yes';
    product.variants[0].sku = 12;
    product.variants[0].compare_at_price = 'soon';
    product.options = 'Title';
    const { context } = fakeContext({
      [`${SHOP}/products/red-rain-coat.js`]: js(JSON.stringify(product), 'USD'),
    });
    const read = expectRead(
      await shopifyReader.read(request(`${SHOP}/products/red-rain-coat`), context),
    );
    expect(read.title).toBeNull();
    expect(read.availability).toBe('unknown');
    expect(read.identifiers.sku).toBeNull();
    expect(read.referenceClaimed).toBeNull();
    expect(read.sticker).toBe(12900);
  });
});
