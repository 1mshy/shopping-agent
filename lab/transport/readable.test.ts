// The readable criterion on hand-written fixtures. Every page below is written for this test; none
// is a copy of a real shop's page, and none is evidence about any shop.
import { describe, expect, it } from 'vitest';
import { positivePrice, readability } from './readable.ts';

const page = (head: string, body = '') =>
  `<!doctype html><html><head><title>Fixture</title>${head}</head><body>${body}</body></html>`;
const ld = (x: unknown) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`;
const HTML = 'text/html; charset=utf-8';

describe('positivePrice', () => {
  it('accepts numbers and price text above zero', () => {
    expect(positivePrice(19.99)).toBe('19.99');
    expect(positivePrice('1,299.00')).toBe('1,299.00');
    expect(positivePrice('1 299,00')).toBe('1 299,00');
    expect(positivePrice('$19.99')).toBe('$19.99');
    expect(positivePrice('19.99 CAD')).toBe('19.99 CAD');
  });
  it('refuses zero, empty, words and non-numbers', () => {
    expect(positivePrice(0)).toBeUndefined();
    expect(positivePrice('0.00')).toBeUndefined();
    expect(positivePrice('')).toBeUndefined();
    expect(positivePrice('Call for price')).toBeUndefined();
    expect(positivePrice(null)).toBeUndefined();
    expect(positivePrice({ value: 3 })).toBeUndefined();
  });
});

describe('readability: JSON-LD', () => {
  it('reads a Product with a typed Offer', () => {
    const r = readability(
      HTML,
      page(
        ld({
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Fixture drill',
          offers: { '@type': 'Offer', price: '149.99', priceCurrency: 'CAD' },
        }),
      ),
    );
    expect(r).toMatchObject({ readable: true, methods: ['json-ld'], prices: ['149.99'] });
  });
  it('reads an untyped offers object and an @graph', () => {
    const r = readability(
      HTML,
      page(
        ld({
          '@graph': [
            { '@type': 'WebPage', name: 'x' },
            { '@type': ['Product'], offers: [{ price: 12, priceCurrency: 'EUR' }] },
          ],
        }),
      ),
    );
    expect(r.readable).toBe(true);
    expect(r.prices).toEqual(['12']);
  });
  it('reads a ProductGroup through hasVariant offers and an AggregateOffer lowPrice', () => {
    const variants = readability(
      HTML,
      page(
        ld({
          '@type': 'ProductGroup',
          hasVariant: [{ '@type': 'Product', offers: { '@type': 'Offer', price: 30 } }],
        }),
      ),
    );
    expect(variants.readable).toBe(true);
    const agg = readability(
      HTML,
      page(
        ld({
          '@type': 'http://schema.org/Product',
          offers: { '@type': 'AggregateOffer', lowPrice: '9.50', highPrice: '12.00' },
        }),
      ),
    );
    expect(agg.prices).toEqual(['9.50']);
  });
  it('reads a price in priceSpecification', () => {
    const r = readability(
      HTML,
      page(
        ld({
          '@type': 'Product',
          offers: {
            '@type': 'Offer',
            priceSpecification: { '@type': 'UnitPriceSpecification', price: 5.25 },
          },
        }),
      ),
    );
    expect(r.prices).toEqual(['5.25']);
  });
  it('does not read a Product without a positive price', () => {
    const none = readability(HTML, page(ld({ '@type': 'Product', name: 'x' })));
    const zero = readability(HTML, page(ld({ '@type': 'Product', offers: { price: '0.00' } })));
    expect(none.readable).toBe(false);
    expect(zero.readable).toBe(false);
  });
  it('does not read an Offer with no product, but does with itemOffered', () => {
    const bare = readability(HTML, page(ld({ '@type': 'Offer', price: 10 })));
    expect(bare.readable).toBe(false);
    const offered = readability(
      HTML,
      page(ld({ '@type': 'Offer', price: 10, itemOffered: { name: 'x' } })),
    );
    expect(offered.readable).toBe(true);
  });
  it('counts a block that does not parse and reads the next one', () => {
    const r = readability(
      HTML,
      page(
        `<script type="application/ld+json">{"@type": "Product", oops}</script>${ld({
          '@type': 'Product',
          offers: { price: 3 },
        })}`,
      ),
    );
    expect(r.badJsonLd).toBe(1);
    expect(r.readable).toBe(true);
  });
  it('ignores a price outside any product on an organisation page', () => {
    const r = readability(HTML, page(ld({ '@type': 'Organization', offers: { price: 3 } })));
    expect(r.readable).toBe(false);
  });
});

describe('readability: microdata, OpenGraph, Shopify', () => {
  it('reads microdata from a content attribute or from the element text', () => {
    const attr = readability(
      HTML,
      page(
        '',
        '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">x</span><div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="219.00"></div></div>',
      ),
    );
    expect(attr).toMatchObject({ readable: true, methods: ['microdata'], prices: ['219.00'] });
    const text = readability(
      HTML,
      page(
        '',
        '<div itemscope itemtype="http://schema.org/Offer"><span itemprop="price">$ 49.95</span></div>',
      ),
    );
    expect(text.prices).toEqual(['$ 49.95']);
  });
  it('does not read itemprop=price without a Product or Offer itemtype', () => {
    const r = readability(HTML, page('', '<span itemprop="price">10.00</span>'));
    expect(r.readable).toBe(false);
  });
  it('reads OpenGraph product price tags in either attribute order', () => {
    const a = readability(HTML, page('<meta property="product:price:amount" content="99.99">'));
    const b = readability(HTML, page('<meta content="5" name="og:price:amount">'));
    expect(a.methods).toEqual(['opengraph']);
    expect(b.prices).toEqual(['5']);
  });
  it("reads Shopify's storefront meta object with a variant price in minor units", () => {
    const html = page(
      '<script>var meta = {"product":{"id":1,"vendor":"Fixture","variants":[{"id":2,"price":2999,"name":"x"}]},"page":{"pageType":"product"}};\nfor (var attr in meta) {}</script>',
    );
    const r = readability(HTML, html);
    expect(r).toMatchObject({ readable: true, methods: ['shopify'], prices: ['2999'] });
  });
  it('lists every method that found a price, in ladder order', () => {
    const r = readability(
      HTML,
      page(
        `${ld({ '@type': 'Product', offers: { price: 1 } })}<meta property="og:price:amount" content="1">`,
      ),
    );
    expect(r.methods).toEqual(['json-ld', 'opengraph']);
  });
});

describe('readability: pages that are not readable', () => {
  it('a challenge interstitial', () => {
    const r = readability(
      HTML,
      '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>',
    );
    expect(r.readable).toBe(false);
  });
  it('a JSON body, even with a price in it', () => {
    const r = readability(
      'application/json',
      JSON.stringify({ '@type': 'Product', offers: { price: 1 } }),
    );
    expect(r.readable).toBe(false);
  });
  it('a price only in visible text', () => {
    const r = readability(HTML, page('', '<div class="price">$19.99</div>'));
    expect(r.readable).toBe(false);
  });
});
