// The Magento 2 GraphQL reader, sent as GET: prices from the digits of each JSON number, a
// configurable product priced only through its selected variant, and the display currency checked
// against the store's base currency (S§2.2, S§2.3, S§5.2).
import { describe, expect, it } from 'vitest';
import {
  magentoReader,
  magentoRequestUrl,
  parseMagentoProductUrl,
} from '../../src/platform/magento.ts';
import type { StoreHints } from '../../src/read/contract.ts';
import { expectNoRead, expectRead, fakeContext, fixture, type Reply, request } from './fake.ts';

const SHOP = 'https://shop.example.de';
const JACKET = fixture('magento/jacket-simple.json');
const TEE = fixture('magento/tee-configurable.json');
const JACKET_URL = magentoRequestUrl(SHOP, { urlKey: 'test-jacket' });
const TEE_URL = magentoRequestUrl(SHOP, { urlKey: 'gym-tee' });

function hints(extra: Partial<StoreHints> = {}): StoreHints {
  return {
    platform: 'magento',
    marketPrefix: '',
    country: null,
    baseCurrency: 'unknown',
    locale: null,
    ...extra,
  };
}

const ok = (body: string): Reply => ({ body });
const magento = (url: string, extra = {}) => request(url, { store: hints(), ...extra });

/** The jacket response with a change applied to its one item and the response. */
function jacket(change: (item: Record<string, any>, data: Record<string, any>) => void): string {
  const body = JSON.parse(JACKET);
  change(body.data.products.items[0], body.data);
  return JSON.stringify(body);
}

describe('parseMagentoProductUrl and the request', () => {
  it('reads the URL key from the last path segment, without the .html suffix', () => {
    expect(parseMagentoProductUrl(`${SHOP}/test-jacket.html`)?.urlKey).toBe('test-jacket');
    expect(parseMagentoProductUrl(`${SHOP}/men/tops/test-jacket.html?color=49`)?.urlKey).toBe(
      'test-jacket',
    );
    expect(parseMagentoProductUrl(`${SHOP}/test-jacket`)?.urlKey).toBe('test-jacket');
    expect(parseMagentoProductUrl(`${SHOP}/catalog/product/view/id/5`)?.urlKey ?? null).toBeNull();
    expect(parseMagentoProductUrl(`${SHOP}/`)?.urlKey ?? null).toBeNull();
  });

  it('asks one GET of /graphql with the url_key filter, the variants and the base currency', () => {
    const url = new URL(JACKET_URL);
    expect(url.origin + url.pathname).toBe(`${SHOP}/graphql`);
    const query = url.searchParams.get('query') ?? '';
    expect(query).toContain('products(filter:{url_key:{eq:"test-jacket"}}');
    expect(query).toContain('final_price{value currency}');
    expect(query).toContain('... on ConfigurableProduct');
    expect(query).toContain('currency{base_currency_code}');
    const bySku = new URL(magentoRequestUrl(SHOP, { sku: 'TJ02' })).searchParams.get('query');
    expect(bySku).toContain('products(filter:{sku:{eq:"TJ02"}}');
  });

  it('writes a URL key with quotes as an escaped GraphQL string', () => {
    const parsed = parseMagentoProductUrl(`${SHOP}/a%22%7D%7Bx.html`);
    expect(parsed?.urlKey).toBe('a"}{x');
    const query = new URL(magentoRequestUrl(SHOP, { urlKey: 'a"}{x' })).searchParams.get('query');
    expect(query).toContain('{eq:"a\\"}{x"}');
  });
});

describe('magentoReader.applies', () => {
  it('applies only when the directory says Magento, on a URL key or a SKU selector', () => {
    expect(magentoReader.applies(magento(`${SHOP}/test-jacket.html`))).toBe(true);
    expect(magentoReader.applies(magento(`${SHOP}/catalog/product/view/id/5`))).toBe(false);
    expect(
      magentoReader.applies(
        magento(`${SHOP}/catalog/product/view/id/5`, { variant: { sku: 'TJ02' } }),
      ),
    ).toBe(true);
    expect(magentoReader.applies(request(`${SHOP}/test-jacket.html`))).toBe(false);
    expect(
      magentoReader.applies(
        request(`${SHOP}/test-jacket.html`, { store: hints({ platform: 'unknown' }) }),
      ),
    ).toBe(false);
  });
});

