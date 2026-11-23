// node links.mjs <file> : each line "url | regex | max"; prints unique hrefs in the (cached) page matching the regex.
import { readFileSync } from 'node:fs';
import { cached } from './src.mjs';
export function productLinks(text, base, re) {
  const seen = new Set();
  for (const m of text.matchAll(/href="([^"#]+)"/g)) {
    const h = m[1].replace(/&amp;/g, '&');
    if (!new RegExp(re).test(h)) continue;
    seen.add(new URL(h, base).href);
  }
  return [...seen];
}
if (process.argv[1]?.endsWith('links.mjs') && process.argv[2]) {
  for (const line of readFileSync(process.argv[2], 'utf8')
    .split('\n')
    .filter((l) => l.includes('|'))) {
    const [u, re, max = '8'] = line.split('|').map((s) => s.trim());
    const r = await cached(u, {
      accept: 'text/html,application/xhtml+xml',
      lang: 'de-DE,de;q=0.9,en;q=0.5',
    });
    const ls = productLinks(r.text, r.finalUrl || u, re);
    console.info(`== ${r.status} ${ls.length} links ${u}`);
    console.info(ls.slice(0, Number(max)).join('\n'));
  }
}
