// node capture.mjs <products.mjs> <outDir> [ids...] : search, select, read details and write snapshot files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { htmlDetail } from './ldjson.mjs';
import { productLinks } from './links.mjs';
import {
  bbyDetail,
  bbySearch,
  cached,
  conditionFromTitle,
  magentoSearch,
  shopifyDetail,
  shopifySearch,
  wooSearch,
} from './src.mjs';

const HTML_SOURCES = {
  alternate: {
    host: 'www.alternate.de',
    search: (q) => `https://www.alternate.de/listing.xhtml?q=${encodeURIComponent(q)}`,
    re: '/html/product/',
  },
  '3djake': {
    host: 'www.3djake.de',
    search: (q) => `https://www.3djake.de/search?keyword=${encodeURIComponent(q)}`,
    re: '^/(?!info/|kunden/|search|warenkorb|merkzettel|marken|hersteller)[a-z0-9-]+/[a-z0-9-]+$',
  },
  berrybase: {
    host: 'www.berrybase.de',
    search: (q) => `https://www.berrybase.de/search?search=${encodeURIComponent(q)}`,
    re: 'berrybase.de/[a-z0-9-]+$',
  },
};
const SKU_IS_MPN = new Set([
  'us.soundcore.com',
  'de.soundcore.com',
  'ca.soundcore.com',
  'ca.anker.com',
  'de.anker.com',
  'us.ugreen.com',
  'de.ugreen.com',
  'www.keychron.com',
  'www.cosori.com',
  'www.instantpot.com',
  'www.remingtonproducts.com',
  'www.ohiopowertool.com',
]);

// toolnation.de's SKU is the EAN (checked on Bosch 06019N3200: 4053423321555).
const SKU_IS_GTIN = new Set(['www.toolnation.de']);
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);
const gtinLike = (g) =>
  g && /^\d{8,14}$/.test(String(g).replace(/[\s-]/g, ''))
    ? String(g).replace(/[\s-]/g, '')
    : undefined;
const condFromSchema = (c, title) => {
  if (!c) return conditionFromTitle(title);
  if (/New/i.test(c)) return conditionFromTitle(title);
  if (/Refurb/i.test(c)) return 'refurbished';
  return 'unknown';
};

async function search(src, q) {
  const [kind, host] = src.split(':');
  if (kind === 'bby') return bbySearch(q, 24);
  if (kind === 'shopify') return shopifySearch(host, q, 10);
  if (kind === 'woo') return wooSearch(host, q, 10);
  if (kind === 'magento') return magentoSearch(host, q, 10);
  const h = HTML_SOURCES[kind];
  if (h) {
    const r = await cached(h.search(q), {
      accept: 'text/html,application/xhtml+xml',
      lang: 'de-DE,de;q=0.9,en;q=0.5',
    });
    if (r.status !== 200) return [];
    return productLinks(r.text, r.finalUrl || h.search(q), h.re).map((url) => ({
      source: 'html',
      host: h.host,
      url,
      title: decodeURIComponent(new URL(url).pathname),
    }));
  }
  throw new Error(`unknown source ${src}`);
}

