// Product page reader: JSON-LD Product (name, brand, mpn, gtin, offers), with a microdata fallback for gtin/mpn.
import { cached } from './src.mjs';

function* walk(x) {
  if (Array.isArray(x)) for (const y of x) yield* walk(y);
  else if (x && typeof x === 'object') {
    yield x;
    if (x['@graph']) yield* walk(x['@graph']);
    if (x.hasVariant) yield* walk(x.hasVariant);
  }
}
const decode = (s) =>
  typeof s === 'string'
    ? s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : s;

export function readProduct(html) {
  const products = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try {
      j = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const o of walk(j)) {
      const t = [].concat(o['@type'] ?? []);
      if (t.includes('Product') || t.includes('ProductGroup')) products.push(o);
    }
  }
  const p = products.find((x) => [].concat(x['@type']).includes('Product')) ?? products[0];
  if (!p) return null;
  const offer = [].concat(p.offers ?? [])[0] ?? {};
  const o2 = offer.offers ? [].concat(offer.offers)[0] : offer;
  const brand = typeof p.brand === 'string' ? p.brand : (p.brand?.name ?? undefined);
  return {
    name: decode(p.name),
    brand: decode(Array.isArray(brand) ? brand[0] : brand),
    mpn: decode(p.mpn ?? undefined),
    sku: decode(p.sku ?? undefined),
    gtin: decode(
      p.gtin13 ?? p.gtin ?? p.gtin12 ?? p.gtin14 ?? p.gtin8 ?? o2.gtin13 ?? o2.gtin ?? undefined,
    ),
    price: o2.price ?? o2.lowPrice ?? offer.lowPrice ?? undefined,
    currency: o2.priceCurrency ?? offer.priceCurrency ?? undefined,
    condition: o2.itemCondition ?? undefined,
    seller: decode(o2.seller?.name ?? undefined),
  };
}

export async function htmlDetail(url, lang = 'de-DE,de;q=0.9,en;q=0.5') {
  const r = await cached(url, { accept: 'text/html,application/xhtml+xml', lang });
  if (r.status !== 200) return { status: r.status };
  return { status: 200, capturedAt: r.at, ...readProduct(r.text), finalUrl: r.finalUrl };
}

if (process.argv[2]?.startsWith('http')) {
  for (const u of process.argv.slice(2)) console.info(JSON.stringify(await htmlDetail(u)));
}
