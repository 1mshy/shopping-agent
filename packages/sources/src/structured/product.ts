// The schema.org Product reader shared by JSON-LD and microdata (S§5.2): main products → variant
// units → the unit the request selects → its one price, or a refusal with every figure kept.
//
// Variant coupling, as implemented (S§5.2; known failures: AliExpress multi-capacity prices, the
// cheapest-variant default, ProductGroup ranges):
//
// 0. Products. The top-level Product/ProductGroup nodes and a WebPage's mainEntity, minus the
//    variants of another product; when there are several, those whose url, @id or offer URL is
//    this page. With no product, top-level Offers stand for the page's product.
// 1. Units. A ProductGroup's `hasVariant` members are the units. Otherwise each Offer of a Product
//    is a unit (an AggregateOffer's nested offers count as Offers). An AggregateOffer with no
//    nested offers is a unit only when its bounds are one price (lowPrice equals highPrice, or
//    lowPrice alone with offerCount 1); otherwise it is a range, never selectable. Units that are
//    the same thing (same identity and same figures, e.g. a product emitted twice) are merged.
// 2. With a VariantSelector, a unit is chosen only when at least one selector field matches it
//    (variant id among the ids in its URLs, sku among its skus, every option equal) and none
//    contradicts it. A single unit with no variant data cannot be checked against the selector
//    unless the request URL itself names the selected variant and the page kept that URL.
// 3. Without a selector, the URL chooses: a unit whose own URL is this page with all of its query
//    parameters in the request URL (and no other unit shares that URL), or a unit whose sku or id
//    is the value of a variant parameter of the request URL (`?variant=`, `?sku=`, `?id=`). A
//    single unit is chosen when nothing in the URL names a variant, or when the URL names one, the
//    unit's own ids do not contradict it and the page came from a URL that still names it.
// 4. Anything else is `variant_not_found` (or `multiple_prices` when the units come from several
//    unrelated products on the page): a range, the first variant, the cheapest or the in-stock one
//    is never the answer.
// 5. The chosen units must state exactly one distinct price between them (Offer.price and every
//    non-reference priceSpecification price). Two distinct prices, a range, or a second figure that
//    would not read are `multiple_prices`.

import { resolveCurrency } from '@agentic-dasher/core';
import type {
  Availability,
  ListingCurrency,
  RawCandidate,
  ReadMethod,
  ShippingStatus,
} from '@agentic-dasher/shared';
import type {
  ListingRead,
  NoReadReason,
  ReaderOutcome,
  VariantSelector,
} from '../read/contract.ts';
import type { JsonValue } from './json.ts';
import { figureText, readAmountIn, readPrice, textKey } from './money.ts';
import {
  cleanText,
  hasType,
  type IdIndex,
  identifier,
  isNode,
  list,
  type Node,
  nameOf,
  OFFER_TYPES,
  PRODUCT_TYPES,
  prop,
  scalar,
  scalars,
  single,
  term,
} from './nodes.ts';
import type { PageContext } from './page.ts';
import { parseUrl, samePage, urlKey, variantHints, within } from './urls.ts';
import { availabilityOf, conditionOf } from './vocab.ts';

/** A document reader's outcome, and whether a variant refusal only means "no variant data here". */
export interface DocumentReading {
  readonly outcome: ReaderOutcome;
  /**
   * True for a `variant_not_found` that comes from the page carrying no variant data to check the
   * selector against (one offer, no ids, no options), not from variants that do not match. The
   * ladder lets a method that could check the selector decide (src/read/decide.ts).
   */
  readonly unconfirmed: boolean;
}

/** Confidence set by code (S§5.2, S§4.1 raw_candidates_json): by method and by what the figure is. */
export const CONFIDENCE: Readonly<
  Record<
    'json_ld' | 'microdata' | 'opengraph',
    { selected: number; other: number; reference: number }
  >
> = {
  json_ld: { selected: 0.9, other: 0.3, reference: 0.2 },
  microdata: { selected: 0.7, other: 0.25, reference: 0.15 },
  opengraph: { selected: 0.5, other: 0.2, reference: 0.1 },
};

/** Candidates kept per method: price_observation keeps at most 20 (packages/shared). */
export const MAX_CANDIDATES = 20;
const MAX_UNITS = 1000;
const MAX_VALUE = 256;

type StructuredMethod = 'json_ld' | 'microdata';

