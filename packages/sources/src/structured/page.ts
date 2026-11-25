// What one read knows about the page besides the figure: the evidence packages/core needs to
// resolve a currency and to read separators (S§5.2 "Currency resolution order"), the URLs that
// select a variant, and the fallback title. Collected once per read; pure.
import type { PageResponse } from '@agentic-dasher/fetch';
import type { ReadRequest } from '../read/contract.ts';
import { type PageFacts, pageFacts } from './html.ts';
import { cleanText } from './nodes.ts';
import { parseUrl, samePage } from './urls.ts';

export interface PageContext {
  readonly request: ReadRequest;
  readonly page: PageResponse;
  readonly facts: PageFacts;
  /** The storefront host the page came from, lower case. */
  readonly host: string;
  /** The shop's locale for separators: the store's, else the page's own hreflang, og:locale, `<html lang>`. */
  readonly parseLocale: string | undefined;
  /** The page's own hreflang, else og:locale (CurrencyEvidence.locale: never `<html lang>`). */
  readonly currencyLocale: string | null;
  readonly storeCountry: string | null;
  /** The page's one OpenGraph price currency, when it states exactly one: currency evidence only. */
  readonly pageCurrency: string | null;
  /** og:title, else `<title>`: used only when a method's own data names no title. */
  readonly fallbackTitle: string | null;
}

const contexts = new WeakMap<PageResponse, WeakMap<ReadRequest, PageContext>>();

export function pageContext(request: ReadRequest, page: PageResponse): PageContext {
  let byRequest = contexts.get(page);
  if (byRequest === undefined) {
    byRequest = new WeakMap();
    contexts.set(page, byRequest);
  }
  const hit = byRequest.get(request);
  if (hit !== undefined) return hit;
  const ctx = build(request, page);
  byRequest.set(request, ctx);
  return ctx;
}

function metaValues(facts: PageFacts, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const m of facts.metas) {
    if (keys.includes(m.key)) {
      const v = m.content.trim();
      if (v !== '' && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** The hreflang of the alternate link that points at this very page, when the links agree. */
function ownHreflang(facts: PageFacts, urls: readonly string[]): string | null {
  const found: string[] = [];
  for (const link of facts.links) {
    if (link.hreflang === null || !link.rel.split(/\s+/).includes('alternate')) continue;
    const lang = link.hreflang.trim();
    if (lang === '' || lang.toLowerCase() === 'x-default') continue;
    const href = parseUrl(link.href, urls[0] ?? '');
    if (href === null || !urls.some((u) => samePage(href, u))) continue;
    if (!found.some((f) => f.toLowerCase() === lang.toLowerCase())) found.push(lang);
  }
  if (found.length === 1) return found[0] as string;
  // "en" and "en-CA" both on this page: the one with a region says more, if only one has one.
  const withRegion = found.filter((f) => /[-_][A-Za-z]{2}$/.test(f));
  return withRegion.length === 1 ? (withRegion[0] as string) : null;
}

function build(request: ReadRequest, page: PageResponse): PageContext {
  const facts = pageFacts(page);
  const finalUrl = parseUrl(page.finalUrl, request.url) ?? parseUrl(request.url, '');
  const host = finalUrl?.hostname.toLowerCase() ?? '';
  const urls = [page.finalUrl, request.url];
  const own = ownHreflang(facts, urls);
  const ogLocales = metaValues(facts, 'og:locale');
  const ogLocale = ogLocales.length === 1 ? (ogLocales[0] as string) : null;
  const htmlLang = facts.htmlLang?.trim() || null;
  const currencies = metaValues(facts, 'product:price:currency', 'og:price:currency').map((c) =>
    c.toUpperCase(),
  );
  const distinctCurrencies = [...new Set(currencies)];
  const titles = metaValues(facts, 'og:title');
  return {
    request,
    page,
    facts,
    host,
    parseLocale: request.store?.locale ?? own ?? ogLocale ?? htmlLang ?? undefined,
    currencyLocale: own ?? ogLocale,
    storeCountry: request.store?.country ?? null,
    pageCurrency: distinctCurrencies.length === 1 ? (distinctCurrencies[0] as string) : null,
    fallbackTitle: cleanText(titles[0] ?? facts.title, 500),
  };
}
