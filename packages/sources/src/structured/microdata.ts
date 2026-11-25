// The microdata reader (S§5.2): schema.org Product and Offer items written with itemscope,
// itemtype and itemprop. The HTML module scopes every itemprop to its nearest itemscope, as the
// HTML standard does, so a related-product tile's price never lands on the product. Top-level
// items (itemscope with no itemprop) are converted to the node model and read by product.ts, like
// JSON-LD. `itemref` is not followed. A pure function of the page and the request.
import type { PageResponse } from '@agentic-dasher/fetch';
import type { DocumentReader, ReadRequest } from '../read/contract.ts';
import { guarded } from './guard.ts';
import type { MicroItem } from './html.ts';
import type { JsonValue } from './json.ts';
import { IdIndex, type Node } from './nodes.ts';
import { pageContext } from './page.ts';
import { type DocumentReading, readProducts } from './product.ts';

/** Nested items deeper than this are not converted (their figures are not read). */
const MAX_ITEM_DEPTH = 16;

function toNode(item: MicroItem, depth: number): Node {
  const node: Node = Object.create(null);
  if (item.types.length > 0) node['@type'] = [...item.types];
  if (item.id !== null) node['@id'] = item.id;
  for (const name of Object.keys(item.props)) {
    const values: JsonValue[] = [];
    for (const v of item.props[name] ?? []) {
      if (typeof v === 'string') values.push(v);
      else if (depth < MAX_ITEM_DEPTH) values.push(toNode(v, depth + 1));
    }
    if (values.length === 1) node[name] = values[0] as JsonValue;
    else if (values.length > 1) node[name] = values;
  }
  return node;
}

export function readMicrodata(request: ReadRequest, page: PageResponse): DocumentReading {
  return guarded('microdata', () => {
    const ctx = pageContext(request, page);
    const tops = ctx.facts.items.filter((i) => i.topLevel).map((i) => toNode(i, 0));
    if (tops.length === 0) return { outcome: { kind: 'not_applicable' }, unconfirmed: false };
    return readProducts({ method: 'microdata', tops, index: new IdIndex([]), ctx });
  });
}

export const microdataReader: DocumentReader = {
  method: 'microdata',
  read: (request, page) => readMicrodata(request, page).outcome,
};
