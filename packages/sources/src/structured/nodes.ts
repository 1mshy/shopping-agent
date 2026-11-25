// The node model the JSON-LD and microdata readers share: schema.org nodes as null-prototype
// objects (JSON-LD as parsed by json.ts; microdata items converted to the same shape), with the
// few accessors the readers need. Every accessor accepts any value and never throws.
import { JsonNumber, type JsonObject, type JsonValue } from './json.ts';

export type Node = JsonObject;

export function isNode(value: JsonValue | undefined): value is Node {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

/** A property's values as a list: absent → [], a list → its items (one level), else [value]. */
export function list(value: JsonValue | undefined, cap = 500): JsonValue[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.length > cap ? value.slice(0, cap) : value;
  return [value];
}

export function prop(node: Node, key: string): JsonValue | undefined {
  return Object.hasOwn(node, key) ? node[key] : undefined;
}

/** "https://schema.org/InStock", "schema:InStock", "InStock" → "instock". */
export function term(value: string): string {
  const trimmed = value.trim();
  const cut = Math.max(
    trimmed.lastIndexOf('/'),
    trimmed.lastIndexOf(':'),
    trimmed.lastIndexOf('#'),
  );
  return trimmed.slice(cut + 1).toLowerCase();
}

/** The node's @type terms, lower case ("product", "productgroup"). */
export function typesOf(node: Node): string[] {
  const out: string[] = [];
  for (const t of list(prop(node, '@type') ?? prop(node, 'type'), 20)) {
    if (typeof t === 'string' && t.trim() !== '') out.push(term(t));
  }
  return out;
}

export function hasType(node: Node, ...names: string[]): boolean {
  const types = typesOf(node);
  return names.some((n) => types.includes(n));
}

export const PRODUCT_TYPES = ['product', 'productgroup', 'individualproduct', 'someproducts'];
export const OFFER_TYPES = ['offer', 'aggregateoffer'];

/** A scalar property as trimmed text: a string or a JSON number's digits. Null otherwise. */
export function scalar(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? null : t;
  }
  if (value instanceof JsonNumber) return value.text;
  return null;
}

/** The distinct scalar texts of a property (one level of list). */
export function scalars(value: JsonValue | undefined, cap = 50): string[] {
  const out: string[] = [];
  for (const v of list(value, cap)) {
    const s = scalar(v);
    if (s !== null && !out.includes(s)) out.push(s);
  }
  return out;
}

/** One text for the property, or null when it has none or several distinct ones. */
export function single(value: JsonValue | undefined): string | null {
  const all = scalars(value);
  return all.length === 1 ? (all[0] as string) : null;
}

/** A name-bearing value (a Brand, an Organization) or a plain string, as one text. */
export function nameOf(value: JsonValue | undefined): string | null {
  const names: string[] = [];
  for (const v of list(value, 20)) {
    const s = isNode(v) ? single(prop(v, 'name')) : scalar(v);
    if (s !== null && !names.includes(s)) names.push(s);
  }
  return names.length === 1 ? (names[0] as string) : null;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

/**
 * Text for display fields (title, brand): HTML entities some stores leave inside their JSON-LD
 * strings are decoded, runs of white space collapsed. Never used for a figure.
 */
export function cleanText(value: string | null, max: number): string | null {
  if (value === null) return null;
  const decoded = value.replace(/&(?:amp|quot|#39|apos|lt|gt|nbsp);/g, (e) => ENTITIES[e] ?? e);
  const t = decoded.replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** An identifier as read, trimmed; null when absent, ambiguous or longer than 256 characters. */
export function identifier(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t === '' || t.length > 256 ? null : t;
}

/**
 * The @id index of a set of JSON-LD trees: every node that defines an @id (has more than the @id),
 * first definition kept. Walked without recursion, under a visit budget.
 */
export class IdIndex {
  private readonly byId = new Map<string, Node>();

  constructor(roots: readonly JsonValue[], budget = 400_000) {
    const stack: JsonValue[] = [...roots];
    let visits = 0;
    while (stack.length > 0 && visits < budget) {
      const v = stack.pop() as JsonValue;
      visits += 1;
      if (Array.isArray(v)) {
        for (const x of v) stack.push(x);
      } else if (isNode(v)) {
        const id = scalar(prop(v, '@id'));
        if (id !== null && !this.byId.has(id) && !isReference(v)) this.byId.set(id, v);
        for (const key of Object.keys(v)) {
          const x = v[key];
          if (x !== null && typeof x === 'object') stack.push(x as JsonValue);
        }
      }
    }
  }

  /** A reference ({"@id": …} alone) becomes the node it names; anything else is returned as is. */
  deref(value: JsonValue | undefined): JsonValue | undefined {
    if (!isNode(value) || !isReference(value)) return value;
    const id = scalar(prop(value, '@id'));
    return (id !== null ? this.byId.get(id) : undefined) ?? value;
  }

  nodes(value: JsonValue | undefined, cap = 500): Node[] {
    const out: Node[] = [];
    for (const v of list(value, cap)) {
      const d = this.deref(v);
      if (isNode(d) && !out.includes(d)) out.push(d);
    }
    return out;
  }
}

/** A node that only names another: {"@id": "…"} with nothing but @context beside it. */
function isReference(node: Node): boolean {
  const keys = Object.keys(node);
  return keys.includes('@id') && keys.every((k) => k === '@id' || k === '@context');
}
