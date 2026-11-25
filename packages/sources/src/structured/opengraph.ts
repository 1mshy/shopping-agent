// The OpenGraph price-tag reader (S§5.2 "OpenGraph price tags"): `product:price:amount` /
// `og:price:amount` with their `…:currency`, read from `<meta property>` or `<meta name>`. Tags
// carry no variant identity, so variant coupling treats the page as one unit (product.ts
// `chooseSingle`): with a selector, only the URL or `product:retailer_item_id` can confirm it.
// A pure function of the page and the request.
import type { PageResponse } from '@agentic-dasher/fetch';
import type { ListingCurrency, RawCandidate } from '@agentic-dasher/shared';
import type { DocumentReader, ListingRead, NoReadReason, ReadRequest } from '../read/contract.ts';
import { guarded } from './guard.ts';
import { readAmountIn, readPrice, textKey } from './money.ts';
import { cleanText, identifier } from './nodes.ts';
import { type PageContext, pageContext } from './page.ts';
import { CONFIDENCE, chooseSingle, type DocumentReading, MAX_CANDIDATES } from './product.ts';
import { ogAvailabilityOf, ogConditionOf } from './vocab.ts';

function tagValues(ctx: PageContext, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const m of ctx.facts.metas) {
    if (!keys.includes(m.key)) continue;
    const v = m.content.trim();
    if (v !== '' && out.length < 50) out.push(v);
  }
  return out;
}

function first(ctx: PageContext, ...keys: string[]): string | null {
  return tagValues(ctx, ...keys)[0] ?? null;
}

export function readOpenGraph(request: ReadRequest, page: PageResponse): DocumentReading {
  return guarded('opengraph', () => {
    const ctx = pageContext(request, page);
    const amounts = tagValues(ctx, 'product:price:amount', 'og:price:amount');
    if (amounts.length === 0) return { outcome: { kind: 'not_applicable' }, unconfirmed: false };
    const sales = tagValues(ctx, 'product:sale_price:amount', 'og:sale_price:amount');
    const originals = tagValues(ctx, 'product:original_price:amount', 'og:original_price:amount');
    const c = CONFIDENCE.opengraph;

    const candidates = (selected: boolean): RawCandidate[] => {
      const out: RawCandidate[] = [];
      const push = (value: string, confidence: number) => {
        const v = value.slice(0, 256);
        if (out.length < MAX_CANDIDATES && !out.some((x) => x.value === v)) {
          out.push({ method: 'opengraph', confidence, value: v });
        }
      };
      for (const a of amounts) push(a, selected ? c.selected : c.other);
      for (const s of sales) push(s, c.other);
      for (const o of originals) push(o, c.reference);
      return out;
    };
    const fail = (reason: NoReadReason, detail: string, unconfirmed = false): DocumentReading => ({
      outcome: {
        kind: 'no_read',
        method: 'opengraph',
        reason,
        detail,
        candidates: candidates(false),
        fetch: null,
      },
      unconfirmed,
    });

    const currencies = [
      ...new Set(
        tagValues(ctx, 'product:price:currency', 'og:price:currency').map((x) => x.toUpperCase()),
      ),
    ];
    if (currencies.length > 1)
      return fail('multiple_prices', `prices in ${currencies.join(' and ')}`);
    const declared = currencies[0] ?? null;

    if (tagValues(ctx, 'og:type').some((t) => t.toLowerCase() === 'product.group')) {
      return fail('variant_not_found', 'a product.group page: several variants and none selected');
    }
    const skus = tagValues(ctx, 'product:retailer_item_id');
    const choice = chooseSingle(skus, ctx);
    if (choice.kind === 'refused')
      return fail('variant_not_found', choice.detail, choice.unconfirmed);

    const values = new Map<string, { currency: ListingCurrency; minor: number | null }>();
    const refusals: { reason: NoReadReason; detail: string }[] = [];
    for (const text of [...amounts, ...sales]) {
      const r = readPrice(text, declared, ctx);
      if (r.kind === 'amount')
        values.set(`${r.currency}:${r.minor}`, { currency: r.currency, minor: r.minor });
      else if (r.kind === 'unknown_currency')
        values.set(`?:${textKey(text)}`, { currency: 'unknown', minor: null });
      else refusals.push({ reason: r.reason, detail: r.detail });
    }
    const converted = refusals.find((r) => r.reason === 'converted_currency');
    if (converted !== undefined) return fail('converted_currency', converted.detail);
    if (values.size > 1)
      return fail('multiple_prices', `${values.size} distinct prices in the price tags`);
    if (values.size === 1 && refusals.length > 0) {
      return fail('multiple_prices', `a second price tag would not read: ${refusals[0]?.detail}`);
    }
    if (values.size === 0) {
      const r = refusals.find((x) => x.reason === 'multiple_prices') ?? refusals[0];
      return fail(r?.reason ?? 'unreadable_price', r?.detail ?? 'no price tag could be read');
    }
    const [value] = values.values();
    const currency = value?.currency ?? 'unknown';

    let referenceClaimed: number | null = null;
    const originalCurrency = first(
      ctx,
      'product:original_price:currency',
      'og:original_price:currency',
    );
    if (
      currency !== 'unknown' &&
      originals.length === 1 &&
      (originalCurrency === null || originalCurrency.toUpperCase() === currency)
    ) {
      referenceClaimed = readAmountIn(originals[0] as string, currency, ctx, false);
    }

    const read: ListingRead = {
      method: 'opengraph',
      rung: 'http',
      title: cleanText(first(ctx, 'og:title'), 500) ?? ctx.fallbackTitle,
      identifiers: {
        brand: cleanText(first(ctx, 'product:brand', 'og:brand'), 256),
        gtin: identifier(first(ctx, 'product:gtin', 'product:ean', 'product:upc', 'product:isbn')),
        mpn: identifier(first(ctx, 'product:mfr_part_no')),
        sku: identifier(skus.length === 1 ? (skus[0] as string) : null),
        externalId: choice.matchedId,
      },
      variant: {},
      condition: ogConditionOf(first(ctx, 'product:condition', 'og:condition')),
      currency,
      sticker: value?.minor ?? null,
      referenceClaimed,
      coupon: null,
      memberPrice: null,
      shipping: null,
      shippingStatus: 'unknown',
      taxIncluded: null,
      unitPrice: null,
      unit: null,
      availability: ogAvailabilityOf(first(ctx, 'product:availability', 'og:availability')),
      candidates: candidates(true),
    };
    return { outcome: { kind: 'read', read }, unconfirmed: false };
  });
}

export const openGraphReader: DocumentReader = {
  method: 'opengraph',
  read: (request, page) => readOpenGraph(request, page).outcome,
};
