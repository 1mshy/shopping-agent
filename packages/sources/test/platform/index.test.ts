// The platform readers as the package exports them, in ladder order.
import { describe, expect, it } from 'vitest';
import { magentoReader, PLATFORM_READERS, shopifyReader, wooReader } from '../../src/index.ts';
import type { StoreHints } from '../../src/read/contract.ts';
import { request } from './fake.ts';

function store(platform: StoreHints['platform']): StoreHints {
  return { platform, marketPrefix: '', country: null, baseCurrency: 'unknown', locale: null };
}

describe('PLATFORM_READERS', () => {
  it('is Shopify, WooCommerce, Magento 2, each of method platform_json', () => {
    expect(PLATFORM_READERS).toEqual([shopifyReader, wooReader, magentoReader]);
    for (const reader of PLATFORM_READERS) expect(reader.method).toBe('platform_json');
  });

  it('on an unknown platform only Shopify applies, and only on a /products/ path', () => {
    const shaped = request('https://shop.example/products/x');
    expect(PLATFORM_READERS.filter((r) => r.applies(shaped))).toEqual([shopifyReader]);
    const other = request('https://shop.example/product/x/');
    expect(PLATFORM_READERS.filter((r) => r.applies(other))).toEqual([]);
  });

  it('on a named platform at most its own reader applies', () => {
    const url = 'https://shop.example/products/x';
    expect(
      PLATFORM_READERS.filter((r) => r.applies(request(url, { store: store('woo') }))),
    ).toEqual([wooReader]);
    expect(
      PLATFORM_READERS.filter((r) => r.applies(request(url, { store: store('magento') }))),
    ).toEqual([magentoReader]);
    expect(
      PLATFORM_READERS.filter((r) => r.applies(request(url, { store: store('wix') }))),
    ).toEqual([]);
  });
});