interface Slot {
  readonly raw: JsonValue | undefined;
  readonly declared: string | null;
}

interface OfferFacts {
  readonly node: Node;
  /** Sticker figures: Offer.price and non-reference priceSpecification prices. */
  readonly prices: readonly Slot[];
  /** An AggregateOffer's bounds when they are not one price. */
  readonly bounds: readonly Slot[];
  readonly references: readonly Slot[];
  readonly specs: readonly Node[];
  readonly declared: string | null;
}

interface Unit {
  readonly main: Node;
  readonly variant: Node | null;
  readonly itemOffered: Node | null;
  readonly offers: readonly OfferFacts[];
  readonly urls: readonly URL[];
  readonly skus: readonly string[];
  readonly ids: readonly string[];
  readonly options: Readonly<Record<string, string>>;
  /** An AggregateOffer range with no offer of its own: never selectable. */
  readonly rangeOnly: boolean;
  /** The main product's own identifiers describe this unit (it is the product's only offer). */
  readonly soleOfMain: boolean;
}

interface Loose {
  readonly slots: readonly Slot[];
  readonly references: readonly Slot[];
}

const REFERENCE_PRICE_TYPES = new Set(['strikethroughprice', 'listprice', 'msrp', 'srp']);
const IGNORED_PRICE_TYPES = new Set(['invoiceprice', 'minimumadvertisedprice']);
const OPTION_PROPS = ['color', 'size', 'material', 'pattern'];

export interface ProductInput {
  readonly method: StructuredMethod;
  readonly tops: readonly Node[];
  readonly index: IdIndex;
  readonly ctx: PageContext;
}

/** Reads the page's product from schema.org nodes. Never throws. */
export function readProducts(input: ProductInput): DocumentReading {
  const { method, ctx } = input;
  const mains = mainProducts(input);
  let units: Unit[] = [];
  const loose: Loose[] = [];
  if (mains.length === 0) {
    const bare = input.tops.filter((t) => hasType(t, ...OFFER_TYPES));
    if (bare.length === 0) return { outcome: { kind: 'not_applicable' }, unconfirmed: false };
    const pseudo: Node = Object.create(null);
    units = offerUnits(pseudo, bare, input, loose);
  } else {
    for (const main of mains) {
      if (units.length >= MAX_UNITS) break;
      units.push(...unitsOf(main, input, loose));
    }
  }
  units = dedupe(units).slice(0, MAX_UNITS);

  const fail = (reason: NoReadReason, detail: string, unconfirmed = false): DocumentReading => ({
    outcome: {
      kind: 'no_read',
      method,
      reason,
      detail,
      candidates: candidates(method, units, loose, []),
      fetch: null,
    },
    unconfirmed,
  });

  if (units.length === 0) return fail('no_price', 'the product states no offer and no price');
  const choice = choose(units, ctx);
  if (choice.kind === 'refused') return fail(choice.reason, choice.detail, choice.unconfirmed);
  return priced(method, choice.units, choice.matchedId, units, loose, ctx, fail);
}

// --- Products and units ---------------------------------------------------------------------

function isProduct(node: Node): boolean {
  return hasType(node, ...PRODUCT_TYPES);
}

/** Top-level products and the main entity of a WebPage, minus the variants of another product. */
function mainProducts({ tops, index, ctx }: ProductInput): Node[] {
  const found: Node[] = [];
  const add = (n: Node) => {
    if (isProduct(n) && !found.includes(n)) found.push(n);
  };
  for (const top of tops) {
    add(top);
    if (hasType(top, 'webpage', 'itempage'))
      for (const e of index.nodes(prop(top, 'mainEntity'), 20)) add(e);
  }
  const variants = new Set<Node>();
  for (const p of found) for (const v of index.nodes(prop(p, 'hasVariant'))) variants.add(v);
  let mains = found.filter((p) => !variants.has(p));
  if (mains.length > 1) {
    const here = [ctx.page.finalUrl, ctx.request.url];
    const matched = mains.filter((m) =>
      identityUrls(m, index, ctx).some((u) => here.some((h) => samePage(u, h))),
    );
    if (matched.length > 0) mains = matched;
  }
  return mains;
}

