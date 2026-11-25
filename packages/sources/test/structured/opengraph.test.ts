import { describe, expect, it } from 'vitest';
import type { VariantSelector } from '../../src/read/contract.ts';
import { openGraphReader } from '../../src/structured/index.ts';
import { expectNoRead, expectRead, fixture, page, request, values } from './helpers.ts';

function read(
  html: string,
  url = 'https://shop.example.ca/p/widget',
  variant: VariantSelector | null = null,
  finalUrl = url,
) {
  return openGraphReader.read(request(url, variant), page(html, finalUrl));
}

const tags = (metas: Record<string, string>[]) =>
  `<!DOCTYPE html><html lang="en"><head><title>T</title>${metas
    .map(
      (m) =>
        `<meta ${Object.entries(m)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')}>`,
    )
    .join('')}</head><body></body></html>`;
const prop = (property: string, content: string) => ({ property, content });

describe('OpenGraph: real pages', () => {
  it('og:price tags alone (CanaKit)', () => {
    const r = expectRead(
      read(fixture('canakit-pi5-8gb.html'), 'https://www.canakit.com/raspberry-pi-5-8gb.html'),
    );
    expect(r).toMatchObject({
      method: 'opengraph',
      rung: 'http',
      currency: 'USD',
      sticker: 17500,
      title: 'Raspberry Pi 5 8GB',
      availability: 'unknown',
      condition: 'unknown',
    });
    expect(r.candidates).toEqual([{ method: 'opengraph', confidence: 0.5, value: '175.00' }]);
  });

  it('product: tags with availability, condition and retailer id (KB3D)', () => {
    const url =
      'https://kb-3d.com/store/stepper-motors-servos/11264-ldo-stepper-motor-nema-14-36sth20-1004ahig7t-1642876241077.html';
    const r = expectRead(read(fixture('kb3d-ldo-stepper.html'), url));
    expect(r).toMatchObject({
      currency: 'USD',
      sticker: 2099,
      availability: 'in',
      condition: 'new',
    });
    expect(r.identifiers.sku).toBe('LDO-36STH20-1004AHIG(7T)');
  });

  it('meta tags spread over several lines (SAIL)', () => {
    const url =
      'https://www.sail.ca/en-ca/products/the-north-face-wawona-6-tent-6-person-1493003?variant=56879252373664';
    expect(expectRead(read(fixture('sail-wawona-6.html'), url))).toMatchObject({
      currency: 'CAD',
      sticker: 77500,
    });
  });

  it('a page with no price tag is not_applicable (Bambu Lab)', () => {
    expect(
      read(fixture('bambulab-a1-mini.html'), 'https://ca.store.bambulab.com/products/a1-mini').kind,
    ).toBe('not_applicable');
  });
});

describe('OpenGraph: rules', () => {
  it('the predecessor meta fallback (test_meta_fallback)', () => {
    const html = tags([
      prop('og:title', 'Nozzle'),
      prop('product:price:amount', '24.50'),
      prop('product:price:currency', 'EUR'),
    ]);
    expect(expectRead(read(html, 'https://shop.example.com/nozzle'))).toMatchObject({
      currency: 'EUR',
      sticker: 2450,
      title: 'Nozzle',
    });
  });

  it('two distinct amounts are multiple_prices; the same amount twice is one', () => {
    const two = tags([
      prop('product:price:amount', '24.50'),
      prop('product:price:amount', '29.50'),
      prop('product:price:currency', 'CAD'),
    ]);
    const outcome = expectNoRead(read(two));
    expect(outcome.reason).toBe('multiple_prices');
    expect(values(outcome.candidates)).toEqual(['24.50', '29.50']);
    const same = tags([
      prop('og:price:amount', '24.50'),
      prop('product:price:amount', '24.5'),
      prop('product:price:currency', 'CAD'),
    ]);
    expect(expectRead(read(same)).sticker).toBe(2450);
  });

  it('a sale price that differs from the price is multiple_prices; an original price is a claim', () => {
    const sale = tags([
      prop('product:price:amount', '29.99'),
      prop('product:price:currency', 'CAD'),
      prop('product:sale_price:amount', '24.99'),
      prop('product:sale_price:currency', 'CAD'),
    ]);
    expect(expectNoRead(read(sale)).reason).toBe('multiple_prices');
    const original = tags([
      prop('product:price:amount', '24.99'),
      prop('product:price:currency', 'CAD'),
      prop('product:original_price:amount', '29.99'),
      prop('product:original_price:currency', 'CAD'),
    ]);
    expect(expectRead(read(original))).toMatchObject({ sticker: 2499, referenceClaimed: 2999 });
  });

  it('cannot confirm a selector by options or by an unknown sku: variant_not_found', () => {
    const html = tags([
      prop('product:price:amount', '24.99'),
      prop('product:price:currency', 'CAD'),
    ]);
    expect(expectNoRead(read(html, undefined, { options: { Size: 'XL' } })).reason).toBe(
      'variant_not_found',
    );
    expect(expectNoRead(read(html, undefined, { sku: 'W-XL' })).reason).toBe('variant_not_found');
  });

  it('confirms a selector by the variant the URL names, as long as the page kept it', () => {
    const html = tags([
      prop('product:price:amount', '24.99'),
      prop('product:price:currency', 'CAD'),
    ]);
    const url = 'https://shop.example.ca/products/w?variant=42';
    expect(expectRead(read(html, url, { variantId: '42' })).sticker).toBe(2499);
    expect(
      expectNoRead(read(html, url, { variantId: '42' }, 'https://shop.example.ca/products/w'))
        .reason,
    ).toBe('variant_not_found');
    const withSku = tags([
      prop('product:price:amount', '24.99'),
      prop('product:price:currency', 'CAD'),
      prop('product:retailer_item_id', 'W-XL'),
    ]);
    expect(expectRead(read(withSku, undefined, { sku: 'W-XL' })).sticker).toBe(2499);
  });

  it('a product.group page is several variants: variant_not_found', () => {
    const html = tags([
      prop('og:type', 'product.group'),
      prop('product:price:amount', '24.99'),
      prop('product:price:currency', 'CAD'),
    ]);
    expect(expectNoRead(read(html)).reason).toBe('variant_not_found');
  });

  it('no currency anywhere: unknown, null amounts, the text kept', () => {
    const html = tags([prop('og:price:amount', '175.00')]);
    const r = expectRead(read(html, 'https://shop.example.com/w'));
    expect(r).toMatchObject({ currency: 'unknown', sticker: null });
    expect(values(r.candidates)).toEqual(['175.00']);
  });

  it('name= is read like property=; a zero or wordy amount is unreadable', () => {
    const named = tags([
      { name: 'product:price:amount', content: '9.99' },
      { name: 'product:price:currency', content: 'CAD' },
    ]);
    expect(expectRead(read(named)).sticker).toBe(999);
    for (const amount of ['0', 'Free', '0.00']) {
      const html = tags([
        prop('product:price:amount', amount),
        prop('product:price:currency', 'CAD'),
      ]);
      expect(expectNoRead(read(html)).reason).toBe('unreadable_price');
    }
  });
});
