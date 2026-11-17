// Hand-written HTML/XML snippets as test input; not captured from any real shop.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findOpenSearchLink,
  findProductHandle,
  findSearchActions,
  validateOpenSearch,
} from './discover.ts';

const home = readFileSync(new URL('./fixtures/home.html', import.meta.url), 'utf8');

describe('discovery on a home page', () => {
  it('finds a JSON-LD SearchAction urlTemplate', () => {
    expect(findSearchActions(home)).toEqual([
      { source: 'json-ld', template: 'https://shop.example/search?q={search_term_string}' },
    ]);
  });

  it('finds a microdata SearchAction target', () => {
    const html = `<div itemscope itemtype="https://schema.org/WebSite">
      <form itemprop="potentialAction" itemscope itemtype="https://schema.org/SearchAction">
        <meta itemprop="target" content="https://shop.example/search?q={query}"/>
        <input itemprop="query" type="text" name="query"/>
      </form></div>`;
    expect(findSearchActions(html)).toEqual([
      { source: 'microdata', template: 'https://shop.example/search?q={query}' },
    ]);
  });

  it('ignores a SearchAction without a placeholder and broken JSON-LD', () => {
    const html = `<script type="application/ld+json">{"@type":"SearchAction","target":"https://x/"}</script>
      <script type="application/ld+json">{not json</script>`;
    expect(findSearchActions(html)).toEqual([]);
  });

  it('finds the OpenSearch autodiscovery link and resolves it', () => {
    expect(findOpenSearchLink(home, 'https://shop.example/')).toBe(
      'https://shop.example/opensearch.xml',
    );
    expect(
      findOpenSearchLink('<link rel="stylesheet" href="/a.css">', 'https://x/'),
    ).toBeUndefined();
  });

  it('validates an OpenSearch description by root element and {searchTerms} template', () => {
    const xml = readFileSync(new URL('./fixtures/opensearch.xml', import.meta.url), 'utf8');
    expect(validateOpenSearch(xml)).toMatchObject({ valid: true, items: 1 });
    expect(validateOpenSearch('<html><title>x</title></html>')).toMatchObject({ valid: false });
  });

  it('finds a Shopify product handle in a link', () => {
    expect(findProductHandle('<a href="/en-ca/products/red-rain-coat?variant=1">')).toBe(
      'red-rain-coat',
    );
    expect(findProductHandle('<a href="/collections/all">')).toBeUndefined();
  });
});
