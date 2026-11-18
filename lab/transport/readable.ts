// The "readable" criterion of spike A: a product page is readable when it carries a price that a
// reader of S§5.2's ladder (platform JSON → JSON-LD → microdata → OpenGraph price tags) could use
// without a browser. Decided on the body alone, never on the status code; the classifier only
// asks it about answers it would otherwise call a success (lab/routes/classify.ts).
//
// A price here is a positive number in the value the reader would take; no currency, variant or
// "is it the right product" check is made (that is the reader's job in Phase 1, not access's).
//
//   json-ld      a <script type="application/ld+json"> block that parses as JSON, contains a
//                Product-family node (Product, ProductGroup, IndividualProduct, ProductModel) or
//                an Offer with `itemOffered`, and an offer with a positive `price`, `lowPrice`,
//                `highPrice` or `priceSpecification.price`. An offer is an Offer/AggregateOffer
//                node, or any object under an `offers` key (many shops omit its @type).
//   microdata    an itemtype of schema.org Product/Offer/AggregateOffer/ProductGroup/
//                IndividualProduct, and an element with itemprop="price" or "lowPrice" whose
//                `content` attribute, or else its text, is a positive number.
//   opengraph    <meta property|name="product:price:amount" or "og:price:amount"> with a positive
//                number in `content`.
//   shopify      Shopify's storefront analytics object (`var meta = {"product":{…`) with a
//                variant price above zero (in minor units).
// The predecessor's browser lab counted a page as read when its engine's extractor found a price,
// which also tried store-specific CSS selectors and Next.js data; that is broader, not stricter,
// so this criterion stands on its own and is applied identically to every client.

export type ReadMethod = 'json-ld' | 'microdata' | 'opengraph' | 'shopify';

export interface Readability {
  readable: boolean;
  /** Methods that found a price, in ladder order. */
  methods: ReadMethod[];
  /** Up to five price values as found (text), for the evidence. */
  prices: string[];
  /** JSON-LD blocks that did not parse (the reader would skip them too). */
  badJsonLd: number;
}

const SCAN = 4 * 1024 * 1024;
const PRODUCT_TYPES = new Set([
  'product',
  'productgroup',
  'individualproduct',
  'productmodel',
  'vehicle',
  'car',
]);
const OFFER_TYPES = new Set(['offer', 'aggregateoffer']);

/** A positive number written as a JSON number or as text ("1,299.00", "19.99", "1 299,00"). */
export function positivePrice(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? String(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!/^[^\d]{0,4}\d[\d\s.,']*[^\d]{0,4}$/.test(s)) return undefined;
  const digits = s.replace(/[^\d]/g, '');
  return /[1-9]/.test(digits) ? s : undefined;
}

function types(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) =>
      x
        .replace(/^https?:\/\/schema\.org\//i, '')
        .replace(/^schema:/i, '')
        .toLowerCase(),
    );
}

function offerPrice(o: Record<string, unknown>): string | undefined {
  for (const k of ['price', 'lowPrice', 'highPrice']) {
    const p = positivePrice(o[k]);
    if (p) return p;
  }
  const spec = o.priceSpecification;
  for (const s of Array.isArray(spec) ? spec : [spec]) {
    if (s && typeof s === 'object') {
      const p = positivePrice((s as Record<string, unknown>).price);
      if (p) return p;
    }
  }
  return undefined;
}

export function jsonLdPrices(html: string): { prices: string[]; bad: number } {
  const blocks = [
    ...html.matchAll(
      /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  let product = false;
  let bad = 0;
  const prices: string[] = [];
  const visit = (x: unknown, underOffers: boolean) => {
    if (Array.isArray(x)) {
      for (const v of x) visit(v, underOffers);
      return;
    }
    if (!x || typeof x !== 'object') return;
    const node = x as Record<string, unknown>;
    const t = types(node);
    if (t.some((y) => PRODUCT_TYPES.has(y))) product = true;
    const isOffer = t.some((y) => OFFER_TYPES.has(y));
    if (isOffer && node.itemOffered) product = true;
    if (isOffer || underOffers) {
      const p = offerPrice(node);
      if (p) prices.push(p);
    }
    for (const [k, v] of Object.entries(node)) visit(v, k === 'offers');
  };
  for (const m of blocks) {
    const text = (m[1] ?? '')
      .trim()
      .replace(/^<!--|-->$/g, '')
      .replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, '')
      .trim();
    if (!text) continue;
    try {
      visit(JSON.parse(text), false);
    } catch {
      bad++;
    }
  }
  return { prices: product ? prices : [], bad };
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
const attrValue = (tag: string, name: string) => {
  const m = attr(tag, name);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : undefined;
};

export function microdataPrices(html: string): string[] {
  if (
    !/\bitemtype\s*=\s*["']?https?:\/\/schema\.org\/(?:Product|Offer|AggregateOffer|ProductGroup|IndividualProduct)\b/i.test(
      html,
    )
  ) {
    return [];
  }
  const out: string[] = [];
  for (const m of html.matchAll(/<[a-z][^>]*\bitemprop\s*=\s*["']?(?:price|lowPrice)\b[^>]*>/gi)) {
    const tag = m[0];
    const content = attrValue(tag, 'content');
    const text =
      content ??
      html
        .slice((m.index ?? 0) + tag.length, (m.index ?? 0) + tag.length + 200)
        .split('<')[0]
        ?.trim();
    const p = positivePrice(text);
    if (p) out.push(p);
  }
  return out;
}

export function openGraphPrices(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attrValue(tag, 'property') ?? attrValue(tag, 'name') ?? '').toLowerCase();
    if (key !== 'product:price:amount' && key !== 'og:price:amount') continue;
    const p = positivePrice(attrValue(tag, 'content'));
    if (p) out.push(p);
  }
  return out;
}

export function shopifyPrices(html: string): string[] {
  const m = /var\s+meta\s*=\s*(\{"product":\{[\s\S]*?\});\s*(?:\n|for\b|var\b)/.exec(html);
  if (!m?.[1]) return [];
  try {
    const meta = JSON.parse(m[1]) as { product?: { variants?: Array<{ price?: unknown }> } };
    return (meta.product?.variants ?? [])
      .map((v) => (typeof v.price === 'number' && v.price > 0 ? String(v.price) : undefined))
      .filter((p): p is string => p !== undefined);
  } catch {
    return [];
  }
}

export function readability(contentType: string, body: string): Readability {
  if (contentType && !/html|xml/i.test(contentType)) {
    return { readable: false, methods: [], prices: [], badJsonLd: 0 };
  }
  const html = body.slice(0, SCAN);
  const found: Array<[ReadMethod, string[]]> = [];
  const ld = jsonLdPrices(html);
  found.push(['shopify', shopifyPrices(html)]);
  found.push(['json-ld', ld.prices]);
  found.push(['microdata', microdataPrices(html)]);
  found.push(['opengraph', openGraphPrices(html)]);
  const hits = found.filter(([, p]) => p.length > 0);
  return {
    readable: hits.length > 0,
    methods: hits.map(([k]) => k),
    prices: hits.flatMap(([, p]) => p).slice(0, 5),
    badJsonLd: ld.bad,
  };
}