// Turns one candidate into 0..n listing records (Shopify may give a preferred and one other variant).
async function details(c, p) {
  if (c.source === 'bestbuy') {
    const d = await bbyDetail(c);
    if (!d) return [];
    return [
      {
        capturedAt: d.capturedAt,
        url: c.url,
        title: clean(d.title),
        brand: clean(d.brand) || undefined,
        mpn: clean(d.mpn) || undefined,
        gtin: clean(d.gtin) || undefined,
        variantAttributes: {},
        condition: conditionFromTitle(d.title),
        sellerKind: d.marketplace ? 'marketplace_seller' : 'first_party',
        storeHost: c.host,
        priceText: d.price != null ? String(d.price) : '',
        currency: 'CAD',
      },
    ];
  }
  if (c.source === 'shopify') {
    const d = await shopifyDetail(c);
    if (!d || d.variants.length === 0) return [];
    const pref = p.preferVariant
      ? d.variants.find((v) => new RegExp(p.preferVariant, 'i').test(v.title))
      : undefined;
    const chosen = [pref ?? d.variants[0]];
    if (p.otherVariant && d.variants.length > 1) {
      const other = d.variants.find(
        (v) =>
          v !== chosen[0] && (!p.preferVariant || !new RegExp(p.preferVariant, 'i').test(v.title)),
      );
      if (other) chosen.push(other);
    }
    return chosen.map((v) => ({
      capturedAt: d.capturedAt,
      url: d.variants.length > 1 ? `${c.url}?variant=${v.id}` : c.url,
      title: clean(d.title),
      brand: clean(d.vendor) || undefined,
      mpn: SKU_IS_MPN.has(c.host) ? clean(v.sku) : undefined,
      gtin: gtinLike(v.barcode),
      variantAttributes: v.opts,
      condition: conditionFromTitle(`${d.title} ${v.title}`),
      sellerKind: 'first_party',
      storeHost: c.host,
      priceText: v.price ?? '',
      currency: d.currency,
    }));
  }
  if (c.source === 'woo' || c.source === 'magento') {
    const d = c.detail;
    const price =
      d.price == null
        ? ''
        : c.source === 'woo' && d.minor != null
          ? (Number(d.price) / 10 ** d.minor).toFixed(d.minor)
          : String(d.price);
    return [
      {
        capturedAt: d.capturedAt,
        url: c.url,
        title: clean(c.title),
        brand: clean(d.brand) || undefined,
        mpn: SKU_IS_MPN.has(c.host) ? clean(d.sku) : undefined,
        gtin: SKU_IS_GTIN.has(c.host) ? gtinLike(d.sku) : undefined,
        variantAttributes: {},
        condition: conditionFromTitle(c.title),
        sellerKind: 'first_party',
        storeHost: c.host,
        priceText: price,
        currency: d.currency ?? 'unknown',
      },
    ];
  }
  if (c.source === 'html') {
    const d = await htmlDetail(c.url);
    if (d.status !== 200 || !d.name) return [];
    const title =
      d.brand && !d.name.toLowerCase().includes(d.brand.toLowerCase())
        ? `${d.brand} ${d.name}`
        : d.name;
    return [
      {
        capturedAt: d.capturedAt,
        url: d.finalUrl || c.url,
        title: clean(title),
        brand: clean(d.brand) || undefined,
        mpn: clean(d.mpn) || undefined,
        gtin: clean(d.gtin) || undefined,
        variantAttributes: {},
        condition: condFromSchema(d.condition, d.name),
        sellerKind: 'first_party',
        storeHost: c.host,
        priceText: d.price != null ? String(d.price) : '',
        currency: d.currency ?? 'unknown',
      },
    ];
  }
  return [];
}

export async function captureProduct(p) {
  // 1. searches, results kept per source in rank order
  const perSource = [];
  for (const { src, q } of p.queries)
    perSource.push({ src, rs: await search(src, q).catch(() => []) });
  const rel = new RegExp(p.relevant, 'i');
  const excl = p.exclude ? new RegExp(p.exclude, 'i') : null;
  const seen = new Set();
  const queues = perSource.map(({ rs }) =>
    rs.filter((r) => {
      const key = r.url.replace(/\?.*$/, '');
      if (seen.has(key) || !rel.test(r.title) || excl?.test(r.title)) return false;
      seen.add(key);
      return true;
    }),
  );
  // 2. round-robin across sources, reading details until the target count
  const out = [];
  const target = p.target ?? 22;
  while (out.length < target && queues.some((q) => q.length)) {
    for (const q of queues) {
      const c = q.shift();
      if (!c) continue;
      for (const rec of await details(c, p)) {
        if (out.length >= Math.min(25, target + 2)) break;
        if (excl?.test(rec.title)) continue;
        if (!out.some((o) => o.url === rec.url)) out.push(rec);
      }
      if (out.length >= target) break;
    }
  }
  return out;
}

export function toSnapshots(p, recs) {
  return recs.map((r, i) => {
    const listing = { title: r.title };
    if (r.brand) listing.brand = r.brand;
    if (r.mpn) listing.mpn = r.mpn;
    if (r.gtin) listing.gtin = r.gtin;
    listing.variantAttributes = Object.fromEntries(
      Object.entries(r.variantAttributes ?? {}).map(([k, v]) => [k, String(v)]),
    );
    listing.condition = r.condition;
    listing.sellerKind = r.sellerKind;
    listing.storeHost = r.storeHost;
    const snap = {
      id: `${p.id}-s${String(i + 1).padStart(2, '0')}`,
      productId: p.id,
      capture: { url: r.url, country: p.country, capturedAt: r.capturedAt },
      listing,
    };
    if (r.priceText !== '' && r.priceText != null)
      snap.context = {
        priceText: String(r.priceText),
        currency: /^[A-Z]{3}$/.test(r.currency ?? '') ? r.currency : 'unknown',
      };
    return snap;
  });
}

if (process.argv[2]) {
  const { PRODUCTS } = await import(new URL(process.argv[2], `file://${process.cwd()}/`).href);
  const outDir = process.argv[3];
  const only = new Set(process.argv.slice(4));
  mkdirSync(`${outDir}/snapshots`, { recursive: true });
  for (const p of PRODUCTS.filter((x) => only.size === 0 || only.has(x.id))) {
    const recs = await captureProduct(p);
    const snaps = toSnapshots(p, recs);
    writeFileSync(`${outDir}/snapshots/${p.id}.json`, `${JSON.stringify(snaps, null, 2)}\n`);
    const hosts = [...new Set(snaps.map((s) => s.listing.storeHost))].join(',');
    console.info(`${p.id}\t${snaps.length}\t${hosts}`);
  }
}
