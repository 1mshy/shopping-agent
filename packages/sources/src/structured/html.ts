// What the structured-data readers need from a fetched page, read once per page: the JSON-LD
// blocks, the meta tags, the link tags, `<html lang>` and the microdata items.
//
// parse5 is imported here and nowhere else (S§3.3, CONTRIBUTING rule 6). It builds the tree the
// HTML standard prescribes, so a page that never closes its tags, a `<div>` in `<head>` or an
// ld+json block inside a comment or a template script is read the way a browser would read it:
// microdata scoping (which price belongs to which item) depends on that tree being right.
//
// Bounded: the text read is capped, the tree is walked without recursion, and the number of
// JSON-LD blocks, meta and link tags and microdata items kept is capped. Nothing here fetches,
// evaluates or follows anything (S§2.7).
import type { PageResponse } from '@agentic-dasher/fetch';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export const HTML_LIMITS = {
  /** Characters of page text parsed. The fetch body cap is 6 MiB; a reader given more reads this much. */
  chars: 8 * 1024 * 1024,
  /** JSON-LD blocks kept, in document order. */
  jsonLdBlocks: 64,
  /** Characters of all JSON-LD blocks together. */
  jsonLdChars: 6 * 1024 * 1024,
  /** Meta and link tags kept. */
  tags: 4000,
  /** Microdata items (elements with itemscope) kept, in document order. */
  microdataItems: 5000,
  /** Characters of an element's text content read as a property value. */
  textChars: 1000,
  /** Elements visited while walking the tree. */
  elements: 400_000,
} as const;

export interface MetaTag {
  /** `property`, else `name`, else `itemprop`, lower case. */
  readonly key: string;
  readonly content: string;
}

export interface LinkTag {
  readonly type: string | null;
  readonly rel: string;
  readonly hreflang: string | null;
  readonly href: string;
}

/** A microdata property value: text, or a nested item. */
export type MicroValue = string | MicroItem;

export interface MicroItem {
  /** itemtype, split on spaces. */
  readonly types: readonly string[];
  /** itemid, or null. */
  readonly id: string | null;
  /** Property values in document order. Null prototype. */
  readonly props: Readonly<Record<string, MicroValue[]>>;
  /** True when the element has no itemprop: a top-level item (HTML microdata). */
  readonly topLevel: boolean;
}

export interface PageFacts {
  readonly magentoInit: boolean;
  readonly shopifyPredictiveSearch: boolean | null;
  readonly htmlLang: string | null;
  readonly title: string | null;
  readonly jsonLd: readonly string[];
  /** Blocks found beyond the caps (count only). */
  readonly jsonLdDropped: number;
  readonly metas: readonly MetaTag[];
  readonly links: readonly LinkTag[];
  readonly items: readonly MicroItem[];
  readonly itemsDropped: number;
}

const cache = new WeakMap<PageResponse, PageFacts>();

/** The page's facts, parsed once per PageResponse object. Never throws. */
export function pageFacts(page: PageResponse): PageFacts {
  const hit = cache.get(page);
  if (hit !== undefined) return hit;
  let facts: PageFacts;
  try {
    const text = typeof page.text === 'string' ? page.text : '';
    facts = readFacts(text.length > HTML_LIMITS.chars ? text.slice(0, HTML_LIMITS.chars) : text);
  } catch {
    facts = EMPTY;
  }
  cache.set(page, facts);
  return facts;
}

const EMPTY: PageFacts = {
  magentoInit: false,
  shopifyPredictiveSearch: null,
  htmlLang: null,
  title: null,
  jsonLd: [],
  jsonLdDropped: 0,
  metas: [],
  links: [],
  items: [],
  itemsDropped: 0,
};

