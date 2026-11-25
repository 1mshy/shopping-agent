import { describe, expect, it } from 'vitest';
import type { VariantSelector } from '../../src/read/contract.ts';
import { microdataReader } from '../../src/structured/index.ts';
import { expectNoRead, expectRead, fixture, page, request, values } from './helpers.ts';

const KB3D =
  'https://kb-3d.com/store/stepper-motors-servos/11264-ldo-stepper-motor-nema-14-36sth20-1004ahig7t-1642876241077.html';
const CC =
  'https://www.canadacomputers.com/en/desktop-laptop-internal-ssds/233286/samsung-990-pro-2tb-m-2-nvme-pcie-4-0-solid-state-drive-mz-v9p2t0b-am.html';

function read(
  html: string,
  url = 'https://shop.example.ca/p/widget',
  variant: VariantSelector | null = null,
) {
  return microdataReader.read(request(url, variant), page(html, url));
}

const wrap = (body: string, head = '') =>
  `<!DOCTYPE html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;

describe('microdata: real pages', () => {
  it("reads the Product's Offer and ignores orphan offers and related-product tiles (KB3D)", () => {
    const r = expectRead(read(fixture('kb3d-ldo-stepper.html'), KB3D));
    expect(r).toMatchObject({
      method: 'microdata',
      rung: 'http',
      currency: 'USD',
      sticker: 2099,
      availability: 'in',
      title: 'LDO Stepper Motor - Nema 14 - 36STH20-1004AHIG(7T)',
    });
    expect(r.identifiers).toMatchObject({
      gtin: '1642876241077',
      mpn: 'LDO-36STH20-1004AHIG(7T)',
      sku: '11264',
      brand: 'A3DP',
    });
    expect(values(r.candidates)).not.toContain('$28.99');
    expect(values(r.candidates)).not.toContain('$19.99');
    expect(r.candidates[0]).toEqual({ method: 'microdata', confidence: 0.7, value: '20.99' });
  });

  it('a top-level Offer with no Product takes the currency the page declares (Canada Computers)', () => {
    const r = expectRead(read(fixture('canadacomputers-990-pro.html'), CC));
    expect(r).toMatchObject({ currency: 'CAD', sticker: 87499 });
    expect(values(r.candidates)).toEqual(['$874.99']);
  });

  it('microdata inside a script template is not markup (Visions)', () => {
    const url = 'https://www.visions.ca/sony-top-end-headphones-in-black-openbox';
    expect(read(fixture('visions-sony-openbox.html'), url).kind).toBe('not_applicable');
  });

  it('itemprops in no itemscope are not an item (Walmart)', () => {
    const url =
      'https://www.walmart.ca/en/ip/Sony-WH-1000XM5-Wireless-headphones-with-top-noise-canceling-clear-calls-Auto-NC-Optimizer-and-Alexa-voice-control/2P9FP9H47OOW';
    expect(read(fixture('walmartca-wh1000xm5.html'), url).kind).toBe('not_applicable');
  });
});

describe('microdata: rules', () => {
  const product = (inner: string) =>
    wrap(
      `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Widget</h1>${inner}</div>`,
    );

  it('reads content attributes before text, and link hrefs for availability', () => {
    const html = product(
      '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><span itemprop="price" content="1299.00">$1,299</span><meta itemprop="priceCurrency" content="CAD"><link itemprop="availability" href="https://schema.org/OutOfStock"><link itemprop="itemCondition" href="https://schema.org/RefurbishedCondition"></div>',
    );
    expect(expectRead(read(html))).toMatchObject({
      sticker: 129900,
      availability: 'out',
      condition: 'refurbished',
      title: 'Widget',
    });
  });

  it('two prices in one product scope are multiple_prices', () => {
    const html = product(
      '<span itemprop="price">10.00</span><span itemprop="price">12.00</span><meta itemprop="priceCurrency" content="CAD">',
    );
    const outcome = expectNoRead(read(html));
    expect(outcome.reason).toBe('multiple_prices');
    expect(values(outcome.candidates)).toEqual(['10.00', '12.00']);
  });

  it('an AggregateOffer range is variant_not_found', () => {
    const html = product(
      '<div itemprop="offers" itemscope itemtype="https://schema.org/AggregateOffer"><meta itemprop="lowPrice" content="10.00"><meta itemprop="highPrice" content="20.00"><meta itemprop="priceCurrency" content="CAD"></div>',
    );
    expect(expectNoRead(read(html)).reason).toBe('variant_not_found');
  });

  it('a selector by sku against the offers in scope', () => {
    const offers =
      '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="sku" content="W-RED"><meta itemprop="price" content="10.00"><meta itemprop="priceCurrency" content="CAD"></div>' +
      '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="sku" content="W-BLUE"><meta itemprop="price" content="12.00"><meta itemprop="priceCurrency" content="CAD"></div>';
    expect(expectNoRead(read(product(offers))).reason).toBe('variant_not_found');
    expect(
      expectRead(read(product(offers), 'https://shop.example.ca/p/widget', { sku: 'W-BLUE' }))
        .sticker,
    ).toBe(1200);
  });

  it('HTML that never closes its tags is still read', () => {
    const html =
      '<html><head><title>T</title><body><div itemscope itemtype="http://schema.org/Product"><p><span itemprop="name">Widget<div itemprop="offers" itemscope itemtype="http://schema.org/Offer"><b><span itemprop="price" content="5.00">$5<meta itemprop="priceCurrency" content="CAD">';
    expect(expectRead(read(html))).toMatchObject({ sticker: 500, currency: 'CAD' });
  });

  it('a page without items is not_applicable', () => {
    expect(read(wrap('<p itemprop="price">$5</p>')).kind).toBe('not_applicable');
  });
});
