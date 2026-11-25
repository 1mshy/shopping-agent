// Page text is data (S§2.7): the readers never throw on what a page holds, and their work is bounded.
import { describe, expect, it } from 'vitest';
import type { DocumentReader } from '../../src/read/contract.ts';
import {
  jsonLdReader,
  LIMITS,
  microdataReader,
  openGraphReader,
} from '../../src/structured/index.ts';
import { expectRead, ldPage, page, request } from './helpers.ts';

const URL_ = 'https://shop.example.ca/p/widget';
const READERS: readonly DocumentReader[] = [jsonLdReader, microdataReader, openGraphReader];

function readAll(html: string) {
  return READERS.map((reader) => reader.read(request(URL_), page(html, URL_)));
}

const GOOD = {
  '@type': 'Product',
  name: 'Widget',
  offers: { '@type': 'Offer', price: '9.99', priceCurrency: 'CAD' },
};

describe('hostile pages', () => {
  it('malformed JSON-LD is skipped and the next block still read', () => {
    const html = ldPage('{"@type": "Product", "offers": {"price": ', '{{{', GOOD);
    expect(expectRead(jsonLdReader.read(request(URL_), page(html, URL_))).sticker).toBe(999);
  });

  it('every reader survives garbage, empty and binary-looking pages', () => {
    for (const html of [
      '',
      '<',
      '\u0000￿<<<>>>',
      '<html><head><meta property="og:price:amount">',
      '<script type="application/ld+json">',
    ]) {
      for (const outcome of readAll(html))
        expect(['not_applicable', 'no_read']).toContain(outcome.kind);
    }
  });

  it('odd shapes in the right places: @type as a number, offers as a string, prices as lists', () => {
    const blocks = [
      { '@type': 5, offers: 'free' },
      { '@type': { a: 1 }, name: ['x'] },
      { '@type': 'Product', offers: 'call us', hasVariant: 'none' },
      { '@type': 'Product', offers: [[{ price: [1, 2] }]], brand: [{}, 3] },
      { '@type': 'ProductGroup', hasVariant: [null, 3, 'x', { '@id': 7 }] },
      { '@type': 'Offer', price: { '@value': '9.99' }, priceCurrency: ['CAD', 'USD'] },
    ];
    for (const block of blocks) {
      const outcome = jsonLdReader.read(request(URL_), page(ldPage(block), URL_));
      expect(['not_applicable', 'no_read', 'read']).toContain(outcome.kind);
    }
  });

  it('a cyclic @id graph terminates', () => {
    const html = ldPage({
      '@graph': [
        {
          '@type': 'ProductGroup',
          '@id': '#g',
          hasVariant: [{ '@id': '#a' }, { '@id': '#b' }],
          isVariantOf: { '@id': '#g' },
        },
        {
          '@type': 'Product',
          '@id': '#a',
          isVariantOf: { '@id': '#g' },
          offers: { '@id': '#o' },
          hasVariant: { '@id': '#b' },
        },
        {
          '@type': 'Product',
          '@id': '#b',
          isVariantOf: { '@id': '#g' },
          hasVariant: { '@id': '#a' },
          offers: { '@id': '#b' },
        },
        {
          '@type': 'Offer',
          '@id': '#o',
          itemOffered: { '@id': '#a' },
          price: '5.00',
          priceCurrency: 'CAD',
          offers: { '@id': '#o' },
        },
      ],
    });
    const started = performance.now();
    const outcome = jsonLdReader.read(request(URL_), page(html, URL_));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(['no_read', 'read']).toContain(outcome.kind);
  });

  it('a block of several MB is bounded and does not throw', () => {
    const offers = Array.from({ length: 60_000 }, (_, i) => ({
      '@type': 'Offer',
      price: `${i + 1}.00`,
      priceCurrency: 'CAD',
      sku: `S${i}`,
    }));
    const html = ldPage({ '@type': 'Product', name: 'Huge', offers });
    expect(html.length).toBeGreaterThan(3_000_000);
    const started = performance.now();
    const outcome = jsonLdReader.read(request(URL_), page(html, URL_));
    expect(performance.now() - started).toBeLessThan(5000);
    expect(outcome.kind).not.toBe('read');
    if (outcome.kind === 'no_read')
      expect(outcome.candidates.length).toBeLessThanOrEqual(LIMITS.candidatesPerMethod);
  });

  it('deep nesting in JSON-LD and in microdata is bounded', () => {
    const deep = `{"@type":"Product","name":"D","offers":${'['.repeat(50_000)}${']'.repeat(50_000)}}`;
    expect(['not_applicable', 'no_read']).toContain(
      jsonLdReader.read(request(URL_), page(ldPage(deep), URL_)).kind,
    );
    const nested = `<html><body>${'<div itemscope itemtype="https://schema.org/Product" itemprop="isRelatedTo">'.repeat(5000)}<span itemprop="price">1.00</span></body></html>`;
    const outcome = microdataReader.read(request(URL_), page(nested, URL_));
    expect(['not_applicable', 'no_read', 'read']).toContain(outcome.kind);
  });

  it('JSON-LD blocks beyond the block cap are not read', () => {
    const filler = Array.from({ length: LIMITS.jsonLdBlocks }, () => '{"@type":"Thing"}');
    const html = ldPage(...filler, GOOD);
    expect(jsonLdReader.read(request(URL_), page(html, URL_)).kind).toBe('not_applicable');
    const within = ldPage(...filler.slice(1), GOOD);
    expect(expectRead(jsonLdReader.read(request(URL_), page(within, URL_))).sticker).toBe(999);
  });

  it('many microdata items are bounded', () => {
    const items =
      '<div itemscope itemtype="https://schema.org/Thing"><span itemprop="name">x</span></div>'.repeat(
        LIMITS.microdataItems + 10,
      );
    const html = `<html><body>${items}<div itemscope itemtype="https://schema.org/Product"><span itemprop="price" content="1.00"></span><meta itemprop="priceCurrency" content="CAD"></div></body></html>`;
    expect(microdataReader.read(request(URL_), page(html, URL_)).kind).toBe('not_applicable');
  });

  it('nothing on a page is fetched, evaluated or followed', () => {
    const html = ldPage({
      ...GOOD,
      url: 'javascript:alert(1)',
      '@id': 'http://169.254.169.254/latest',
      sameAs: 'file:///etc/passwd',
    });
    expect(expectRead(jsonLdReader.read(request(URL_), page(html, URL_))).sticker).toBe(999);
  });
});
