// The JSON-LD reader (S§5.2 "JSON-LD (including ProductGroup/hasVariant)"): every
// application/ld+json block of the page, read by the lenient bounded parser (numbers stay text),
// flattened through `@graph` and lists, `@id` references resolved, then read as schema.org
// products by product.ts. A pure function of the page and the request.
import type { PageResponse } from '@agentic-dasher/fetch';
import type { DocumentReader, ReadRequest } from '../read/contract.ts';
import { guarded } from './guard.ts';
import { type JsonValue, parseLenientJson } from './json.ts';
import { IdIndex, isNode, list, type Node, prop } from './nodes.ts';
import { pageContext } from './page.ts';
import { type DocumentReading, readProducts } from './product.ts';

export const JSON_LD_LIMITS = {
  /** Values parsed over all blocks of one page. */
  nodes: 300_000,
  /** Nesting depth of one block. */
  depth: 64,
  /** Top-level items kept over all blocks. */
  tops: 2000,
} as const;

export function readJsonLd(request: ReadRequest, page: PageResponse): DocumentReading {
  return guarded('json_ld', () => {
    const ctx = pageContext(request, page);
    const roots: JsonValue[] = [];
    const tops: Node[] = [];
    let budget: number = JSON_LD_LIMITS.nodes;
    const keep = (value: JsonValue) => {
      if (isNode(value) && tops.length < JSON_LD_LIMITS.tops) tops.push(value);
    };
    for (const block of ctx.facts.jsonLd) {
      if (budget <= 0) break;
      const parsed = parseLenientJson(block, { maxDepth: JSON_LD_LIMITS.depth, maxNodes: budget });
      if (!parsed.ok) continue; // a malformed block is skipped; the others are still read
      budget -= parsed.nodes;
      roots.push(parsed.value);
      for (const item of list(parsed.value, JSON_LD_LIMITS.tops)) {
        for (const inner of Array.isArray(item) ? list(item, JSON_LD_LIMITS.tops) : [item]) {
          if (!isNode(inner)) continue;
          const graph = prop(inner, '@graph');
          if (graph === undefined) keep(inner);
          else {
            for (const g of list(graph, JSON_LD_LIMITS.tops)) keep(g);
            if (prop(inner, '@type') !== undefined) keep(inner);
          }
        }
      }
    }
    if (tops.length === 0) return { outcome: { kind: 'not_applicable' }, unconfirmed: false };
    const index = new IdIndex(roots);
    const resolved: Node[] = [];
    for (const t of tops) {
      const d = index.deref(t);
      if (isNode(d) && !resolved.includes(d)) resolved.push(d);
    }
    return readProducts({ method: 'json_ld', tops: resolved, index, ctx });
  });
}

export const jsonLdReader: DocumentReader = {
  method: 'json_ld',
  read: (request, page) => readJsonLd(request, page).outcome,
};
