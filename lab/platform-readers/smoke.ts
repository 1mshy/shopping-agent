// Manual smoke of the platform JSON readers (unit P1-2b): each reader reads one real product
// through the real `fetchPage` (guard, pinned transport, impit). Not part of the test suite.
//
// Allowance, enforced here: at most 12 requests on the wire in all (each redirect hop counts), at
// most 4 per host, at least 3.5 s between any two requests, only hosts in the committed spike C
// lists (lab/routes/sample/*.txt), and a host is dropped at its first wall, 403 or 429. A response
// already read is served again from memory, so the readers can be run twice on one answer without
// a second request.
//
// One extra request is made on purpose: the decimal `.json` view of the Shopify product read in
// JPY, to check what unit the `.js` integers are in for a zero-decimal currency.
//
// Usage: node lab/platform-readers/smoke.ts [out-dir]
// The trimmed `.js` and `.json` answers of the JPY product are written to out-dir (default: the
// OS temporary directory) for a fixture to be cut from; no cookie or header is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CookieJars,
  createHttpNetwork,
  fetchPage,
  type HttpNetwork,
  type PageResult,
} from '../../packages/fetch/src/index.ts';
import {
  type EndpointReader,
  magentoReader,
  type ReaderContext,
  type ReaderOutcome,
  type ReadRequest,
  type StoreHints,
  shopifyReader,
  wooReader,
} from '../../packages/sources/src/index.ts';

const MAX_REQUESTS = 12;
const MAX_PER_HOST = 4;
const GAP_MS = 3_500;
const DEADLINE_MS = 20_000;
const OUT = process.argv[2] ?? tmpdir();

const LISTS: Record<string, string> = {
  shopify: 'lab/routes/sample/shopify.txt',
  woo: 'lab/routes/sample/woocommerce.txt',
  magento: 'lab/routes/sample/magento.txt',
};

function listed(list: string, host: string): boolean {
  const text = readFileSync(new URL(`../../${LISTS[list]}`, import.meta.url), 'utf8');
  // Lines are "host  # tags"; comment lines start with "#".
  return text.split('\n').some((line) => line.split('#')[0]?.trim() === host);
}

let sent = 0;
let lastStart = 0;
const perHost = new Map<string, number>();
const stopped = new Set<string>();
const cache = new Map<string, PageResult>();
const real = createHttpNetwork();
const log: string[] = [];

function say(line: string): void {
  log.push(line);
  console.info(line);
}

const network: HttpNetwork = {
  open(context) {
    const net = real.open(context);
    return {
      lookup: (host) => net.lookup(host),
      async exchange(address, port, url) {
        const host = new URL(url).hostname;
        if (sent >= MAX_REQUESTS) throw new Error('smoke allowance spent');
        if ((perHost.get(host) ?? 0) >= MAX_PER_HOST)
          throw new Error(`host allowance spent: ${host}`);
        const wait = lastStart + GAP_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStart = Date.now();
        sent++;
        perHost.set(host, (perHost.get(host) ?? 0) + 1);
        const response = await net.exchange(address, port, url);
        say(`    wire ${sent}: GET ${url.slice(0, 160)} -> ${response.status}`);
        return response;
      },
    };
  },
};

const jars = new CookieJars();

async function get(url: string, rung: 'api' | 'http'): Promise<PageResult> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const host = new URL(url).hostname;
  if (stopped.has(host)) {
    return { outcome: { kind: 'refused_by_policy', rung, reason: 'host_limit' }, response: null };
  }
  const result = await fetchPage(
    {
      url,
      rung: 'api',
      deadline: Date.now() + DEADLINE_MS,
      signal: AbortSignal.timeout(DEADLINE_MS),
    },
    { network, jars },
  );
  const status = result.response?.status;
  const cookies = (result.response?.setCookies ?? []).map((c) => c.split('=')[0]).join(', ');
  say(`  ${result.outcome.kind} (status ${status ?? '-'}; set-cookie names: ${cookies || 'none'})`);
  if (result.outcome.kind === 'wall' || result.outcome.kind === 'rate_limited' || status === 403) {
    stopped.add(host);
    say(`  host ${host} stopped`);
  }
  cache.set(url, result);
  return result;
}

