// The WooCommerce Store API reader: exact integer-string amounts at the stated minor unit, and a
// variable product priced only through its selected variation (S§2.2, S§5.2).
import { describe, expect, it } from 'vitest';
import { parseWooProductUrl, wooReader } from '../../src/platform/woo.ts';
import type { StoreHints } from '../../src/read/contract.ts';
import { expectNoRead, expectRead, fakeContext, fixture, type Reply, request } from './fake.ts';

const SHOP = 'https://shop.example';
const API = `${SHOP}/wp-json/wc/store/v1/products`;
const PENNANT = fixture('woo/pennant-by-slug.json');
const HOODIE = fixture('woo/hoodie-by-slug.json');
const VARIATION = fixture('woo/hoodie-variation-102.json');

function hints(extra: Partial<StoreHints> = {}): StoreHints {
  return {
    platform: 'woo',
    marketPrefix: '',
    country: null,
    baseCurrency: 'unknown',
    locale: null,
    ...extra,
  };
}

const ok = (body: string): Reply => ({ body });

/** The pennant with its `prices` (and anything else) changed. */
function pennant(change: (product: Record<string, any>) => void): string {
  const list = JSON.parse(PENNANT);
  change(list[0]);
  return JSON.stringify(list);
}

/** Variation 102 turned into another variation of the hoodie. */
function variation(id: number, price: string, sku: string): string {
  const v = JSON.parse(VARIATION);
  v.id = id;
  v.sku = sku;
  v.prices.price = price;
  v.prices.regular_price = price;
  v.prices.sale_price = price;
  return JSON.stringify(v);
}

const woo = (url: string, extra = {}) => request(url, { store: hints(), ...extra });

describe('parseWooProductUrl', () => {
  it('reads a slug, an id and the variation attributes', () => {
    expect(parseWooProductUrl(`${SHOP}/product/test-pennant/`)).toMatchObject({
      slug: 'test-pennant',
      id: null,
    });
    expect(parseWooProductUrl(`${SHOP}/?p=34`)).toMatchObject({ id: '34' });
    expect(
      parseWooProductUrl(`${SHOP}/shop/clothing/hoodie/?attribute_pa_color=blue`),
    ).toMatchObject({
      slug: 'hoodie',
      attributes: [['pa_color', 'blue']],
    });
    expect(parseWooProductUrl(`${SHOP}/`)).toBeNull();
  });
});

describe('wooReader.applies', () => {
  it('applies only when the directory says the store runs WooCommerce', () => {
    expect(wooReader.applies(woo(`${SHOP}/product/test-pennant/`))).toBe(true);
    expect(wooReader.applies(request(`${SHOP}/product/test-pennant/`))).toBe(false);
    expect(
      wooReader.applies(request(`${SHOP}/product/x/`, { store: hints({ platform: 'unknown' }) })),
    ).toBe(false);
    expect(
      wooReader.applies(request(`${SHOP}/product/x/`, { store: hints({ platform: 'shopify' }) })),
    ).toBe(false);
    expect(wooReader.applies(woo(`${SHOP}/`))).toBe(false);
  });
});

