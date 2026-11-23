// node build-set.mjs <setDir> : products.json from identities.mjs and the product configs; copies snapshot files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IDENTITIES } from './identities.mjs';

const configs = [];
// the first config with an id wins: products-de2.mjs replaces the DE power-tool configs of products-de.mjs
for (const f of [
  'products-de2.mjs',
  'products-add.mjs',
  'products-add2.mjs',
  'products-ca.mjs',
  'products-us.mjs',
  'products-de.mjs',
])
  configs.push(...(await import(`./${f}`)).PRODUCTS);
const dir = process.argv[2];
mkdirSync(`${dir}/snapshots`, { recursive: true });
const products = [];
const missing = [];
for (const [id, def] of Object.entries(IDENTITIES)) {
  const c = configs.find((x) => x.id === id);
  if (!c) throw new Error(`no config for ${id}`);
  const src = `out/snapshots/${id}.json`;
  if (!existsSync(src)) {
    missing.push(id);
    continue;
  }
  const n = JSON.parse(readFileSync(src, 'utf8')).length;
  const identity = { brand: def.brand };
  for (const k of ['model', 'mpn', 'gtin']) if (def[k]) identity[k] = def[k];
  identity.mustHave = def.mustHave ?? {};
  identity.condition = 'new';
  identity.packQuantity = def.packQuantity ?? 1;
  products.push({ id, category: c.category, country: c.country, identity, notes: def.notes });
  // US Shopify stores that localised to the requester's Canadian IP (cart.js said CAD): the .json
  // variant price may be in the shop's base currency, so the price's currency is not known.
  const snaps = JSON.parse(readFileSync(src, 'utf8'));
  for (const s of snaps) {
    if (s.context && s.capture.country === 'US' && s.context.currency === 'CAD')
      s.context.currency = 'unknown';
  }
  writeFileSync(`${dir}/snapshots/${id}.json`, `${JSON.stringify(snaps, null, 2)}\n`);
  console.info(`${id}\t${c.category}\t${c.country}\t${n}`);
}
products.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(`${dir}/products.json`, `${JSON.stringify(products, null, 2)}\n`);
console.info(`${products.length} products; missing snapshots: ${missing.join(', ') || 'none'}`);
