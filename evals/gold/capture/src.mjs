// Source adapters: search a shop and read listing details, through a disk cache of raw responses.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { get } from './http.mjs';

const RAW = process.env.GOLD_RAW ?? './raw';
mkdirSync(RAW, { recursive: true });

export async function cached(url, opts = {}) {
  const hdr = opts.headers ? JSON.stringify(opts.headers) : '';
  const key = createHash('sha256')
    .update(`${opts.method ?? 'GET'} ${url} ${opts.body ?? ''}${hdr}`)
    .digest('hex')
    .slice(0, 24);
  const f = `${RAW}/${key}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const r = await get(url, opts);
  const rec = {
    url,
    finalUrl: r.url,
    status: r.status,
    at: new Date().toISOString(),
    text: r.text,
    error: r.error,
  };
  if (r.status > 0) writeFileSync(f, JSON.stringify(rec));
  return rec;
}
const parse = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};

const conditionFromTitle = (t) =>
  /\brefurb|renewed|reconditioned|generalüberholt|wiederaufbereitet/i.test(t)
    ? 'refurbished'
    : /open[- ]box/i.test(t)
      ? 'open_box'
      : /\bused\b|gebraucht/i.test(t)
        ? 'unknown'
        : 'new';

export const CURRENCY_BY_HOST = {};

// ---------- Shopify ----------
export async function shopifySearch(host, q, limit = 10) {
  const r = await cached(
    `https://${host}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=${limit}&resources[options][unavailable_products]=last`,
  );
  const j = parse(r);
  const ps = j?.resources?.results?.products ?? [];
  return ps.map((p) => ({
    source: 'shopify',
    host: new URL(r.finalUrl || `https://${host}`).host,
    handle: p.handle,
    title: p.title,
    vendor: p.vendor,
    url: new URL(p.url.split('?')[0], `https://${host}`).href,
  }));
}
export async function shopifyDetail(c) {
  const r = await cached(`${c.url}.json`);
  const j = parse(r)?.product;
  if (!j) return null;
  // presentment currency: the .js endpoint has no currency; read the cart's currency from /cart.js once per host
  if (!CURRENCY_BY_HOST[c.host]) {
    const cart = parse(await cached(`https://${c.host}/cart.js`));
    CURRENCY_BY_HOST[c.host] = cart?.currency ?? 'unknown';
  }
  return {
    capturedAt: r.at,
    title: j.title,
    vendor: j.vendor,
    productType: j.product_type,
    options: (j.options ?? []).map((o) => o.name),
    variants: (j.variants ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || undefined,
      barcode: v.barcode || undefined,
      price: v.price,
      opts: Object.fromEntries(
        (j.options ?? [])
          .map((o, i) => [o.name, v[`option${i + 1}`]])
          .filter(([n, val]) => val && !(n === 'Title' && val === 'Default Title')),
      ),
    })),
    currency: CURRENCY_BY_HOST[c.host],
  };
}

// ---------- WooCommerce Store API ----------
export async function wooSearch(host, q, limit = 10) {
  const r = await cached(
    `https://${host}/wp-json/wc/store/v1/products?search=${encodeURIComponent(q)}&per_page=${limit}`,
  );
  const j = parse(r);
  if (!Array.isArray(j)) return [];
  return j.map((p) => ({
    source: 'woo',
    host,
    title: p.name
      .replace(/&#8211;/g, '–')
      .replace(/&#8221;|&#8243;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#038;/g, '&'),
    url: p.permalink,
    detail: {
      capturedAt: r.at,
      sku: p.sku || undefined,
      brand: p.brands?.[0]?.name,
      price: p.prices?.price,
      minor: p.prices?.currency_minor_unit,
      currency: p.prices?.currency_code ?? 'unknown',
      attributes: Object.fromEntries(
        (p.attributes ?? [])
          .filter((a) => !a.has_variations && a.terms?.length === 1)
          .map((a) => [a.name, a.terms[0].name]),
      ),
      variable: (p.variations ?? []).length > 0,
      type: p.type,
    },
  }));
}

// ---------- Magento 2 GraphQL ----------
export async function magentoSearch(host, q, limit = 10) {
  const query = `{products(search:${JSON.stringify(q)},pageSize:${limit}){items{__typename name sku url_key url_suffix price_range{minimum_price{final_price{value currency}}}}}}`;
  // toolnation.de serves Dutch names from the default store view; its German store view is toolnation_de
  const headers = host === 'www.toolnation.de' ? { Store: 'toolnation_de' } : undefined;
  const r = await cached(
    `https://${host}/graphql?query=${encodeURIComponent(query)}`,
    headers ? { headers } : {},
  );
  const j = parse(r);
  const items = j?.data?.products?.items ?? [];
  return items.map((p) => ({
    source: 'magento',
    host,
    title: p.name,
    url: `https://${host}/${p.url_key}${p.url_suffix ?? '.html'}`,
    detail: {
      capturedAt: r.at,
      sku: p.sku,
      price: p.price_range?.minimum_price?.final_price?.value,
      currency: p.price_range?.minimum_price?.final_price?.currency ?? 'unknown',
      typename: p.__typename,
    },
  }));
}

// ---------- Best Buy Canada ----------
export async function bbySearch(q, limit = 24) {
  const r = await cached(
    `https://www.bestbuy.ca/api/v2/json/search?query=${encodeURIComponent(q)}&lang=en-CA&pageSize=${limit}&page=1`,
  );
  const j = parse(r);
  return (j?.products ?? []).map((p) => ({
    source: 'bestbuy',
    host: 'www.bestbuy.ca',
    sku: p.sku,
    title: p.name,
    url: `https://www.bestbuy.ca${p.productUrl}`,
    marketplace: p.isMarketplace,
  }));
}
export async function bbyDetail(c) {
  const r = await cached(`https://www.bestbuy.ca/api/v2/json/product/${c.sku}?lang=en-CA`);
  const p = parse(r);
  if (!p) return null;
  return {
    capturedAt: r.at,
    title: p.name,
    brand: p.brandName,
    mpn: p.modelNumber,
    gtin: p.upcNumber,
    marketplace: p.isMarketplace,
    seller: p.seller?.name,
    price: p.salePrice ?? p.regularPrice,
    currency: 'CAD',
  };
}

export { conditionFromTitle, parse };
