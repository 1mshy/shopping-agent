import { describe, expect, it } from 'vitest';
import { lookalikeReferences } from '../../src/trust/lookalike.ts';

describe('local storefront look-alikes', () => {
  it.each([
    ['www.N0RTHSHOP.CA.', 'northshop.ca'],
    ['rnarketgoods.co.uk', 'marketgoods.co.uk'],
    ['vvintershop.example', 'wintershop.example'],
  ])('checks concrete confusable merchants within the same suffix', (host, known) => {
    const refs = lookalikeReferences(host);
    expect(refs).toContain(known);
    expect(refs).toContain(`www.${known}`);
    expect(refs).not.toContain(host.toLowerCase());
    expect(refs).not.toContain(known.replace(/\.[^.]+$/, '.elsewhere'));
  });
  it.each([
    'northshop.ca',
    'n0rthshop.seller.example',
    'n0rthshop.co.zz',
    'northshopp.ca',
    'shop.ca',
    'xn--mth0st.ca',
    '127.0.0.1',
    '[::1]',
  ])('leaves %s unclassified', (host) => {
    expect(lookalikeReferences(host)).toEqual([]);
  });
});
