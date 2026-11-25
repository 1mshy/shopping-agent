import { describe, expect, it } from 'vitest';
import { refererFor } from '../../src/page/index.ts';

describe('refererFor', () => {
  it('sends the full URL to the same origin, without fragment or credentials', () => {
    expect(refererFor('https://u:p@shop.test/c/shoes?page=2#top', 'https://shop.test/p/1')).toEqual(
      { referer: 'https://shop.test/c/shoes?page=2', fetchSite: 'same-origin' },
    );
  });

  it('sends the origin alone to another origin of the same site', () => {
    expect(refererFor('https://www.shop.test/c/shoes', 'https://shop.test/p/1')).toEqual({
      referer: 'https://www.shop.test/',
      fetchSite: 'same-site',
    });
    expect(refererFor('https://shop.test/c', 'https://m.shop.test/p')).toEqual({
      referer: 'https://shop.test/',
      fetchSite: 'same-site',
    });
  });

  it('sends nothing across sites, from https to http, or from a non-http URL', () => {
    expect(refererFor('https://other.test/', 'https://shop.test/')).toBeNull();
    expect(refererFor('https://evilshop.test/', 'https://shop.test/')).toBeNull();
    expect(refererFor('https://shop.test/', 'http://shop.test/')).toBeNull();
    expect(refererFor('ftp://shop.test/', 'https://shop.test/')).toBeNull();
    expect(refererFor('not a url', 'https://shop.test/')).toBeNull();
    expect(refererFor('https://203.0.113.5/', 'https://203.0.113.6/')).toBeNull();
  });
});
