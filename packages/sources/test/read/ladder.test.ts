import type { PageResult } from '@agentic-dasher/fetch';
import type { FetchOutcome, RawCandidate } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import type {
  EndpointReader,
  ListingRead,
  ReaderContext,
  ReaderOutcome,
  ReadRequest,
} from '../../src/read/contract.ts';
import { readListing } from '../../src/read/ladder.ts';
import { CA, fixture, ldPage, page, request, values } from '../structured/helpers.ts';

const URL_ = 'https://shop.example.ca/products/widget';

interface FakeContext extends ReaderContext {
  readonly calls: { url: string; rung: string; referer?: string }[];
}

function context(result: PageResult | ((url: string) => PageResult)): FakeContext {
  const calls: { url: string; rung: string; referer?: string }[] = [];
  return {
    calls,
    async get(req) {
      calls.push({ ...req });
      return typeof result === 'function' ? result(req.url) : result;
    },
    now: () => 0,
  };
}

const ok = (html: string, finalUrl = URL_): PageResult => ({
  outcome: { kind: 'ok', rung: 'http' },
  response: page(html, finalUrl),
});

function listing(overrides: Partial<ListingRead> = {}): ListingRead {
  return {
    method: 'platform_json',
    rung: 'api',
    title: 'Widget',
    identifiers: { brand: null, gtin: null, mpn: null, sku: null, externalId: '42' },
    variant: {},
    condition: 'new',
    currency: 'CAD',
    sticker: 2499,
    referenceClaimed: null,
    coupon: null,
    memberPrice: null,
    shipping: null,
    shippingStatus: 'unknown',
    taxIncluded: null,
    unitPrice: null,
    unit: null,
    availability: 'in',
    candidates: [{ method: 'platform_json', confidence: 0.8, value: '24.99' }],
    ...overrides,
  };
}

function endpoint(
  outcome: ReaderOutcome | (() => ReaderOutcome),
  applies = true,
): EndpointReader & { readonly seen: ReadRequest[] } {
  const seen: ReadRequest[] = [];
  return {
    method: 'platform_json',
    seen,
    applies: () => applies,
    async read(req) {
      seen.push(req);
      return typeof outcome === 'function' ? outcome() : outcome;
    },
  };
}

const noRead = (
  reason: Extract<ReaderOutcome, { kind: 'no_read' }>['reason'],
  candidates: RawCandidate[] = [],
  fetch: FetchOutcome | null = null,
): ReaderOutcome => ({
  kind: 'no_read',
  method: 'platform_json',
  reason,
  detail: 'fake',
  candidates,
  fetch,
});

const tagged = (amount: string, currency = 'CAD') =>
  `<meta property="product:price:amount" content="${amount}"><meta property="product:price:currency" content="${currency}">`;
const ldOffer = (price: string, extra = '') =>
  `<script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"@type":"Offer","price":"${price}","priceCurrency":"CAD"}}</script>${extra}`;
const html = (head: string, body = '') =>
  `<!DOCTYPE html><html lang="en"><head><title>Widget</title>${head}</head><body>${body}</body></html>`;

