// Directory metadata is untrusted data. Retain only bounded, same-store route templates and
// concrete platform signals. Nothing in a document can name another origin to probe.
import type { PageResponse } from '@agentic-dasher/fetch';
import type { StorePlatform } from '@agentic-dasher/shared';
import { pageFacts } from '../structured/html.ts';
import { type JsonValue, parseLenientJson } from '../structured/json.ts';
import { hasType, isNode, list, PRODUCT_TYPES, term } from '../structured/nodes.ts';

export function storeUrl(text: string, base: URL): URL | null {
  if (!text || text.length > 2048 || /[\s\\]/.test(text)) return null;
  const url = URL.parse(text, base);
  return url?.origin === base.origin && !url.username && !url.password ? url : null;
}

export function searchTemplate(text: string, base: URL): string | null {
  const slot = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.exec(text)?.[0];
  if (!slot || text.includes('DASHERSEARCHTERM')) return null;
  const filled = text.replace(slot, 'DASHERSEARCHTERM');
  if (/[{}]/.test(filled)) return null;
  const url = storeUrl(filled, base);
  if (!url || !(url.pathname + url.search).includes('DASHERSEARCHTERM')) return null;
  url.hash = '';
  return url.href.replace('DASHERSEARCHTERM', slot);
}

export interface HomeEvidence {
  platform: StorePlatform;
  magentoGeneration: 1 | 2 | null;
  productMarkup: boolean;
  predictiveSearch: boolean | null;
  wordpress: boolean;
  searchAction: string | null;
  openSearchDescription: string | null;
}

export function homeEvidence(page: PageResponse, base: URL): HomeEvidence {
  const facts = pageFacts(page);
  const generator = facts.metas
    .filter((m) => m.key === 'generator')
    .map((m) => m.content.toLowerCase());
  const assets = facts.links
    .filter((link) =>
      link.rel.split(/\s+/).some((rel) => ['stylesheet', 'preload', 'preconnect'].includes(rel)),
    )
    .flatMap((link) => URL.parse(link.href, base) ?? []);
  const styles = assets.filter((a) => a.origin === base.origin).map((a) => a.pathname);
  const hasGenerator = (name: string) =>
    generator.some((v) => v === name || v.startsWith(`${name} `));
  const m2 =
    facts.magentoInit || styles.some((p) => /^\/static\/(?:version\d+\/)?frontend\//i.test(p));
  const m1 = styles.some((p) => /^\/skin\/frontend\//i.test(p));
  const platform =
    facts.shopifyPredictiveSearch !== null ||
    hasGenerator('shopify') ||
    assets.some(
      (a) =>
        a.hostname === 'cdn.shopify.com' ||
        (a.origin === base.origin && a.pathname.startsWith('/cdn/shop/')),
    )
      ? 'shopify'
      : hasGenerator('woocommerce') ||
          styles.some((p) => p.includes('/wp-content/plugins/woocommerce/'))
        ? 'woo'
        : m1 || m2 || hasGenerator('magento')
          ? 'magento'
          : hasGenerator('wix.com website builder')
            ? 'wix'
            : hasGenerator('bigcommerce')
              ? 'bigcommerce'
              : 'unknown';
  let productMarkup = false;
  let searchAction: string | null = null;
  const target = (value: JsonValue | undefined) => {
    for (const v of list(value)) {
      const raw = typeof v === 'string' ? v : isNode(v) ? v.urlTemplate : null;
      if (typeof raw === 'string') searchAction ??= searchTemplate(raw, base);
    }
  };
  for (const block of facts.jsonLd) {
    const parsed = parseLenientJson(block, { maxDepth: 48, maxNodes: 10_000 });
    if (!parsed.ok) continue;
    const stack = [parsed.value];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const child of node) stack.push(child);
      } else if (isNode(node)) {
        if (hasType(node, ...PRODUCT_TYPES)) productMarkup = true;
        if (hasType(node, 'searchaction')) target(node.target);
        for (const child of Object.values(node)) stack.push(child);
      }
    }
  }
  for (const item of facts.items) {
    const types = item.types.map(term);
    if (types.some((t) => PRODUCT_TYPES.includes(t))) productMarkup = true;
    if (types.includes('searchaction')) {
      for (const v of item.props.target ?? []) {
        const raw = typeof v === 'string' ? v : v.props.urlTemplate?.[0];
        if (typeof raw === 'string') searchAction ??= searchTemplate(raw, base);
      }
    }
  }
  const openSearchDescription =
    facts.links
      .filter(
        (l) =>
          l.rel.split(/\s+/).includes('search') &&
          l.type?.trim().toLowerCase() === 'application/opensearchdescription+xml',
      )
      .map((l) => storeUrl(l.href, base)?.href)
      .find((link) => link !== undefined) ?? null;
  return {
    platform,
    magentoGeneration: m2 && !m1 ? 2 : m1 && !m2 ? 1 : null,
    productMarkup,
    predictiveSearch: facts.shopifyPredictiveSearch,
    wordpress: hasGenerator('wordpress') || facts.links.some((l) => l.rel === 'https://api.w.org/'),
    searchAction,
    openSearchDescription,
  };
}

// Read the small XML subsets needed here. Never expand entities, process a DTD or resolve a URL.
function xmlBody(page: PageResponse, root: string): string | null {
  const xml = page.text
    .trim()
    .replace(/^<\?xml\b[^?]*\?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !xml.startsWith(`<${root}`) || !xml.endsWith(`</${root}>`))
    return null;
  if (!new RegExp(`^<${root}(?:\\s|>)`).test(xml)) return null;
  return xml;
}

export function openSearchTemplate(page: PageResponse, base: URL): string | null {
  const xml = xmlBody(page, 'OpenSearchDescription');
  if (!xml) return null;
  for (const tag of xml.matchAll(/<Url\s+([^<>]*?)\/?\s*>/g)) {
    const attrs = Object.fromEntries(
      Array.from((tag[1] ?? '').matchAll(/([^\s=/<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), (m) => [
        m[1],
        m[2] ?? m[3] ?? '',
      ]),
    );
    if (attrs.type !== 'text/html' || (attrs.method ?? 'GET').toUpperCase() !== 'GET') continue;
    const text = attrs.template;
    if (text?.includes('{searchTerms}')) {
      const valid = searchTemplate(text.replace(/&amp;/g, '&'), base);
      if (valid) return valid;
    }
  }
  return null;
}

export function productSitemap(page: PageResponse, base: URL): boolean | null {
  const xml = xmlBody(page, 'sitemapindex') ?? xmlBody(page, 'urlset');
  if (!xml) return null;
  for (const loc of xml.matchAll(/<loc>\s*([^<>]+?)\s*<\/loc>/g)) {
    const path = storeUrl((loc[1] ?? '').replace(/&amp;/g, '&'), base)?.pathname;
    if (
      path &&
      /\/products?\/|\/(?:sitemap[-_]products?|products?[-_]sitemap)(?:[_.-]|$)/i.test(path)
    )
      return true;
  }
  return false;
}