function identityUrls(node: Node, index: IdIndex, ctx: PageContext): URL[] {
  const raw = [...scalars(prop(node, 'url'), 10), ...scalars(prop(node, '@id'), 2)];
  for (const o of index.nodes(prop(node, 'offers'), 50)) raw.push(...scalars(prop(o, 'url'), 5));
  const out: URL[] = [];
  for (const r of raw) {
    const u = parseUrl(r, ctx.page.finalUrl);
    if (u !== null && !out.some((x) => x.href === u.href)) out.push(u);
  }
  return out;
}

function offersOf(node: Node, index: IdIndex): Node[] {
  return index
    .nodes(prop(node, 'offers'))
    .filter(
      (o) =>
        hasType(o, ...OFFER_TYPES) ||
        (o['@type'] === undefined &&
          ['price', 'lowPrice', 'highPrice', 'priceSpecification', 'availability'].some(
            (k) => k in o,
          )),
    );
}

function hasOwnPrice(node: Node): boolean {
  return ['price', 'lowPrice', 'highPrice', 'priceSpecification'].some((k) =>
    Object.hasOwn(node, k),
  );
}

function unitsOf(main: Node, input: ProductInput, loose: Loose[]): Unit[] {
  const { index } = input;
  const variants = index.nodes(prop(main, 'hasVariant'));
  if (variants.length > 0) {
    // The group's own offers (usually an AggregateOffer range) are figures, never a variant's price.
    const groupOffers = offersOf(main, index).map((o) => offerFacts(o, input));
    loose.push({
      slots: groupOffers.flatMap((o) => [...o.prices, ...o.bounds]),
      references: groupOffers.flatMap((o) => o.references),
    });
    return variants.map((v) => variantUnit(main, v, input, loose));
  }
  const offers = offersOf(main, index);
  if (offers.length === 0) return hasOwnPrice(main) ? offerUnits(main, [main], input, loose) : [];
  return offerUnits(main, offers, input, loose);
}

/** Offers of a product as units, an AggregateOffer's nested offers in its place. */
function offerUnits(
  main: Node,
  offers: readonly Node[],
  input: ProductInput,
  loose: Loose[],
): Unit[] {
  const flat: Node[] = [];
  for (const o of offers) {
    const nested = hasType(o, 'aggregateoffer') ? offersOf(o, input.index) : [];
    if (nested.length > 0) {
      const facts = offerFacts(o, input);
      loose.push({ slots: [...facts.prices, ...facts.bounds], references: facts.references });
      flat.push(...nested);
    } else {
      flat.push(o);
    }
  }
  const sole = flat.length === 1;
  return flat.map((o) => {
    const facts = offerFacts(o, input);
    const item = input.index.nodes(prop(o, 'itemOffered'), 5).find((n) => n !== main) ?? null;
    const urls = urlsOf([o, ...(item === null ? [] : [item])], input.ctx);
    const skus = [...scalars(prop(o, 'sku')), ...(item === null ? [] : scalars(prop(item, 'sku')))];
    if (sole) skus.push(...scalars(prop(main, 'sku')));
    return {
      main,
      variant: null,
      itemOffered: item,
      offers: [facts],
      urls,
      skus: distinct(skus),
      ids: distinct(urls.flatMap((u) => variantHints(u))),
      options: item === null ? {} : optionsOf(item, main),
      rangeOnly: facts.bounds.length > 0 && facts.prices.length === 0,
      soleOfMain: sole,
    };
  });
}

function variantUnit(main: Node, variant: Node, input: ProductInput, loose: Loose[]): Unit {
  const { index } = input;
  const offers: OfferFacts[] = [];
  const own = offersOf(variant, index);
  const raw = own.length === 0 && hasOwnPrice(variant) ? [variant] : own;
  for (const o of raw) {
    const nested = hasType(o, 'aggregateoffer') ? offersOf(o, index) : [];
    if (nested.length > 0) {
      const facts = offerFacts(o, input);
      loose.push({ slots: [...facts.prices, ...facts.bounds], references: facts.references });
      for (const n of nested) offers.push(offerFacts(n, input));
    } else {
      offers.push(offerFacts(o, input));
    }
  }
  const urls = urlsOf([variant, ...raw], input.ctx);
  const skus = [...scalars(prop(variant, 'sku')), ...raw.flatMap((o) => scalars(prop(o, 'sku')))];
  return {
    main,
    variant,
    itemOffered: null,
    offers,
    urls,
    skus: distinct(skus),
    ids: distinct(urls.flatMap((u) => variantHints(u))),
    options: optionsOf(variant, main),
    rangeOnly: false,
    soleOfMain: false,
  };
}

