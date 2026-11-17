// Builds the spike C domain lists from the public Common Crawl URL index (no account, no key).
// It never contacts a shop: hosts are picked from URLs Common Crawl already captured, and
// Shopify candidates are confirmed by a DNS lookup only. See ./README.md for method and bias.
//
//   node lab/routes/sample/build-sample.ts --crawl CC-MAIN-2026-43 --chunks 60 --chunk-blocks 300 --seed 20261117
//
// The index is ~887k gzip blocks of ~3,000 captures each, sorted by reversed host name. Fetching
// random single blocks gets throttled (HTTP 503 per request), so the sample is clustered: `chunks`
// random starting blocks, each read with `chunk-blocks` following blocks in one range request.
import { lookup } from 'node:dns/promises';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { mulberry32, shuffle } from './random.ts';

const CC = 'https://data.commoncrawl.org';
const UA = 'agentic-dasher-lab/0.1 (route reachability sample builder)';

// Path signatures of captured URLs (an optional /xx or /xx-yy locale prefix is allowed).
const L = '^(?:/[a-z]{2}(?:[-_][a-z]{2})?)?';
export const SIGNATURES = {
  // WooCommerce default permalink bases and its add-to-cart link.
  woocommerce: new RegExp(
    `${L}/(?:product-category|product-tag)/|[?&]add-to-cart=\\d|/wp-content/plugins/woocommerce/`,
    'i',
  ),
  // Magento (1 and 2) controller routes, its store-switch and session parameters, and the M2
  // static path. `/checkout/cart/` alone is not used: Shopware shares it.
  magento: new RegExp(
    [
      `${L}/(?:customer/account/(?:login|create|forgotpassword)|customer/section/load|catalogsearch/(?:result|advanced)|catalog/(?:product|category)/view/id/|catalog/product_compare/|wishlist/index/add/|review/product/list/id/|sendfriend/product/|newsletter/subscriber/new|stores/store/(?:switch|redirect)/)`,
      '/checkout/cart/add/uenc/',
      '/static/version\\d+/frontend/',
      '[?&](?:___store|___from_store|___SID)=',
    ].join('|'),
    'i',
  ),
  // Shopify storefront routes; candidates are then confirmed by DNS.
  shopify: new RegExp(`${L}/(?:products|collections)/[^/?#]+`, 'i'),
  // Any shop-like path, for the SearchAction/OpenSearch population.
  shop: new RegExp(
    `${L}/(?:product|products|shop|store|cart|basket|checkout|warenkorb|panier|carrito|carrello)(?:/|$|\\.)`,
    'i',
  ),
};
type Sig = keyof typeof SIGNATURES;
type Found = Record<string, Sig[]>;

/** Hosts in CDX lines whose status-200 captures match a signature. */
export function hostsInCdx(buf: Buffer): Found {
  const into = new Map<string, Set<Sig>>();
  const sigs = Object.entries(SIGNATURES) as Array<[Sig, RegExp]>;
  // A 300-block chunk inflates to ~0.5 GB, past V8's string limit: decode in slices at newlines.
  const slices: Array<[number, number]> = [];
  for (let start = 0; start < buf.length; ) {
    let end = Math.min(buf.length, start + 64 * 1024 * 1024);
    if (end < buf.length) end = buf.indexOf(10, end) + 1 || buf.length;
    slices.push([start, end]);
    start = end;
  }
  for (const line of slices.flatMap(([a, b]) => buf.toString('utf8', a, b).split('\n'))) {
    // Cheap string tests first; JSON.parse and URL only for the few lines that can match.
    if (!line.includes('"status": "200"')) continue;
    const a = line.indexOf('"url": "');
    if (a < 0) continue;
    const raw = line.slice(a + 8, line.indexOf('"', a + 8));
    const rawPath = /^https?:\/\/[^/?#]*([^#]*)/.exec(raw)?.[1] ?? '';
    if (!sigs.some(([, re]) => re.test(rawPath))) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase();
    if (u.port || isIP(host) || !host.includes('.') || host.endsWith('.myshopify.com')) continue;
    const pathq = u.pathname + u.search;
    for (const [name, re] of sigs) {
      if (re.test(pathq)) into.set(host, (into.get(host) ?? new Set<Sig>()).add(name));
    }
  }
  return Object.fromEntries([...into].map(([h, s]) => [h, [...s].sort()]));
}

// Common Crawl answers 503 (SlowDown) when pushed: back off with jitter and retry.
async function readRange(crawl: string, file: string, from: number, to: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(`${CC}/cc-index/collections/${crawl}/indexes/${file}`, {
        headers: { 'user-agent': UA, range: `bytes=${from}-${to - 1}` },
      });
      status = res.status;
      if (status === 206) return gunzipSync(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      if (attempt >= 15) throw e;
      status = 0; // network error or truncated body: retry
    }
    if (status !== 0 && status !== 503) throw new Error(`${file}@${from}: HTTP ${status}`);
    if (attempt >= 15) throw new Error(`${file}@${from}: still failing after ${attempt} retries`);
    console.warn(`${file}@${from}: ${status || 'error'}, retry ${attempt + 1}`);
    await new Promise((r) =>
      setTimeout(r, Math.min(60, 3 * (attempt + 1)) * 1000 * (0.5 + Math.random())),
    );
  }
}