describe('magentoReader.read: simple products', () => {
  it('reads final and regular price from the digits of the JSON numbers', async () => {
    const { context, sent } = fakeContext({ [JACKET_URL]: ok(JACKET) });
    const read = expectRead(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context));
    expect(read.currency).toBe('USD');
    expect(read.sticker).toBe(5625);
    expect(read.referenceClaimed).toBe(6625);
    expect(read.availability).toBe('in');
    expect(read.title).toBe('Test Jacket');
    expect(read.identifiers).toEqual({
      brand: null,
      gtin: null,
      mpn: null,
      sku: 'TJ02',
      externalId: '1180',
    });
    expect(read.candidates.some((c) => c.value.includes('56.25'))).toBe(true);
    expect(sent).toEqual([{ url: JACKET_URL, rung: 'api' }]);
  });

  it('reads by SKU when the URL has no key', async () => {
    const { context } = fakeContext({ [magentoRequestUrl(SHOP, { sku: 'TJ02' })]: ok(JACKET) });
    const read = expectRead(
      await magentoReader.read(
        magento(`${SHOP}/catalog/product/view/id/5`, { variant: { sku: 'TJ02' } }),
        context,
      ),
    );
    expect(read.sticker).toBe(5625);
  });

  it.each([
    ['a value beyond the currency precision', '56.2500001'],
    ['a value in exponent form', '5.625e1'],
    ['a negative value', '-56.25'],
    ['a value as a string', '"56.25"'],
  ])('refuses %s, never rounding it', async (_n, value) => {
    const body = JACKET.replaceAll('"value": 56.25', `"value": ${value}`);
    expect(body).not.toBe(JACKET);
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.reason).toBe('unreadable_price');
  });

  it('reads a zero-decimal currency from a whole number, and refuses a fraction of a yen', async () => {
    const yen = JACKET.replaceAll('USD', 'JPY')
      .replaceAll('56.25', '5625')
      .replaceAll('66.25', '6625');
    const first = fakeContext({ [JACKET_URL]: ok(yen) });
    const read = expectRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), first.context),
    );
    expect(read.currency).toBe('JPY');
    expect(read.sticker).toBe(5625);
    const half = fakeContext({ [JACKET_URL]: ok(yen.replaceAll('5625', '5625.5')) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), half.context),
    );
    expect(outcome.reason).toBe('unreadable_price');
  });

  it('refuses a display currency that is not the base currency: a converted figure', async () => {
    const body = jacket((_item, data) => {
      data.currency.base_currency_code = 'EUR';
    });
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.reason).toBe('converted_currency');
    expect(outcome.candidates.length).toBeGreaterThan(0);
  });

  it('with no base currency stated the figures stay as text', async () => {
    const body = jacket((_item, data) => {
      data.currency = null;
    });
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const read = expectRead(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context));
    expect(read.currency).toBe('unknown');
    expect(read.sticker).toBeNull();
  });

  it('a product with a price range (bundle, grouped) has no one price', async () => {
    const body = jacket((item) => {
      item.__typename = 'BundleProduct';
      item.price_range.maximum_price.final_price.value = 99.5;
    });
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.reason).toBe('multiple_prices');
  });

  it('out of stock, a regular price at the final price, and a selector that names another SKU', async () => {
    const body = jacket((item) => {
      item.stock_status = 'OUT_OF_STOCK';
      item.price_range.minimum_price.regular_price.value = 56.25;
    });
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const read = expectRead(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context));
    expect(read.availability).toBe('out');
    expect(read.referenceClaimed).toBeNull();
    const other = expectNoRead(
      await magentoReader.read(
        magento(`${SHOP}/test-jacket.html`, { variant: { sku: 'TJ03' } }),
        fakeContext({ [JACKET_URL]: ok(JACKET) }).context,
      ),
    );
    expect(other.reason).toBe('variant_not_found');
  });
});