const context: ReaderContext = { get: ({ url, rung }) => get(url, rung), now: () => Date.now() };

function hints(platform: StoreHints['platform']): StoreHints {
  return { platform, marketPrefix: '', country: null, baseCurrency: 'unknown', locale: null };
}

function summary(outcome: ReaderOutcome): string {
  if (outcome.kind === 'read') {
    const r = outcome.read;
    return `read: currency ${r.currency}, sticker ${r.sticker === null ? 'null' : 'set'}, availability ${r.availability}, variant ${JSON.stringify(r.variant)}`;
  }
  if (outcome.kind === 'no_read') {
    return `no_read ${outcome.reason}: ${outcome.detail}${outcome.fetch ? ` (fetch ${outcome.fetch.kind})` : ''}`;
  }
  return 'not_applicable';
}

async function runReader(reader: EndpointReader, request: ReadRequest, label: string) {
  say(`${label}: ${request.url}`);
  if (!reader.applies(request)) {
    say('  does not apply');
    return null;
  }
  const outcome = await reader.read(request, context);
  say(`  => ${summary(outcome)}`);
  return outcome;
}

function json(result: PageResult): unknown {
  try {
    return result.response === null ? null : JSON.parse(result.response.text);
  } catch {
    return null;
  }
}

const MARKET = { country: 'CA', currency: 'CAD', language: 'en-CA' } as const;
const request = (url: string, platform: StoreHints['platform'], extra = {}): ReadRequest => ({
  url,
  market: MARKET,
  store: hints(platform),
  variant: null,
  ...extra,
});

// Steps to run (default all). Each run of this script is counted against the allowance by hand:
// the caps above are per process.
const ALL = ['shopify-jp', 'shopify-de', 'woo', 'magento'];
const chosen = process.argv.slice(3);
const steps = new Set(chosen.length > 0 ? chosen : ALL);

/** Reads a Shopify product; on variant_not_found, reads the first variant from the same answer. */
async function shopifyStep(url: string): Promise<{ variants?: { id?: number }[] } | null> {
  const outcome = await runReader(shopifyReader, request(url, 'shopify'), 'shopify');
  const answer = cache.get(`${url}.js`);
  const product = answer ? (json(answer) as { variants?: { id?: number }[] } | null) : null;
  const first = product?.variants?.[0]?.id;
  if (
    outcome?.kind === 'no_read' &&
    outcome.reason === 'variant_not_found' &&
    first !== undefined
  ) {
    await runReader(
      shopifyReader,
      request(`${url}?variant=${first}`, 'shopify'),
      'shopify (first variant, from memory)',
    );
  }
  return product;
}

// 1. Shopify, a zero-decimal storefront (shop.aviot.jp, handle from spike C's stored answers).
const JP = 'shop.aviot.jp';
if (!listed('shopify', JP)) throw new Error(`${JP} is not in the committed list`);
const jpUrl = `https://${JP}/products/te-v1r-ad2`;
const product = steps.has('shopify-jp') ? await shopifyStep(jpUrl) : null;
const jsResult = cache.get(`${jpUrl}.js`);
if (jsResult?.outcome.kind === 'ok' && !stopped.has(JP)) {
  say('shopify unit check: the decimal .json view of the same product');
  const view = await get(`${jpUrl}.json`, 'api');
  const decimal = json(view) as {
    product?: { variants?: { id?: number; price?: string }[] };
  } | null;
  const pairs = (product?.variants ?? []).slice(0, 5).map((v) => {
    const other = decimal?.product?.variants?.find((d) => d.id === v.id);
    return { id: v.id, js: (v as { price?: number }).price, json: other?.price };
  });
  for (const p of pairs) say(`  variant ${p.id}: .js ${p.js} / .json ${JSON.stringify(p.json)}`);
  writeFileSync(join(OUT, 'smoke-shopify-jpy.js.json'), JSON.stringify(product, null, 2));
  writeFileSync(join(OUT, 'smoke-shopify-jpy.json.json'), JSON.stringify(decimal, null, 2));
}