describe('readListing: order and the one page fetch', () => {
  it('fetches the page once on the http rung and records what each method saw', async () => {
    const ctx = context(ok(html(ldOffer('24.99', tagged('24.99')))));
    const result = await readListing(request(URL_), [], ctx);
    expect(ctx.calls).toEqual([{ url: URL_, rung: 'http' }]);
    expect(result.kind).toBe('read');
    if (result.kind !== 'read') return;
    expect(result.read).toMatchObject({
      method: 'json_ld',
      rung: 'http',
      currency: 'CAD',
      sticker: 2499,
    });
    expect(result.methods.map((m) => [m.method, m.outcome.kind])).toEqual([
      ['json_ld', 'read'],
      ['microdata', 'not_applicable'],
      ['opengraph', 'read'],
    ]);
    expect(result.candidates).toEqual([
      { method: 'json_ld', confidence: 0.9, value: '24.99' },
      { method: 'opengraph', confidence: 0.5, value: '24.99' },
    ]);
    expect(result.read.candidates).toEqual(result.candidates);
  });

  it('an endpoint read ends the ladder: the page is not fetched', async () => {
    const ctx = context(ok(html(ldOffer('99.00'))));
    const reader = endpoint({ kind: 'read', read: listing() });
    const result = await readListing(request(URL_), [reader], ctx);
    expect(ctx.calls).toEqual([]);
    expect(reader.seen).toHaveLength(1);
    expect(result.kind).toBe('read');
    if (result.kind === 'read') {
      expect(result.read.method).toBe('platform_json');
      expect(result.read.sticker).toBe(2499);
      expect(result.methods.map((m) => [m.method, m.rung])).toEqual([['platform_json', 'api']]);
    }
  });

  it('an endpoint reader that does not apply is not asked', async () => {
    const reader = endpoint({ kind: 'read', read: listing() }, false);
    const ctx = context(ok(html(ldOffer('24.99'))));
    const result = await readListing(request(URL_), [reader], ctx);
    expect(reader.seen).toHaveLength(0);
    expect(ctx.calls).toHaveLength(1);
    expect(result.kind === 'read' && result.read.method).toBe('json_ld');
  });

  it('endpoint readers run in order until one reads', async () => {
    const wall: FetchOutcome = { kind: 'wall', rung: 'api', vendor: null, mode: 'challenge' };
    const first = endpoint(noRead('fetch_failed', [], wall));
    const second = endpoint({ kind: 'read', read: listing({ sticker: 1999 }) });
    const third = endpoint({ kind: 'read', read: listing({ sticker: 5 }) });
    const result = await readListing(request(URL_), [first, second, third], context(ok('')));
    expect(third.seen).toHaveLength(0);
    expect(result.kind === 'read' && result.read.sticker).toBe(1999);
    expect(result.methods.map((m) => m.outcome.kind)).toEqual(['no_read', 'read']);
  });

  it('an endpoint that failed to fetch or found no price leaves the page to try', async () => {
    for (const outcome of [
      noRead('fetch_failed', [], { kind: 'not_found', rung: 'api' }),
      noRead('no_price'),
      noRead('unreadable_price'),
      { kind: 'not_applicable' } as const,
    ]) {
      const ctx = context(ok(html(ldOffer('24.99'))));
      const result = await readListing(request(URL_), [endpoint(outcome)], ctx);
      expect(ctx.calls).toHaveLength(1);
      expect(result.kind === 'read' && result.read.method).toBe('json_ld');
    }
  });

  it("an endpoint's variant_not_found, multiple_prices or converted_currency is final", async () => {
    for (const reason of ['variant_not_found', 'multiple_prices', 'converted_currency'] as const) {
      const kept: RawCandidate[] = [{ method: 'platform_json', confidence: 0.8, value: '19.99' }];
      const ctx = context(ok(html(ldOffer('24.99'))));
      const result = await readListing(request(URL_), [endpoint(noRead(reason, kept))], ctx);
      expect(ctx.calls).toEqual([]);
      expect(result).toMatchObject({ kind: 'failed', reason, fetch: null, candidates: kept });
    }
  });
});