describe('magentoReader.read: configurable products', () => {
  it("never answers with the parent's minimum price when no variant is selected", async () => {
    const { context } = fakeContext({ [TEE_URL]: ok(TEE) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/gym-tee.html`), context),
    );
    expect(outcome.reason).toBe('variant_not_found');
    const values = outcome.candidates.map((c) => c.value).join(' | ');
    expect(values).toContain('34');
    expect(values).toContain('GT01-M-Red');
  });

  it('prices the variant the selector names, by option labels, SKU or id', async () => {
    const routes = { [TEE_URL]: ok(TEE) };
    const byOptions = expectRead(
      await magentoReader.read(
        magento(`${SHOP}/gym-tee.html`, { variant: { options: { color: 'red', Size: 'M' } } }),
        fakeContext(routes).context,
      ),
    );
    expect(byOptions.currency).toBe('EUR');
    expect(byOptions.sticker).toBe(3400);
    expect(byOptions.variant).toEqual({ Color: 'Red', Size: 'M' });
    expect(byOptions.identifiers.sku).toBe('GT01-M-Red');
    expect(byOptions.identifiers.externalId).toBe('1503');
    expect(byOptions.title).toBe('Gym Tee');

    const bySku = expectRead(
      await magentoReader.read(
        magento(`${SHOP}/gym-tee.html`, { variant: { sku: 'GT01-S-Black' } }),
        fakeContext(routes).context,
      ),
    );
    expect(bySku.sticker).toBe(2450);
    expect(bySku.referenceClaimed).toBe(2900);

    const byId = expectRead(
      await magentoReader.read(
        magento(`${SHOP}/gym-tee.html`, { variant: { variantId: '1502' } }),
        fakeContext(routes).context,
      ),
    );
    expect(byId.sticker).toBe(2900);
    expect(byId.availability).toBe('out');
  });

  it('refuses a partial or unknown selection', async () => {
    const routes = { [TEE_URL]: ok(TEE) };
    for (const variant of [
      { options: { Color: 'Black' } },
      { options: { Color: 'Red', Size: 'S' } },
      { options: { Color: 'Red', Size: 'M', Material: 'Cotton' } },
    ]) {
      const outcome = expectNoRead(
        await magentoReader.read(
          magento(`${SHOP}/gym-tee.html`, { variant }),
          fakeContext(routes).context,
        ),
      );
      expect(outcome.reason).toBe('variant_not_found');
    }
  });

  it('bounds the work on 10,000 variants', async () => {
    const body = JSON.parse(TEE);
    const item = body.data.products.items[0];
    const template = item.variants[0];
    item.variants = Array.from({ length: 10_000 }, (_, i) => ({
      ...template,
      product: { ...template.product, id: 20_000 + i, sku: `V-${i}` },
    }));
    const { context } = fakeContext({ [TEE_URL]: ok(JSON.stringify(body)) });
    const started = performance.now();
    const read = expectRead(
      await magentoReader.read(
        magento(`${SHOP}/gym-tee.html`, { variant: { sku: 'V-9999' } }),
        context,
      ),
    );
    expect(read.sticker).toBe(2450);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('magentoReader.read: failures and hostile input', () => {
  it('a 404 on /graphql (Magento 1, or no Magento) and an empty item list are not_applicable', async () => {
    expect(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), fakeContext({}).context),
    ).toEqual({
      kind: 'not_applicable',
    });
    const parsed = JSON.parse(JACKET);
    parsed.data.products.items = [];
    const empty = JSON.stringify(parsed);
    const second = fakeContext({ [JACKET_URL]: ok(empty) });
    expect(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), second.context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it('a wall is fetch_failed with the outcome untouched', async () => {
    const wall = { kind: 'wall', rung: 'api', vendor: 'cloudflare', mode: 'challenge' } as const;
    const { context } = fakeContext({ [JACKET_URL]: { status: 403, outcome: wall } });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.fetch).toEqual(wall);
  });

  it('a GraphQL error answer is no_read with the error in the detail', async () => {
    const { context } = fakeContext({
      [JACKET_URL]: ok(
        JSON.stringify({
          errors: [
            { message: 'Field "price_range" is not defined', extensions: { category: 'graphql' } },
          ],
        }),
      ),
    });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.reason).toBe('no_price');
    expect(outcome.detail).toContain('price_range');
  });

  it.each([
    ['an HTML page served with 200', '<!DOCTYPE html><title>404 Not Found 1</title>'],
    ['truncated JSON', JACKET.slice(0, 150)],
    ['JSON without data.products', '{"data":{}}'],
  ])('%s is not_applicable', async (_n, body) => {
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    expect(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context)).toEqual({
      kind: 'not_applicable',
    });
  });

  it('two products with the URL key is multiple_prices', async () => {
    const body = JSON.parse(JACKET);
    body.data.products.items.push({ ...body.data.products.items[0], sku: 'TJ02-B' });
    const { context } = fakeContext({ [JACKET_URL]: ok(JSON.stringify(body)) });
    const outcome = expectNoRead(
      await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context),
    );
    expect(outcome.reason).toBe('multiple_prices');
  });

  it('fields of the wrong type are unknown, never thrown on', async () => {
    const body = jacket((item) => {
      item.name = ['x'];
      item.sku = 5;
      item.stock_status = true;
      item.price_range.minimum_price.regular_price = 'n/a';
    });
    const { context } = fakeContext({ [JACKET_URL]: ok(body) });
    const read = expectRead(await magentoReader.read(magento(`${SHOP}/test-jacket.html`), context));
    expect(read.title).toBeNull();
    expect(read.identifiers.sku).toBeNull();
    expect(read.availability).toBe('unknown');
    expect(read.referenceClaimed).toBeNull();
    expect(read.sticker).toBe(5625);
  });
});