describe('wooReader.read: simple products', () => {
  it('reads the integer-string amounts exactly at the stated minor unit', async () => {
    const { context, sent } = fakeContext({ [`${API}?slug=test-pennant`]: ok(PENNANT) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.currency).toBe('GBP');
    expect(read.sticker).toBe(1105);
    expect(read.referenceClaimed).toBe(1250);
    expect(read.availability).toBe('in');
    expect(read.title).toBe('Test Pennant – Felt');
    expect(read.identifiers).toEqual({
      brand: null,
      gtin: null,
      mpn: null,
      sku: 'PEN-1',
      externalId: '34',
    });
    expect(read.variant).toEqual({});
    expect(read.candidates.some((c) => c.value.includes('1105'))).toBe(true);
    expect(sent).toEqual([{ url: `${API}?slug=test-pennant`, rung: 'api' }]);
  });

  it('reads by id when the URL names the post id', async () => {
    const one = JSON.stringify(JSON.parse(PENNANT)[0]);
    const { context, sent } = fakeContext({ [`${API}/34`]: ok(one) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/?p=34`), context));
    expect(read.sticker).toBe(1105);
    expect(sent.map((s) => s.url)).toEqual([`${API}/34`]);
  });

  it('a regular price that is not above the price is no claim', async () => {
    const body = pennant((p) => {
      p.prices.regular_price = '1105';
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.referenceClaimed).toBeNull();
  });

  it.each([
    ['JPY at minor unit 2, whole yen', 'JPY', 2, '150000', 1500],
    ['USD at minor unit 0', 'USD', 0, '15', 1500],
    ['KWD at minor unit 3', 'KWD', 3, '12500', 12500],
    ['KWD at minor unit 2, scaled exactly', 'KWD', 2, '1250', 12500],
  ])(
    'converts a minor unit that differs from ISO only when exact: %s',
    async (_n, code, unit, price, minor) => {
      const body = pennant((p) => {
        p.prices = {
          ...p.prices,
          currency_code: code,
          currency_minor_unit: unit,
          price,
          regular_price: price,
        };
      });
      const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
      const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
      expect(read.currency).toBe(code);
      expect(read.sticker).toBe(minor);
    },
  );

  it.each([
    ['JPY at minor unit 2 with a fraction of a yen', 'JPY', 2, '150050'],
    ['a minor unit beyond any currency', 'USD', 9, '1105'],
    ['a minor unit as text', 'USD', '2', '1105'],
    ['a price with a decimal point', 'USD', 2, '11.05'],
    ['a negative price', 'USD', 2, '-1105'],
  ])('refuses %s', async (_n, code, unit, price) => {
    const body = pennant((p) => {
      p.prices = { ...p.prices, currency_code: code, currency_minor_unit: unit, price };
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const outcome = expectNoRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context),
    );
    expect(outcome.reason).toBe('unreadable_price');
  });

  it('accepts an amount written as a JSON integer, from its digits', async () => {
    const body = PENNANT.replace('"price": "1105"', '"price": 1105');
    expect(body).not.toBe(PENNANT);
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.sticker).toBe(1105);
  });

  it('with no currency code the figures stay as text and no amount', async () => {
    const body = pennant((p) => {
      delete p.prices.currency_code;
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.currency).toBe('unknown');
    expect(read.sticker).toBeNull();
    expect(read.candidates.some((c) => c.value.includes('1105'))).toBe(true);
  });

  it('refuses a figure in another currency than the store bills in', async () => {
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(PENNANT) });
    const outcome = expectNoRead(
      await wooReader.read(
        woo(`${SHOP}/product/test-pennant/`, { store: hints({ baseCurrency: 'EUR' }) }),
        context,
      ),
    );
    expect(outcome.reason).toBe('converted_currency');
    expect(outcome.candidates.length).toBeGreaterThan(0);
  });

  it('stock: out of stock with no price is a stock read; no price in stock is no_price', async () => {
    const soldOut = pennant((p) => {
      p.prices.price = '';
      p.prices.regular_price = '';
      p.prices.sale_price = '';
      p.is_in_stock = false;
      p.is_purchasable = false;
    });
    const first = fakeContext({ [`${API}?slug=test-pennant`]: ok(soldOut) });
    const read = expectRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), first.context),
    );
    expect(read.sticker).toBeNull();
    expect(read.availability).toBe('out');

    const noPrice = pennant((p) => {
      p.prices.price = '';
    });
    const second = fakeContext({ [`${API}?slug=test-pennant`]: ok(noPrice) });
    const outcome = expectNoRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), second.context),
    );
    expect(outcome.reason).toBe('no_price');

    const zero = pennant((p) => {
      p.prices.price = '0';
    });
    const third = fakeContext({ [`${API}?slug=test-pennant`]: ok(zero) });
    expect(
      expectNoRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), third.context))
        .reason,
    ).toBe('no_price');
  });

  it('in stock but not purchasable is unknown availability', async () => {
    const body = pennant((p) => {
      p.is_purchasable = false;
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.availability).toBe('unknown');
  });

  it('a grouped product with a price range is multiple_prices', async () => {
    const body = pennant((p) => {
      p.type = 'grouped';
      p.prices.price_range = { min_amount: '500', max_amount: '1500' };
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const outcome = expectNoRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context),
    );
    expect(outcome.reason).toBe('multiple_prices');
  });
});

describe('wooReader.read: variable products', () => {
  it('never offers the parent price range for a variant', async () => {
    // Known failure: the parent's price (the cheapest variation) quoted for the listing.
    const { context, sent } = fakeContext({ [`${API}?slug=hoodie`]: ok(HOODIE) });
    const outcome = expectNoRead(await wooReader.read(woo(`${SHOP}/product/hoodie/`), context));
    expect(outcome.reason).toBe('variant_not_found');
    expect(outcome.candidates.map((c) => c.value).join(' | ')).toContain('5500');
    expect(sent).toHaveLength(1);
  });

  it('resolves the variation the URL attributes select and reads its own prices', async () => {
    const { context, sent } = fakeContext({
      [`${API}?slug=hoodie`]: ok(HOODIE),
      [`${API}/102`]: ok(VARIATION),
    });
    const read = expectRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/?attribute_pa_color=blue&attribute_pa_size=large`),
        context,
      ),
    );
    expect(read.sticker).toBe(5500);
    expect(read.currency).toBe('USD');
    expect(read.variant).toEqual({ Color: 'Blue', Size: 'Large' });
    expect(read.identifiers.sku).toBe('HOOD-BL-L');
    expect(read.identifiers.externalId).toBe('102');
    expect(read.referenceClaimed).toBeNull();
    expect(sent.map((s) => s.url)).toEqual([`${API}?slug=hoodie`, `${API}/102`]);
  });

  it('resolves by the selector options (names and values as the store writes them) and by id', async () => {
    const routes = {
      [`${API}?slug=hoodie`]: ok(HOODIE),
      [`${API}/103`]: ok(variation(103, '4200', 'HOOD-RD-S')),
      [`${API}/104`]: ok(variation(104, '4800', 'HOOD-RD-L')),
    };
    const byOptions = expectRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/`, { variant: { options: { Color: 'Red', size: 'small' } } }),
        fakeContext(routes).context,
      ),
    );
    expect(byOptions.sticker).toBe(4200);
    const byId = expectRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/`, { variant: { variantId: '104' } }),
        fakeContext(routes).context,
      ),
    );
    expect(byId.sticker).toBe(4800);
  });

  it('refuses a partial or unknown selection, and a SKU it cannot resolve without the variations', async () => {
    const routes = { [`${API}?slug=hoodie`]: ok(HOODIE) };
    for (const variant of [
      { options: { Color: 'Red' } },
      { options: { Color: 'Green', Size: 'Small' } },
      { variantId: '999' },
      { sku: 'HOOD-RD-S' },
    ]) {
      const outcome = expectNoRead(
        await wooReader.read(
          woo(`${SHOP}/product/hoodie/`, { variant }),
          fakeContext(routes).context,
        ),
      );
      expect(outcome.reason).toBe('variant_not_found');
    }
  });

  it('refuses a variation whose SKU contradicts the selector', async () => {
    const { context } = fakeContext({
      [`${API}?slug=hoodie`]: ok(HOODIE),
      [`${API}/102`]: ok(VARIATION),
    });
    const outcome = expectNoRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/`, { variant: { variantId: '102', sku: 'HOOD-RD-S' } }),
        context,
      ),
    );
    expect(outcome.reason).toBe('variant_not_found');
  });

  it('an "any" attribute value matches the requested value', async () => {
    const parent = JSON.parse(HOODIE);
    parent[0].variations = [
      {
        id: 102,
        attributes: [
          { name: 'Color', value: 'blue' },
          { name: 'Size', value: '' },
        ],
      },
    ];
    const { context } = fakeContext({
      [`${API}?slug=hoodie`]: ok(JSON.stringify(parent)),
      [`${API}/102`]: ok(VARIATION),
    });
    const read = expectRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/?attribute_pa_color=blue&attribute_pa_size=large`),
        context,
      ),
    );
    expect(read.sticker).toBe(5500);
  });

  it('a variation that belongs to another product is refused', async () => {
    const other = JSON.parse(VARIATION);
    other.parent = 555;
    const { context } = fakeContext({
      [`${API}?slug=hoodie`]: ok(HOODIE),
      [`${API}/102`]: ok(JSON.stringify(other)),
    });
    const outcome = expectNoRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/`, { variant: { variantId: '102' } }),
        context,
      ),
    );
    expect(outcome.reason).toBe('variant_not_found');
  });

  it('a failed variation request is fetch_failed, even a 404', async () => {
    const { context } = fakeContext({ [`${API}?slug=hoodie`]: ok(HOODIE) });
    const outcome = expectNoRead(
      await wooReader.read(
        woo(`${SHOP}/product/hoodie/`, { variant: { variantId: '102' } }),
        context,
      ),
    );
    expect(outcome.reason).toBe('fetch_failed');
    expect(outcome.fetch).toEqual({ kind: 'not_found', rung: 'api' });
  });
});

describe('wooReader.read: failures and hostile input', () => {
  it('a 404 (rest_no_route) or an empty list is not_applicable', async () => {
    const notFound = fakeContext({
      [`${API}?slug=test-pennant`]: {
        status: 404,
        body: '{"code":"rest_no_route","data":{"status":404}}',
      },
    });
    expect(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), notFound.context)).toEqual({
      kind: 'not_applicable',
    });
    const empty = fakeContext({ [`${API}?slug=test-pennant`]: ok('[]') });
    expect(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), empty.context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it('a login wall is fetch_failed with the outcome untouched', async () => {
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: { status: 401, body: '{}' } });
    const outcome = expectNoRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context),
    );
    expect(outcome.reason).toBe('fetch_failed');
    expect(outcome.fetch).toEqual({ kind: 'login_required', rung: 'api' });
  });

  it.each([
    ['an HTML page served with 200', '<html><body>Shop</body></html>'],
    ['truncated JSON', PENNANT.slice(0, 120)],
    ['an object where a list was expected', '{"code":"x"}'],
    ['a list of non-products', '[1,2,3]'],
  ])('%s is not_applicable', async (_n, body) => {
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    expect(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it('two products answering one slug is multiple_prices', async () => {
    const list = JSON.parse(PENNANT);
    list.push({ ...list[0], id: 35 });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(JSON.stringify(list)) });
    const outcome = expectNoRead(
      await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context),
    );
    expect(outcome.reason).toBe('multiple_prices');
  });

  it('fields of the wrong type are unknown, never thrown on', async () => {
    const body = pennant((p) => {
      p.name = 7;
      p.sku = ['x'];
      p.is_in_stock = 'yes';
      p.prices.regular_price = { x: 1 };
    });
    const { context } = fakeContext({ [`${API}?slug=test-pennant`]: ok(body) });
    const read = expectRead(await wooReader.read(woo(`${SHOP}/product/test-pennant/`), context));
    expect(read.title).toBeNull();
    expect(read.identifiers.sku).toBeNull();
    expect(read.availability).toBe('unknown');
    expect(read.referenceClaimed).toBeNull();
    expect(read.sticker).toBe(1105);
  });

  it('bounds the work on 10,000 variations', async () => {
    const parent = JSON.parse(HOODIE);
    parent[0].variations = Array.from({ length: 10_000 }, (_, i) => ({
      id: 1000 + i,
      attributes: [{ name: 'Size', value: `s${i}` }],
    }));
    const { context } = fakeContext({ [`${API}?slug=hoodie`]: ok(JSON.stringify(parent)) });
    const started = performance.now();
    const outcome = expectNoRead(await wooReader.read(woo(`${SHOP}/product/hoodie/`), context));
    expect(outcome.reason).toBe('variant_not_found');
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
