// node hints.mjs <dir> <id>=<regex> ... : listings of a product whose title matches the regex, with ids.
import { readFileSync } from 'node:fs';

const [, , dir, ...pairs] = process.argv;
for (const pair of pairs) {
  const i = pair.indexOf('=');
  const id = pair.slice(0, i);
  const re = new RegExp(pair.slice(i + 1), 'i');
  const s = JSON.parse(readFileSync(`${dir}/snapshots/${id}.json`, 'utf8'));
  console.info(`## ${id} (${s.length})`);
  for (const x of s) {
    const l = x.listing;
    if (!re.test(`${l.title} ${Object.values(l.variantAttributes).join(' ')}`)) continue;
    const v = Object.values(l.variantAttributes).join('/');
    console.info(
      `${x.id.slice(-3)} ${l.storeHost.replace(/^www\./, '').slice(0, 10)} ${l.title.slice(0, 60)}${v ? ` {${v.slice(0, 30)}}` : ''} ${l.brand ? `b=${l.brand}` : ''} ${l.mpn ? `m=${l.mpn}` : ''} ${l.gtin ? `g=${l.gtin}` : ''} ${l.condition}`,
    );
  }
}