describe('readListing: a failed page fetch is passed through, never "no price"', () => {
  const outcomes: FetchOutcome[] = [
    { kind: 'wall', rung: 'http', vendor: 'cloudflare', mode: 'challenge' },
    { kind: 'not_found', rung: 'http' },
    { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
    { kind: 'rate_limited', rung: 'http', retryAfterMs: 30_000 },
    { kind: 'network_error', rung: 'http', code: 'ETIMEDOUT' },
    { kind: 'empty', rung: 'http' },
  ];
  for (const outcome of outcomes) {
    it(`${outcome.kind}`, async () => {
      const response =
        outcome.kind === 'not_found' ? page(html(ldOffer('24.99')), URL_, 404) : null;
      const result = await readListing(request(URL_), [], context({ outcome, response }));
      expect(result.kind).toBe('failed');
      if (result.kind !== 'failed') return;
      expect(result.reason).toBe('fetch_failed');
      expect(result.fetch).toBe(outcome);
      expect(result.candidates).toEqual([]);
      expect(result.methods.map((m) => m.method)).toEqual([]);
    });
  }
});

describe('readListing: the candidate rule across methods', () => {
  it('JSON-LD outranks a disagreeing OpenGraph tag', async () => {
    const result = await readListing(
      request(URL_),
      [],
      context(ok(html(ldOffer('249.00', tagged('269.00'))))),
    );
    expect(result.kind === 'read' && result.read).toMatchObject({
      method: 'json_ld',
      sticker: 24900,
    });
    expect(values(result.candidates)).toEqual(['249.00', '269.00']);
  });

  it('microdata and OpenGraph, equal in rank, disagreeing: multiple_prices', async () => {
    const md =
      '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Widget</span><span itemprop="price" content="10.00"></span><meta itemprop="priceCurrency" content="CAD"></div>';
    const result = await readListing(request(URL_), [], context(ok(html(tagged('12.00'), md))));
    expect(result).toMatchObject({ kind: 'failed', reason: 'multiple_prices', fetch: null });
    expect(values(result.candidates)).toEqual(['10.00', '12.00']);
  });

  it("JSON-LD's variant_not_found is not overruled by an OpenGraph price", async () => {
    const result = await readListing(
      request('https://ca.store.bambulab.com/products/a1-mini'),
      [],
      context(
        ok(
          fixture('bambulab-a1-mini.html').replace('</head>', `${tagged('249.00')}</head>`),
          'https://ca.store.bambulab.com/products/a1-mini',
        ),
      ),
    );
    expect(result).toMatchObject({ kind: 'failed', reason: 'variant_not_found' });
    expect(values(result.candidates)).toEqual(expect.arrayContaining(['249', '399', '249.00']));
  });

  it('the multi-capacity listing never takes the OpenGraph cheapest price', async () => {
    const url = 'https://www.aliexpress.com/item/1005006.html';
    for (const selector of [{ options: { Capacity: '4TB' } }, null]) {
      const result = await readListing(
        request(url, selector),
        [],
        context(ok(fixture('synthetic-multi-capacity-range.html'), url)),
      );
      expect(result).toMatchObject({ kind: 'failed', reason: 'variant_not_found' });
      expect(values(result.candidates)).toEqual(['39.99', '129.99', '39.99']);
    }
    const offers = await readListing(
      request(url),
      [],
      context(ok(fixture('synthetic-multi-capacity-offers.html'), url)),
    );
    expect(offers).toMatchObject({ kind: 'failed', reason: 'variant_not_found' });
    const fourTb = await readListing(
      request(url, { options: { Capacity: '4TB' } }),
      [],
      context(ok(fixture('synthetic-multi-capacity-offers.html'), url)),
    );
    expect(fourTb.kind === 'read' && fourTb.read).toMatchObject({
      method: 'json_ld',
      sticker: 12999,
    });
  });

  it('a page with no structured data at all', async () => {
    const result = await readListing(request(URL_), [], context(ok(html('', '<p>Call us</p>'))));
    expect(result).toMatchObject({
      kind: 'failed',
      reason: 'no_structured_data',
      fetch: null,
      candidates: [],
    });
  });

  it('three methods agreeing on a real page (Canada Computers)', async () => {
    const url =
      'https://www.canadacomputers.com/en/desktop-laptop-internal-ssds/233286/samsung-990-pro-2tb-m-2-nvme-pcie-4-0-solid-state-drive-mz-v9p2t0b-am.html';
    const result = await readListing(
      request(url),
      [],
      context(ok(fixture('canadacomputers-990-pro.html'), url)),
    );
    expect(result.kind).toBe('read');
    if (result.kind !== 'read') return;
    expect(result.read).toMatchObject({ method: 'json_ld', sticker: 87499, currency: 'CAD' });
    expect(result.methods.map((m) => m.outcome.kind)).toEqual(['read', 'read', 'read']);
    expect(values(result.candidates)).toEqual(['874.99', '$874.99', '874.99']);
  });

  it("a read's candidate list keeps at most 20, the winner's first", async () => {
    const offers = Array.from({ length: 30 }, (_, i) => ({
      '@type': 'Offer',
      price: `${i + 10}.00`,
      priceCurrency: 'CAD',
      sku: `S${i}`,
    }));
    const product = { '@type': 'Product', name: 'W', offers };
    const result = await readListing(
      request(URL_, { sku: 'S29' }),
      [],
      context(ok(ldPage(product))),
    );
    expect(result.kind).toBe('read');
    if (result.kind !== 'read') return;
    expect(result.read.sticker).toBe(3900);
    expect(result.read.candidates).toHaveLength(20);
    expect(result.read.candidates[0]).toEqual({
      method: 'json_ld',
      confidence: 0.9,
      value: '39.00',
    });
  });

  it('passes the market through unchanged and asks nothing else of the context', async () => {
    const reader = endpoint(noRead('no_price'));
    const req = request(URL_, null, null, CA);
    await readListing(req, [reader], context(ok(html(ldOffer('1.00')))));
    expect(reader.seen[0]).toBe(req);
  });
});