function attr(el: Element, name: string): string | null {
  for (const a of el.attrs) if (a.name === name) return a.value;
  return null;
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function childrenOf(node: ParentNode | Element): readonly Node[] {
  if (isElement(node) && node.tagName === 'template') {
    return (node as DefaultTreeAdapterTypes.Template).content.childNodes;
  }
  return node.childNodes;
}

/** Text content of an element, cut at `limit` characters and a node budget. Iterative. */
function textOf(el: Element, limit: number): string {
  let out = '';
  let budget = 5000;
  const stack: Node[] = [...childrenOf(el)].reverse();
  while (stack.length > 0 && out.length < limit && budget > 0) {
    budget -= 1;
    const node = stack.pop() as Node;
    if (node.nodeName === '#text') out += (node as DefaultTreeAdapterTypes.TextNode).value;
    else if (isElement(node)) {
      const kids = childrenOf(node);
      for (let k = kids.length - 1; k >= 0; k -= 1) stack.push(kids[k] as Node);
    }
  }
  return out.slice(0, limit);
}

function isLdJson(el: Element): boolean {
  const type = attr(el, 'type');
  if (type === null) return false;
  return type.split(';')[0]?.trim().toLowerCase() === 'application/ld+json';
}

/** A microdata property value as the HTML standard reads it, with schema.org's `content`. */
function propertyValue(el: Element): string {
  const content = attr(el, 'content');
  if (content !== null) return content;
  switch (el.tagName) {
    case 'a':
    case 'area':
    case 'link':
      return attr(el, 'href') ?? '';
    case 'img':
    case 'audio':
    case 'video':
    case 'source':
    case 'track':
    case 'iframe':
    case 'embed':
      return attr(el, 'src') ?? '';
    case 'object':
      return attr(el, 'data') ?? '';
    case 'data':
    case 'meter':
      return attr(el, 'value') ?? '';
    case 'time':
      return attr(el, 'datetime') ?? textOf(el, HTML_LIMITS.textChars);
    default:
      return textOf(el, HTML_LIMITS.textChars);
  }
}

interface OpenItem {
  readonly item: MicroItem;
  readonly props: Record<string, MicroValue[]>;
}

function readFacts(text: string): PageFacts {
  const doc = parse(text);
  let htmlLang: string | null = null;
  let title: string | null = null;
  let magentoInit = false;
  let shopifyPredictiveSearch: boolean | null = null;
  const jsonLd: string[] = [];
  let jsonLdChars = 0;
  let jsonLdDropped = 0;
  const metas: MetaTag[] = [];
  const links: LinkTag[] = [];
  const items: MicroItem[] = [];
  let itemsDropped = 0;
  let visited = 0;

  // Depth-first walk in document order. Each entry carries the nearest enclosing item (or null),
  // so an itemprop is attached to the item it belongs to, and only to that one.
  const stack: { node: Node; owner: OpenItem | null }[] = [];
  const pushChildren = (node: ParentNode | Element, owner: OpenItem | null) => {
    const kids = childrenOf(node);
    for (let k = kids.length - 1; k >= 0; k -= 1) stack.push({ node: kids[k] as Node, owner });
  };
  pushChildren(doc, null);

  while (stack.length > 0) {
    const { node, owner } = stack.pop() as { node: Node; owner: OpenItem | null };
    if (!isElement(node)) continue;
    visited += 1;
    if (visited > HTML_LIMITS.elements) break;
    const tag = node.tagName;

    if (tag === 'html' && htmlLang === null) htmlLang = attr(node, 'lang');
    if (tag === 'title' && title === null) title = textOf(node, 500);
    if (tag === 'script') {
      const type = attr(node, 'type')?.trim().toLowerCase();
      if (type === 'text/x-magento-init') magentoInit = true;
      if (type === 'application/json' && attr(node, 'id') === 'shopify-features') {
        try {
          const data: unknown = JSON.parse(textOf(node, 16_384));
          if (
            data &&
            typeof data === 'object' &&
            'predictiveSearch' in data &&
            typeof data.predictiveSearch === 'boolean'
          )
            shopifyPredictiveSearch = data.predictiveSearch;
        } catch {
          // Malformed or oversized feature records provide no flag.
        }
      }
      if (isLdJson(node)) {
        const body = textOf(node, HTML_LIMITS.jsonLdChars);
        if (
          jsonLd.length < HTML_LIMITS.jsonLdBlocks &&
          jsonLdChars + body.length <= HTML_LIMITS.jsonLdChars
        ) {
          jsonLd.push(body);
          jsonLdChars += body.length;
        } else {
          jsonLdDropped += 1;
        }
      }
      continue; // script text is never markup
    }
    if (tag === 'meta' && metas.length < HTML_LIMITS.tags) {
      const key = attr(node, 'property') ?? attr(node, 'name') ?? attr(node, 'itemprop');
      const content = attr(node, 'content');
      if (key !== null && content !== null) metas.push({ key: key.trim().toLowerCase(), content });
    }
    if (tag === 'link' && links.length < HTML_LIMITS.tags) {
      const rel = attr(node, 'rel');
      const href = attr(node, 'href');
      if (rel !== null && href !== null) {
        links.push({
          type: attr(node, 'type'),
          rel: rel.trim().toLowerCase(),
          hreflang: attr(node, 'hreflang'),
          href,
        });
      }
    }

    const itemprop = attr(node, 'itemprop');
    const scoped = attr(node, 'itemscope') !== null;
    let childOwner = owner;
    let value: MicroValue | null = null;
    if (scoped) {
      if (items.length < HTML_LIMITS.microdataItems) {
        const props: Record<string, MicroValue[]> = Object.create(null);
        const types = (attr(node, 'itemtype') ?? '').split(/\s+/).filter((t) => t !== '');
        const item: MicroItem = {
          types,
          id: attr(node, 'itemid'),
          props,
          topLevel: itemprop === null,
        };
        items.push(item);
        childOwner = { item, props };
        value = item;
      } else {
        itemsDropped += 1;
        // Properties below an item that was not kept must not leak into the item above it.
        childOwner = null;
      }
    }
    if (itemprop !== null && owner !== null) {
      const v = value ?? (scoped ? null : propertyValue(node));
      if (v !== null) {
        for (const name of itemprop.split(/\s+/)) {
          if (name === '') continue;
          const list = owner.props[name] ?? [];
          if (list.length < 50) list.push(v);
          owner.props[name] = list;
        }
      }
    }
    pushChildren(node, childOwner);
  }

  return {
    magentoInit,
    shopifyPredictiveSearch,
    htmlLang,
    title: title === null ? null : title.trim() || null,
    jsonLd,
    jsonLdDropped,
    metas,
    links,
    items,
    itemsDropped,
  };
}