// 2. Shopify, a two-decimal storefront.
const DE = 'warenzo.de';
if (!listed('shopify', DE)) throw new Error(`${DE} is not in the committed list`);
if (steps.has('shopify-de')) {
  await shopifyStep(
    `https://${DE}/products/magsafe-strmbank-med-multifunksjonell-ladealternativ-og-kompakt-konstruksjon-skanto-jligat8vtd`,
  );
}

// 3. WooCommerce: one Store API listing for a product link, then the reader on that link.
const WOO = 'bookmans.com';
if (!listed('woo', WOO)) throw new Error(`${WOO} is not in the committed list`);
if (steps.has('woo')) {
  say(`woo discovery: one product link from ${WOO}`);
  const list = json(await get(`https://${WOO}/wp-json/wc/store/v1/products?per_page=1`, 'api'));
  const link = Array.isArray(list)
    ? (list[0] as { permalink?: string } | undefined)?.permalink
    : undefined;
  if (typeof link === 'string' && new URL(link).hostname === WOO) {
    await runReader(wooReader, request(link, 'woo'), 'woo');
  } else say('  no product link found');
}

// 4. Magento 2: one GraphQL search for a URL key, then the reader on that product. The step
// `magento-direct` reads the key the first run found without searching again, and keeps the
// answer's shape (keys, error messages; no figures) for the record. On 2026-11-24 shop.adn.de
// answered the url_key filter with two other products (the filter was not applied), which the
// reader refused; the step `magento-alt` runs the same search and read on a second host.
const MAGENTO = steps.has('magento-alt') ? 'eaglebuy.ch' : 'shop.adn.de';
if (!listed('magento', MAGENTO)) throw new Error(`${MAGENTO} is not in the committed list`);
let key: string | undefined;
if (steps.has('magento') || steps.has('magento-alt')) {
  say(`magento discovery: one URL key from ${MAGENTO}`);
  const search = '{products(search:"set",pageSize:1){items{url_key}}}';
  const found = json(
    await get(`https://${MAGENTO}/graphql?query=${encodeURIComponent(search)}`, 'api'),
  ) as { data?: { products?: { items?: { url_key?: string }[] } } } | null;
  key = found?.data?.products?.items?.[0]?.url_key;
  if (typeof key !== 'string' || key === '') say('  no URL key found');
}
if (steps.has('magento-direct')) key = 'safety-clamp-set';
if (typeof key === 'string' && key !== '') {
  const url = `https://${MAGENTO}/${key}.html`;
  await runReader(magentoReader, request(url, 'magento'), 'magento');
  for (const [asked, result] of cache) {
    if (!asked.includes('/graphql?query=%7Bproducts(filter')) continue;
    const shape = (value: unknown, depth: number): unknown => {
      if (Array.isArray(value)) return value.slice(0, 2).map((v) => shape(v, depth + 1));
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, k === 'message' ? v : shape(v, depth + 1)]),
        );
      }
      return typeof value === 'number' ? '<number>' : value;
    };
    const body = result.response?.text ?? '';
    say(`  answer: ${body.length} characters, starts ${JSON.stringify(body.slice(0, 40))}`);
    say(`  shape: ${JSON.stringify(shape(json(result), 0)).slice(0, 1500)}`);
  }
}

say(`requests on the wire: ${sent}; per host: ${JSON.stringify(Object.fromEntries(perHost))}`);
writeFileSync(join(OUT, 'smoke-platform-readers.log'), `${log.join('\n')}\n`);
process.exit(0);
