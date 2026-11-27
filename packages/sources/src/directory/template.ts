import type { PageResponse } from '@agentic-dasher/fetch';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import type { ReaderContext } from '../read/contract.ts';
import { HTML_LIMITS } from '../structured/html.ts';
import { searchTemplate, storeUrl } from './evidence.ts';
import type { DirectoryCandidate, StoreSearch, StoreSearchResult } from './search.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const PRODUCT_PATH = /\/(?:products?|p|dp|pdp|artikel)\/[^/]+/i;
function attribute(el: Element, name: string) {
  return el.attrs.find((a) => a.name === name)?.value;
}

function* visibleNodes(root: Node, limit: number): Generator<Node> {
  const pending: Node[] = [root];
  for (let visited = 0; pending.length && visited < limit; visited++) {
    const node = pending.pop();
    if (!node) break;
    if (
      'tagName' in node &&
      (['script', 'template', 'style', 'noscript'].includes(node.tagName) ||
        attribute(node, 'hidden') !== undefined ||
        attribute(node, 'aria-hidden') === 'true')
    )
      continue;
    yield node;
    if ('childNodes' in node) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child) pending.push(child);
      }
    }
  }
}

function linkTitle(link: Element): string {
  const label = attribute(link, 'aria-label') || attribute(link, 'title');
  const words: string[] = [];
  if (!label) {
    for (const node of visibleNodes(link, 300)) {
      if (node.nodeName === '#text' && 'value' in node) words.push(node.value);
    }
  }
  return (label || words.join(' ')).replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** Read product-shaped links from the store's result page; the product reader verifies prices later. */
export function productLinks(
  page: PageResponse,
  input: StoreSearch,
  accepts = PRODUCT_PATH,
): DirectoryCandidate[] {
  const base = new URL(page.finalUrl);
  const doc = parse(page.text.slice(0, HTML_LIMITS.chars));
  const found = new Map<string, DirectoryCandidate>();
  for (const node of visibleNodes(doc, 50_000)) {
    if (!('tagName' in node) || node.tagName !== 'a') continue;
    const url = storeUrl(attribute(node, 'href') ?? '', base);
    if (!url?.pathname.startsWith(`${input.marketPrefix}/`) || !accepts.test(url.pathname))
      continue;
    url.hash = '';
    const title = linkTitle(node);
    if (title && !found.has(url.href))
      found.set(url.href, {
        url: url.href,
        storeHost: url.hostname,
        marketPrefix: input.marketPrefix,
        title,
        brand: null,
        sku: null,
        mpn: null,
        gtin: null,
        variant: {},
      });
    if (found.size === 10) break;
  }
  return [...found.values()];
}

export async function searchDeclaredTemplate(
  input: StoreSearch,
  template: string,
  context: ReaderContext,
): Promise<StoreSearchResult> {
  const base = new URL(input.origin);
  const checked = searchTemplate(template, base);
  if (!checked) return { kind: 'unsupported' };
  const endpoint = URL.parse(
    checked.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/, () => encodeURIComponent(input.query)),
  );
  if (!endpoint || endpoint.origin !== base.origin) return { kind: 'unsupported' };
  return readProductLinks(input, endpoint, context);
}

export async function readProductLinks(
  input: StoreSearch,
  endpoint: URL,
  context: ReaderContext,
  accepts = PRODUCT_PATH,
): Promise<StoreSearchResult> {
  const { outcome, response } = await context.get({ url: endpoint.href, rung: 'http' });
  if (outcome.kind === 'not_found') return { kind: 'unsupported' };
  if (outcome.kind !== 'ok') return { kind: 'fetch_failed', outcome };
  if (
    !response ||
    URL.parse(response.finalUrl)?.origin !== endpoint.origin ||
    !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.contentType ?? '')
  )
    return { kind: 'invalid_response' };
  return { kind: 'results', candidates: productLinks(response, input, accepts) };
}