function urlsOf(nodes: readonly Node[], ctx: PageContext): URL[] {
  const out: URL[] = [];
  for (const n of nodes) {
    for (const r of [...scalars(prop(n, 'url'), 5), ...scalars(prop(n, '@id'), 2)]) {
      const u = parseUrl(r, ctx.page.finalUrl);
      if (u !== null && !out.some((x) => x.href === u.href)) out.push(u);
    }
  }
  return out;
}

function optionsOf(node: Node, main: Node): Record<string, string> {
  const names = [...OPTION_PROPS];
  for (const v of scalars(prop(main, 'variesBy'), 10)) {
    const name = v.slice(Math.max(v.lastIndexOf('/'), v.lastIndexOf(':')) + 1);
    if (/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name) && !names.includes(name)) names.push(name);
  }
  const out: Record<string, string> = {};
  for (const name of names) {
    const v = cleanText(single(prop(node, name)) ?? nameOf(prop(node, name)), 200);
    if (v !== null) out[name] = v;
  }
  for (const pv of list(prop(node, 'additionalProperty'), 20)) {
    if (!isNode(pv)) continue;
    const name = cleanText(single(prop(pv, 'name')), 100);
    const value = cleanText(single(prop(pv, 'value')), 200);
    if (name !== null && value !== null && Object.keys(out).length < 20) out[name] = value;
  }
  return out;
}

function offerFacts(o: Node, input: ProductInput): OfferFacts {
  const specs = input.index.nodes(prop(o, 'priceSpecification'), 20);
  const declared =
    single(prop(o, 'priceCurrency')) ??
    specs.map((s) => single(prop(s, 'priceCurrency'))).find((c) => c !== null) ??
    input.ctx.pageCurrency;
  const prices: Slot[] = [];
  const bounds: Slot[] = [];
  const references: Slot[] = [];
  // A price given as a list (microdata with two price props, `"price": [249, 299]`) is several
  // figures, one slot each, so they are compared and refused as several prices.
  for (const raw of list(prop(o, 'price'), 20)) prices.push({ raw, declared });
  for (const spec of specs) {
    const type = single(prop(spec, 'priceType'));
    const kind = type === null ? null : term(type);
    const specDeclared = single(prop(spec, 'priceCurrency')) ?? declared;
    if (kind !== null && REFERENCE_PRICE_TYPES.has(kind)) {
      for (const raw of list(prop(spec, 'price'), 20))
        references.push({ raw, declared: specDeclared });
      continue;
    }
    // A minimum advertised or invoice price is not what the buyer pays; a price per reference
    // quantity is a unit price (its own field, not read here).
    if (kind !== null && IGNORED_PRICE_TYPES.has(kind)) continue;
    if (Object.hasOwn(spec, 'referenceQuantity')) continue;
    if (Object.hasOwn(spec, 'price')) {
      for (const raw of list(prop(spec, 'price'), 20)) prices.push({ raw, declared: specDeclared });
    } else {
      for (const k of ['minPrice', 'maxPrice']) {
        if (Object.hasOwn(spec, k)) prices.push({ raw: spec[k], declared: specDeclared });
      }
    }
  }
  const low = prop(o, 'lowPrice');
  const high = prop(o, 'highPrice');
  if (low !== undefined || high !== undefined) {
    const count = scalar(prop(o, 'offerCount'));
    const onePrice =
      low !== undefined && (high !== undefined ? sameFigure(low, high) : count === '1');
    if (onePrice) prices.push({ raw: low, declared });
    else {
      if (low !== undefined) bounds.push({ raw: low, declared });
      if (high !== undefined) bounds.push({ raw: high, declared });
    }
  }
  return { node: o, prices, bounds, references, specs, declared };
}

function canonical(text: string): string {
  const m = /^0*(\d+?)(?:\.(\d*?)0*)?$/.exec(text);
  if (m === null) return text;
  return m[2] ? `${m[1]}.${m[2]}` : (m[1] as string);
}

