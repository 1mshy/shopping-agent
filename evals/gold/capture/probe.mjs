import { readFileSync, writeFileSync } from 'node:fs';
import { get, json } from './http.mjs';

const [, , file, q] = process.argv;
const hosts = readFileSync(file, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));
const out = {};
await Promise.all(
  hosts.map(async (h) => {
    const r = { host: h };
    const s = await get(
      `https://${h}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`,
    );
    const sj = json(s);
    r.shopify = `${s.status}${sj?.resources ? ` products=${sj.resources.results.products.length}` : ''} ${s.error ?? ''} ${s.url && !s.url.includes(h) ? `->${s.url.slice(0, 60)}` : ''}`;
    if (!sj?.resources && s.status !== 403 && s.status !== 429) {
      const w = await get(
        `https://${h}/wp-json/wc/store/v1/products?search=${encodeURIComponent(q)}&per_page=5`,
      );
      const wj = json(w);
      r.woo = `${w.status}${Array.isArray(wj) ? ` products=${wj.length}` : ''}`;
      if (!Array.isArray(wj) && w.status > 0 && w.status !== 403 && w.status !== 429) {
        const g = await get(
          `https://${h}/graphql?query=${encodeURIComponent(`{products(search:"${q}",pageSize:5){total_count items{name sku}}}`)}`,
        );
        const gj = json(g);
        r.magento = `${g.status}${gj?.data?.products ? ` total=${gj.data.products.total_count}` : ''}`;
      }
    }
    out[h] = r;
    console.info(JSON.stringify(r));
  }),
);
writeFileSync(`${file}.probe.json`, JSON.stringify(out, null, 1));
