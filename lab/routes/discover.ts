// Search-template discovery on a home page, without a DOM library.
// SearchAction: https://schema.org/SearchAction (target: EntryPoint or URL; JSON-LD and microdata
// examples use a {placeholder} in the target). OpenSearch 1.1: autodiscovery via
// <link rel="search" type="application/opensearchdescription+xml" href>, a root
// <OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"> and a <Url template>
// containing {searchTerms}. https://github.com/dewitt/opensearch/blob/master/opensearch-1-1-draft-6.md
import type { Validation } from './outcome.ts';

export interface Template {
  source: 'json-ld' | 'microdata';
  template: string;
}
const PLACEHOLDER = /\{[^{}\s]+\}/;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    if (m[1]) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
const tags = (html: string, name: string) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => ({
    at: m.index,
    a: attrs(m[0]),
  }));

function targets(t: unknown): string[] {
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.flatMap(targets);
  if (typeof t === 'object' && t !== null) {
    const u = (t as Record<string, unknown>).urlTemplate;
    return typeof u === 'string' ? [u] : [];
  }
  return [];
}

function walk(node: unknown, found: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, found);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const o = node as Record<string, unknown>;
  const type = [o['@type']].flat().map(String);
  if (type.some((t) => t.endsWith('SearchAction'))) found.push(...targets(o.target));
  for (const v of Object.values(o)) walk(v, found);
}

export function findSearchActions(html: string): Template[] {
  const out: Template[] = [];
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const m of scripts) {
    const found: string[] = [];
    try {
      walk(JSON.parse(m[1] ?? ''), found);
    } catch {
      continue;
    }
    for (const t of found) if (PLACEHOLDER.test(t)) out.push({ source: 'json-ld', template: t });
  }
  // Microdata: the first itemprop="target" or "urlTemplate" after a SearchAction itemscope,
  // within the next 4000 characters (an approximation of "inside the element").
  for (const m of html.matchAll(
    /<[a-z][^>]*itemtype\s*=\s*["']?https?:\/\/schema\.org\/SearchAction\b[^>]*>/gi,
  )) {
    const scope = html.slice(m.index, m.index + 4000);
    const t = [
      ...scope.matchAll(/<[a-z][^>]*\bitemprop\s*=\s*["']?(?:target|urlTemplate)\b[^>]*>/gi),
    ]
      .map((x) => attrs(x[0]))
      .map((a) => a.content ?? a.href ?? '')
      .find((v) => PLACEHOLDER.test(v));
    if (t) out.push({ source: 'microdata', template: t });
  }
  return out;
}

export function validateSearchAction(html: string): Validation {
  const found = findSearchActions(html);
  if (found.length === 0) return { valid: false, reason: 'absent' };
  return { valid: true, items: found.length, note: `${found[0]?.source} ${found[0]?.template}` };
}

export function findOpenSearchLink(html: string, base: string): string | undefined {
  const link = tags(html, 'link').find(
    ({ a }) =>
      (a.rel ?? '').toLowerCase().split(/\s+/).includes('search') &&
      (a.type ?? '').toLowerCase() === 'application/opensearchdescription+xml' &&
      a.href,
  );
  if (!link?.a.href) return undefined;
  try {
    return new URL(link.a.href, base).href;
  } catch {
    return undefined;
  }
}

export function validateOpenSearch(xml: string): Validation {
  const root = tags(xml, 'OpenSearchDescription')[0];
  if (!root) return { valid: false, reason: 'no_OpenSearchDescription' };
  const urls = tags(xml, 'Url')
    .map(({ a }) => a.template ?? '')
    .filter((t) => t.includes('{searchTerms}'));
  if (urls.length === 0) return { valid: false, reason: 'no_searchTerms_template' };
  return { valid: true, items: urls.length, note: urls[0] };
}

/** A Shopify product handle from the first /products/<handle> link on a page. */
export function findProductHandle(html: string): string | undefined {
  const m =
    /href\s*=\s*["']?(?:https?:\/\/[^/"'\s]+)?(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/products\/([a-z0-9][a-z0-9\-_.%]*)/i.exec(
      html,
    );
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}