function sameFigure(a: JsonValue, b: JsonValue): boolean {
  const x = figureText(a);
  const y = figureText(b);
  return x.kind === 'text' && y.kind === 'text' && canonical(x.text) === canonical(y.text);
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function unitKey(u: Unit): string {
  const figures = u.offers.map((o) =>
    [...o.prices, ...o.bounds].map((s) => `${slotText(s)}|${s.declared ?? ''}`).join(','),
  );
  return JSON.stringify([
    [u.variant, u.itemOffered].map((n) => (n === null ? null : single(prop(n, 'name')))),
    u.urls.map(urlKey).sort(),
    [...u.skus].sort(),
    [...u.ids].sort(),
    Object.entries(u.options).sort(),
    figures,
    u.rangeOnly,
  ]);
}

function dedupe(units: readonly Unit[]): Unit[] {
  const seen = new Set<string>();
  const out: Unit[] = [];
  for (const u of units) {
    const key = unitKey(u);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}

// --- Choosing the unit (variant coupling) ------------------------------------------------------

type Choice =
  | { readonly kind: 'chosen'; readonly units: readonly Unit[]; readonly matchedId: string | null }
  | {
      readonly kind: 'refused';
      readonly reason: 'variant_not_found' | 'multiple_prices';
      readonly detail: string;
      readonly unconfirmed: boolean;
    };

type Match = 'match' | 'mismatch' | 'unknown';

function hasSelector(sel: VariantSelector | null): sel is VariantSelector {
  return (
    sel !== null &&
    (sel.variantId !== undefined ||
      sel.sku !== undefined ||
      (sel.options !== undefined && Object.keys(sel.options).length > 0))
  );
}

const lower = (s: string) => s.trim().toLowerCase();

function matchSelector(
  u: Unit,
  sel: VariantSelector,
  alone: boolean,
  hints: readonly string[],
  pageKept: boolean,
): Match {
  let matched = false;
  if (sel.variantId !== undefined) {
    const id = sel.variantId.trim();
    if (u.ids.includes(id)) matched = true;
    else if (u.ids.length > 0) return 'mismatch';
    else if (alone && hints.length > 0) {
      if (!hints.includes(id)) return 'mismatch';
      if (pageKept) matched = true;
    }
  }
  if (sel.sku !== undefined) {
    const sku = lower(sel.sku);
    if (u.skus.some((s) => lower(s) === sku)) matched = true;
    else if (u.skus.length > 0) return 'mismatch';
    else if (alone && pageKept && hints.some((h) => lower(h) === sku)) matched = true;
  }
  if (sel.options !== undefined && Object.keys(sel.options).length > 0) {
    let all = true;
    for (const [name, value] of Object.entries(sel.options)) {
      const key = Object.keys(u.options).find((k) => lower(k) === lower(name));
      if (key === undefined) all = false;
      else if (lower(u.options[key] ?? '') !== lower(value)) return 'mismatch';
    }
    if (all) matched = true;
  }
  return matched ? 'match' : 'unknown';
}

function selectedByUrl(
  u: Unit,
  target: URL,
  units: readonly Unit[],
  hints: readonly string[],
): boolean {
  for (const url of u.urls) {
    if (!within(url, target)) continue;
    const key = urlKey(url);
    if (!units.some((o) => o !== u && o.urls.some((x) => urlKey(x) === key))) return true;
  }
  return hints.some((h) => u.skus.includes(h) || u.ids.includes(h));
}

function choose(units: readonly Unit[], ctx: PageContext): Choice {
  const target = parseUrl(ctx.request.url, '');
  const final = parseUrl(ctx.page.finalUrl, ctx.request.url);
  const hints = variantHints(target);
  const finalHints = variantHints(final);
  const pageKept = hints.every((h) => finalHints.includes(h));
  const alone = units.length === 1 && units[0]?.rangeOnly === false;
  const sel = ctx.request.variant;
  const onlyRanges = units.every((u) => u.rangeOnly);
  const RANGE_ONLY = 'only a price range: no variant is priced on its own';

  if (hasSelector(sel)) {
    const results = units.map((u) =>
      u.rangeOnly ? 'unknown' : matchSelector(u, sel, alone, hints, pageKept),
    );
    const chosen = units.filter((_, i) => results[i] === 'match');
    if (chosen.length > 0) {
      const id = sel.variantId?.trim();
      return {
        kind: 'chosen',
        units: chosen,
        matchedId: id !== undefined && chosen.every((u) => u.ids.includes(id)) ? id : null,
      };
    }
    const unconfirmed = alone && results[0] === 'unknown';
    return {
      kind: 'refused',
      reason: 'variant_not_found',
      detail: unconfirmed
        ? 'the page carries no variant data to check the selector against'
        : onlyRanges
          ? RANGE_ONLY
          : `the selector names none of the ${units.length} variant(s) here`,
      unconfirmed,
    };
  }

  if (target !== null) {
    const byUrl = units.filter((u) => !u.rangeOnly && selectedByUrl(u, target, units, hints));
    if (byUrl.length > 0) return { kind: 'chosen', units: byUrl, matchedId: null };
  }
  if (alone) {
    const u = units[0] as Unit;
    if (hints.length > 0) {
      if (u.ids.length > 0 && !hints.some((h) => u.ids.includes(h) || u.skus.includes(h))) {
        return {
          kind: 'refused',
          reason: 'variant_not_found',
          detail: 'the URL names a variant the page does not offer',
          unconfirmed: false,
        };
      }
      if (!pageKept) {
        return {
          kind: 'refused',
          reason: 'variant_not_found',
          detail: 'the URL names a variant, the page came from a URL that does not',
          unconfirmed: false,
        };
      }
    }
    return { kind: 'chosen', units: [u], matchedId: null };
  }
  const products = new Set(units.map((u) => u.main));
  return products.size > 1
    ? {
        kind: 'refused',
        reason: 'multiple_prices',
        detail: `${products.size} products on the page and none is this one`,
        unconfirmed: false,
      }
    : {
        kind: 'refused',
        reason: 'variant_not_found',
        detail: onlyRanges
          ? RANGE_ONLY
          : `${units.length} variants or offers and none selected by the request or its URL`,
        unconfirmed: false,
      };
}

/**
 * Variant coupling for a method whose data describes one priced thing and no variants (OpenGraph):
 * the same rules as a single unit with only the given skus.
 */
export function chooseSingle(
  skus: readonly string[],
  ctx: PageContext,
):
  | { readonly kind: 'chosen'; readonly matchedId: string | null }
  | { readonly kind: 'refused'; readonly detail: string; readonly unconfirmed: boolean } {
  const unit: Unit = {
    main: Object.create(null),
    variant: null,
    itemOffered: null,
    offers: [],
    urls: [],
    skus,
    ids: [],
    options: {},
    rangeOnly: false,
    soleOfMain: true,
  };
  const choice = choose([unit], ctx);
  return choice.kind === 'chosen'
    ? { kind: 'chosen', matchedId: choice.matchedId }
    : { kind: 'refused', detail: choice.detail, unconfirmed: choice.unconfirmed };
}

// --- Pricing the chosen unit -----------------------------------------------------------------

function slotText(slot: Slot): string | null {
  const f = figureText(slot.raw);
  return f.kind === 'text' ? f.text : f.kind === 'invalid' ? f.shown : null;
}

function priced(
  method: StructuredMethod,
  chosen: readonly Unit[],
  matchedId: string | null,
  units: readonly Unit[],
  loose: readonly Loose[],
  ctx: PageContext,
  fail: (reason: NoReadReason, detail: string) => DocumentReading,
): DocumentReading {
  const values = new Map<string, { currency: ListingCurrency; minor: number | null }>();
  const refusals: { reason: NoReadReason; detail: string }[] = [];
  const texts: string[] = [];
  let range = false;
  for (const u of chosen) {
    for (const o of u.offers) {
      if (o.bounds.length > 0) range = true;
      for (const slot of o.prices) {
        const f = figureText(slot.raw);
        if (f.kind === 'none') continue;
        if (f.kind === 'invalid') {
          refusals.push({ reason: 'unreadable_price', detail: 'a price that is not a figure' });
          continue;
        }
        texts.push(f.text);
        const r = readPrice(f.text, slot.declared, ctx);
        if (r.kind === 'amount')
          values.set(`${r.currency}:${r.minor}`, { currency: r.currency, minor: r.minor });
        else if (r.kind === 'unknown_currency')
          values.set(`?:${textKey(f.text)}`, { currency: 'unknown', minor: null });
        else refusals.push({ reason: r.reason, detail: r.detail });
      }
    }
  }
  const converted = refusals.find((r) => r.reason === 'converted_currency');
  if (converted !== undefined) return fail('converted_currency', converted.detail);
  if (range) return fail('multiple_prices', 'the selected variant states a price range');
  if (values.size > 1)
    return fail('multiple_prices', `${values.size} distinct prices for the selected variant`);
  if (values.size === 1 && refusals.length > 0) {
    return fail(
      'multiple_prices',
      `a second figure for the selected variant would not read: ${refusals[0]?.detail}`,
    );
  }
  const availability = availabilityAcross(chosen);
  const first = chosen[0] as Unit;
  const offer = first.offers[0];
  let currency: ListingCurrency;
  let sticker: number | null;
  if (values.size === 0) {
    const multiple = refusals.find((r) => r.reason === 'multiple_prices');
    if (multiple !== undefined) return fail('multiple_prices', multiple.detail);
    if (refusals.length > 0)
      return fail(refusals[0]?.reason ?? 'unreadable_price', refusals[0]?.detail ?? '');
    if (availability !== 'out') {
      return fail(
        'no_price',
        first.offers.length === 0
          ? 'the selected variant carries no offer'
          : 'the offer states no price',
      );
    }
    // Out of stock with no price: a read (S§4.1: a row may be out of stock with no sticker).
    const resolved = resolveCurrency({
      host: ctx.host,
      platform: null,
      priceCurrency: offer?.declared ?? null,
      locale: ctx.currencyLocale,
      storeCountry: ctx.storeCountry,
      priceText: null,
    });
    currency = resolved.ok ? resolved.currency : 'unknown';
    sticker = null;
  } else {
    const [value] = values.values();
    currency = value?.currency ?? 'unknown';
    sticker = value?.minor ?? null;
  }

  const shipping =
    offer === undefined
      ? { amount: null, status: 'unknown' as const }
      : shippingOf(offer.node, currency, ctx);
  const read: ListingRead = {
    method,
    rung: 'http',
    title: titleOf(first, ctx),
    identifiers: identifiersOf(first, matchedId),
    variant: first.options,
    condition: conditionOf(
      single(prop(offer?.node ?? first.main, 'itemCondition')) ??
        (first.variant === null ? null : single(prop(first.variant, 'itemCondition'))) ??
        single(prop(first.main, 'itemCondition')),
    ),
    currency,
    sticker,
    referenceClaimed: offer === undefined ? null : referenceOf(offer, currency, ctx),
    coupon: null,
    memberPrice: null,
    shipping: shipping.amount,
    shippingStatus: shipping.status,
    taxIncluded: offer === undefined ? null : taxIncludedOf(offer),
    unitPrice: null,
    unit: null,
    availability,
    candidates: candidates(method, units, loose, texts),
  };
  return { outcome: { kind: 'read', read }, unconfirmed: false };
}

function availabilityAcross(chosen: readonly Unit[]): Availability {
  const seen = new Set<Availability>();
  for (const u of chosen) {
    for (const o of u.offers) {
      const stated = single(prop(o.node, 'availability'));
      if (stated !== null) seen.add(availabilityOf(stated));
    }
  }
  return seen.size === 1 ? ([...seen][0] as Availability) : 'unknown';
}

function titleOf(u: Unit, ctx: PageContext): string | null {
  for (const n of [u.variant, u.itemOffered, u.main]) {
    if (n === null) continue;
    const t = cleanText(single(prop(n, 'name')), 500);
    if (t !== null) return t;
  }
  return ctx.fallbackTitle;
}

const GTIN_KEYS = ['gtin14', 'gtin13', 'gtin12', 'gtin8', 'gtin'];

function identifiersOf(u: Unit, matchedId: string | null): ListingRead['identifiers'] {
  // Most specific first: the offer, the variant or item offered, then the product when it is this
  // unit's own (its only offer). A ProductGroup's identifiers are never a variant's.
  const offer = u.offers[0]?.node ?? null;
  const layers = [offer, u.variant, u.itemOffered, u.soleOfMain ? u.main : null].filter(
    (n): n is Node => n !== null,
  );
  const first = (keys: readonly string[]): string | null => {
    for (const n of layers)
      for (const k of keys) {
        const v = identifier(single(prop(n, k)));
        if (v !== null) return v;
      }
    return null;
  };
  const brandLayers = [u.variant, u.itemOffered, u.main].filter((n): n is Node => n !== null);
  let brand: string | null = null;
  for (const n of brandLayers) {
    brand = cleanText(nameOf(prop(n, 'brand')), 256);
    if (brand !== null) break;
  }
  return {
    brand,
    gtin: first(GTIN_KEYS),
    mpn: first(['mpn']),
    sku: first(['sku']),
    externalId: matchedId ?? (u.ids.length === 1 ? (u.ids[0] as string) : null),
  };
}

function referenceOf(
  offer: OfferFacts,
  currency: ListingCurrency,
  ctx: PageContext,
): number | null {
  if (currency === 'unknown') return null;
  const found = new Set<number>();
  for (const slot of offer.references) {
    if (slot.declared !== null && slot.declared.trim().toUpperCase() !== currency) return null;
    const f = figureText(slot.raw);
    if (f.kind !== 'text') continue;
    const amount = readAmountIn(f.text, currency, ctx, false);
    if (amount !== null) found.add(amount);
  }
  return found.size === 1 ? ([...found][0] as number) : null;
}

function taxIncludedOf(offer: OfferFacts): boolean | null {
  const seen = new Set<boolean>();
  for (const spec of offer.specs) {
    const v = prop(spec, 'valueAddedTaxIncluded');
    if (v === true || v === 'true' || v === 'True') seen.add(true);
    else if (v === false || v === 'false' || v === 'False') seen.add(false);
  }
  return seen.size === 1 ? ([...seen][0] as boolean) : null;
}

function countriesOf(dest: Node): string[] {
  const out: string[] = [];
  for (const c of list(prop(dest, 'addressCountry'), 300)) {
    const code = isNode(c) ? (single(prop(c, 'identifier')) ?? single(prop(c, 'name'))) : scalar(c);
    if (code !== null) out.push(code.trim().toUpperCase());
  }
  return out;
}

const RESTRICTIONS = [
  'addressRegion',
  'postalCode',
  'postalCodeRange',
  'postalCodePrefix',
  'geoMidpoint',
];

/** Shipping only when an OfferShippingDetails states one amount for the user's country. */
function shippingOf(
  node: Node,
  currency: ListingCurrency,
  ctx: PageContext,
): { amount: number | null; status: ShippingStatus } {
  const unknown = { amount: null, status: 'unknown' as const };
  if (currency === 'unknown') return unknown;
  const country = ctx.request.market.country.toUpperCase();
  const details = list(prop(node, 'shippingDetails'), 50).filter(isNode);
  const matching: { detail: Node; restricted: boolean }[] = [];
  for (const d of details) {
    const dests = list(prop(d, 'shippingDestination'), 50).filter(isNode);
    const here = dests.filter((dest) => countriesOf(dest).includes(country));
    if (here.length === 0) continue;
    matching.push({
      detail: d,
      restricted: here.every((dest) => RESTRICTIONS.some((k) => Object.hasOwn(dest, k))),
    });
  }
  if (matching.length === 0) return unknown;
  if (matching.some((m) => m.restricted)) return { amount: null, status: 'conditional' };
  if (matching.length !== 1) return unknown;
  const detail = (matching[0] as { detail: Node }).detail;
  const dns = prop(detail, 'doesNotShip');
  if (dns === true || dns === 'true') return unknown;
  const rates = list(prop(detail, 'shippingRate'), 5).filter(isNode);
  if (rates.length !== 1) return unknown;
  const rate = rates[0] as Node;
  const rateCurrency = single(prop(rate, 'currency'));
  if (rateCurrency === null || rateCurrency.toUpperCase() !== currency) return unknown;
  const f = figureText(prop(rate, 'value'));
  if (f.kind !== 'text') return unknown;
  const amount = readAmountIn(f.text, currency, ctx, true);
  return amount === null ? unknown : { amount, status: 'known' };
}

// --- Candidates --------------------------------------------------------------------------------

function candidates(
  method: StructuredMethod,
  units: readonly Unit[],
  loose: readonly Loose[],
  selected: readonly string[],
): RawCandidate[] {
  const c = CONFIDENCE[method];
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const push = (text: string | null, confidence: number) => {
    if (text === null || out.length >= MAX_CANDIDATES) return;
    const value = text.length > MAX_VALUE ? text.slice(0, MAX_VALUE) : text;
    if (value === '' || seen.has(value)) return;
    seen.add(value);
    out.push({ method: method as ReadMethod, confidence, value });
  };
  for (const t of selected) push(t, c.selected);
  for (const u of units) {
    for (const o of u.offers) {
      for (const s of [...o.prices, ...o.bounds]) push(slotText(s), c.other);
      for (const s of o.references) push(slotText(s), c.reference);
    }
  }
  for (const l of loose) {
    for (const s of l.slots) push(slotText(s), c.other);
    for (const s of l.references) push(slotText(s), c.reference);
  }
  return out;
}