async function isShopifyDns(host: string): Promise<boolean> {
  try {
    const addrs = await lookup(host, { all: true, family: 4 });
    return addrs.some((a) => a.address.startsWith('23.227.38.'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      crawl: { type: 'string', default: 'CC-MAIN-2026-43' },
      chunks: { type: 'string', default: '60' },
      workers: { type: 'string', default: '3' },
      'chunk-blocks': { type: 'string', default: '300' },
      seed: { type: 'string', default: '20261117' },
      'per-list': { type: 'string', default: '200' },
      cache: { type: 'string', default: 'lab/out/routes/cc' },
      'out-dir': { type: 'string', default: 'lab/routes/sample' },
    },
  });
  const { crawl, cache } = args;
  const seed = Number(args.seed);
  const perList = Number(args['per-list']);
  const span = Number(args['chunk-blocks']);
  const rnd = mulberry32(seed);

  const idxPath = join(cache, `${crawl}-cluster.idx`);
  if (!existsSync(idxPath)) {
    const res = await fetch(`${CC}/cc-index/collections/${crawl}/indexes/cluster.idx`, {
      headers: { 'user-agent': UA },
    });
    if (!res.ok) throw new Error(`cluster.idx: HTTP ${res.status}`);
    await mkdir(dirname(idxPath), { recursive: true });
    await writeFile(idxPath, Buffer.from(await res.arrayBuffer()));
  }
  const blocks = (await readFile(idxPath, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .map(([, file, off, len]) => ({ file: file ?? '', offset: Number(off), length: Number(len) }));
  const starts = shuffle(
    blocks.map((_, i) => i),
    rnd,
  ).slice(0, Number(args.chunks));

  // Per-chunk results are cached so an interrupted run resumes. The lists depend only on
  // (crawl, seed, chunks, chunk-blocks), never on download order.
  const cachePath = join(cache, `${crawl}-chunks.jsonl`);
  const cached = new Map<string, Found>();
  if (existsSync(cachePath)) {
    for (const line of (await readFile(cachePath, 'utf8')).split('\n').filter(Boolean)) {
      const { key, found } = JSON.parse(line) as { key: string; found: Found };
      cached.set(key, found);
    }
  }
  const hosts = new Map<string, Set<Sig>>();
  const withWww = new Set<string>();
  let blocksRead = 0;
  // A few chunks in flight, with a pause after each; Common Crawl answers 503 on cache misses
  // under load, and the retry loop absorbs that.
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = starts[next++]; i !== undefined; i = starts[next++]) {
      await readChunk(i);
    }
  };
  const readChunk = async (i: number) => {
    const first = blocks[i];
    if (!first) return;
    // Contiguous blocks in the same shard file, up to `span`.
    let last = first;
    let count = 1;
    for (let k = i + 1; k < i + span && blocks[k]?.file === first.file; k++, count++) {
      last = blocks[k] ?? last;
    }
    const key = `${first.file}@${first.offset}+${span}`;
    let found = cached.get(key);
    if (!found) {
      found = hostsInCdx(
        await readRange(crawl, first.file, first.offset, last.offset + last.length),
      );
      await new Promise((r) => setTimeout(r, 1500));
      await appendFile(cachePath, `${JSON.stringify({ key, found })}\n`);
    }
    blocksRead += count;
    // `www.x` and `x` are one shop: keyed by the bare name, probed as `www.x` if that was seen.
    for (const [h, sigs] of Object.entries(found)) {
      const bare = h.replace(/^www\./, '');
      const s = hosts.get(bare) ?? new Set<Sig>();
      for (const x of sigs) s.add(x);
      hosts.set(bare, s);
      if (h !== bare) withWww.add(bare);
    }
    console.info(`chunk ${++done}/${starts.length} ${key}: ${hosts.size} hosts so far`);
  };
  await Promise.all(Array.from({ length: Number(args.workers) }, worker));

  for (const bare of withWww) {
    hosts.set(`www.${bare}`, hosts.get(bare) ?? new Set());
    hosts.delete(bare);
  }
  const all = [...hosts.keys()].sort();
  const has = (h: string, s: Sig) => hosts.get(h)?.has(s) === true;
  const pools = {
    woocommerce: all.filter((h) => has(h, 'woocommerce') && !has(h, 'magento')),
    magento: all.filter((h) => has(h, 'magento') && !has(h, 'woocommerce')),
    shopify: all.filter((h) => has(h, 'shopify') && !has(h, 'woocommerce') && !has(h, 'magento')),
  };
  const lists: Record<string, string[]> = {
    woocommerce: shuffle(pools.woocommerce, rnd).slice(0, perList),
    magento: shuffle(pools.magento, rnd).slice(0, perList),
    shopify: [],
  };
  let dnsLookups = 0;
  for (const h of shuffle(pools.shopify, rnd)) {
    if ((lists.shopify?.length ?? 0) >= perList) break;
    dnsLookups++;
    if (await isShopifyDns(h)) lists.shopify?.push(h);
  }
  const taken = new Set(Object.values(lists).flat());
  const shopPool = all.filter((h) => !taken.has(h));
  lists.searchaction = shuffle(shopPool, rnd).slice(0, perList);

  await mkdir(args['out-dir'], { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  for (const [name, list] of Object.entries(lists)) {
    const header = [
      `# spike C domain list: ${name} (${list.length} hosts)`,
      `# built ${date} by lab/routes/sample/build-sample.ts from the Common Crawl ${crawl} URL index`,
      `# --chunks ${args.chunks} --chunk-blocks ${span} --seed ${seed} --per-list ${perList} (${blocksRead} index blocks read)`,
      `# pools: woocommerce=${pools.woocommerce.length} magento=${pools.magento.length} shopify-candidates=${pools.shopify.length} (DNS lookups ${dnsLookups}) shop-like-rest=${shopPool.length}`,
    ];
    const body = [...list].sort().map((h) => `${h}  # ${[...(hosts.get(h) ?? [])].join(',')}`);
    await writeFile(join(args['out-dir'], `${name}.txt`), `${[...header, ...body].join('\n')}\n`);
    console.info(`${name}: ${list.length}`);
  }
}

if (import.meta.main) await main();
