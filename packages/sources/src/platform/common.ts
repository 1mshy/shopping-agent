// What the three platform readers share: outcome builders, the fetch rule, exact amounts from
// digit strings, candidates, currency through `resolveCurrency`, and variant-selector helpers.
// Every amount is read from text (digits as written) and goes through `moneyFromDecimal`; no
// float touches a price (S§2.2).
import { moneyFromDecimal, resolveCurrency } from '@agentic-dasher/core';
import type { PageResponse, PageResult } from '@agentic-dasher/fetch';
import {
  type Availability,
  type ListingCurrency,
  type MinorUnitCurrency,
  type RawCandidate,
  UNKNOWN_CURRENCY,
} from '@agentic-dasher/shared';
import type {
  ListingRead,
  NoReadReason,
  ReaderOutcome,
  ReadIdentifiers,
  ReadRequest,
  VariantSelector,
} from '../read/contract.ts';
import { type JsonParse, parseJson } from './json.ts';

export const PLATFORM_METHOD = 'platform_json' as const;

/**
 * Candidate confidences, set by code (S§5.2): the selected variant's own price, a claimed "was"
 * price beside it, and figures of variants that were not selected (kept for the record only).
 */
export const CONFIDENCE = { sticker: 0.95, reference: 0.6, other: 0.2 } as const;

/** A price observation keeps at most 20 raw candidates (packages/shared `PriceObservation`). */
export const MAX_CANDIDATES = 20;
const MAX_CANDIDATE_TEXT = 256;
/** Code-written details are cut to this length. */
const MAX_DETAIL = 300;

export function notApplicable(): ReaderOutcome {
  return { kind: 'not_applicable' };
}

export function noRead(
  reason: Exclude<NoReadReason, 'fetch_failed'>,
  detail: string,
  candidates: readonly RawCandidate[],
): ReaderOutcome {
  return {
    kind: 'no_read',
    method: PLATFORM_METHOD,
    reason,
    detail: clip(detail, MAX_DETAIL),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    fetch: null,
  };
}

function fetchFailed(outcome: PageResult['outcome'], detail: string): ReaderOutcome {
  return {
    kind: 'no_read',
    method: PLATFORM_METHOD,
    reason: 'fetch_failed',
    detail: clip(detail, MAX_DETAIL),
    candidates: [],
    fetch: outcome,
  };
}

export type Fetched =
  | { readonly ok: true; readonly response: PageResponse }
  | { readonly ok: false; readonly outcome: ReaderOutcome };

/**
 * The fetch rule for a reader's own request. `ok` with a response is read. A 404 or 410
 * (`not_found`) on the reader's *first* request, the platform endpoint itself, is
 * `not_applicable`: the host is not this platform, or this is not one of its products. Anything
 * else that is not `ok` is `fetch_failed`, carrying the fetch outcome untouched. A follow-up
 * request (a variation, `/cart.js`) passes `first: false`: its 404 is a failure, not a verdict on
 * the platform.
 */
export function fetched(result: PageResult, what: string, first: boolean): Fetched {
  const { outcome, response } = result;
  if (outcome.kind === 'ok' && response !== null) return { ok: true, response };
  if (first && outcome.kind === 'not_found') return { ok: false, outcome: notApplicable() };
  return { ok: false, outcome: fetchFailed(outcome, `${what}: ${outcome.kind}`) };
}

/** Calls `context.get` and never lets it throw: a thrown error is a network failure. */
export async function safeGet(
  get: () => Promise<PageResult>,
): Promise<PageResult | { readonly thrown: true }> {
  try {
    return await get();
  } catch {
    return { thrown: true };
  }
}

export function thrownFailure(what: string): ReaderOutcome {
  return fetchFailed({ kind: 'network_error', rung: 'api', code: 'READER_GET_THREW' }, what);
}

/** The response body as JSON, or a refusal (HTML, truncated JSON, an oversize body). */
export function readJson(response: PageResponse): JsonParse {
  let text: string;
  try {
    text = response.text;
  } catch {
    return { ok: false, error: 'the body could not be read' };
  }
  return parseJson(text);
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A raw candidate: the figure as text with where it came from, cut to the schema's bound. */
export function candidate(value: string, confidence: number): RawCandidate {
  const text = clip(value.replace(/\s+/g, ' ').trim(), MAX_CANDIDATE_TEXT);
  return { method: PLATFORM_METHOD, confidence, value: text === '' ? '?' : text };
}

/** Collects candidates up to the cap, without duplicates. */
export class Candidates {
  readonly #items: RawCandidate[] = [];
  readonly #seen = new Set<string>();

  add(value: string, confidence: number): void {
    if (this.#items.length >= MAX_CANDIDATES) return;
    const item = candidate(value, confidence);
    if (this.#seen.has(item.value)) return;
    this.#seen.add(item.value);
    this.#items.push(item);
  }

  get list(): readonly RawCandidate[] {
    return [...this.#items];
  }
}

/** A canonical decimal from a string of digits and a scale: ("1105", 2) is "11.05". */
export function decimalFromScaled(digits: string, scale: number): string | null {
  if (!/^[0-9]{1,30}$/.test(digits) || !Number.isInteger(scale) || scale < 0 || scale > 6) {
    return null;
  }
  const stripped = digits.replace(/^0+(?=[0-9])/, '');
  if (scale === 0) return stripped;
  const padded = stripped.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

export type Amount =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly detail: string };

/** A canonical decimal as minor units of the currency, through `moneyFromDecimal`; never rounded. */
export function amountOf(decimal: string | null, currency: MinorUnitCurrency): Amount {
  if (decimal === null) return { ok: false, detail: 'not a plain decimal' };
  const money = moneyFromDecimal(decimal, currency);
  if (!money.ok) return { ok: false, detail: `${money.refusal.code}: ${money.refusal.detail}` };
  if (money.value.amountMinor < 0) return { ok: false, detail: 'a negative price' };
  return { ok: true, minor: money.value.amountMinor };
}

export type PlatformCurrency =
  | { readonly ok: true; readonly currency: MinorUnitCurrency }
  | { readonly ok: false; readonly detail: string };

/**
 * The currency a platform states, resolved by `resolveCurrency` as a platform answer and nothing
 * else: no locale, no ccTLD, no store country is given to it, so with no statement there is no
 * currency (S§2.2), never a guess from the host.
 */
export function platformCurrency(host: string, stated: string | null): PlatformCurrency {
  if (stated === null || stated.trim() === '') {
    return { ok: false, detail: 'the platform states no currency' };
  }
  const resolved = resolveCurrency({
    host,
    platform: stated,
    priceCurrency: null,
    locale: null,
    storeCountry: null,
    priceText: null,
  });
  if (!resolved.ok) return { ok: false, detail: resolved.refusal.detail };
  if (resolved.source !== 'platform') {
    return { ok: false, detail: `resolved from ${resolved.source}, not the platform` };
  }
  return { ok: true, currency: resolved.currency };
}

/** Trimmed, single-spaced text cut to `max`, or null when there is none. */
export function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/** Comparison of names and values as stores write them: case, width and spacing ignored. */
export function sameText(a: string, b: string): boolean {
  return a.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase();
}

/** The variant record of a read: names and values cleaned and bounded as `listing.variant` is. */
export function variantRecord(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  const record: Record<string, string> = {};
  for (const [name, value] of entries) {
    const key = cleanText(name, 100);
    const text = cleanText(value, 200);
    if (key !== null && text !== null && !Object.hasOwn(record, key)) record[key] = text;
  }
  return record;
}

export function selectorIsEmpty(selector: VariantSelector | null): boolean {
  if (selector === null) return true;
  const options = selector.options ?? {};
  return (
    (selector.variantId === undefined || selector.variantId.trim() === '') &&
    (selector.sku === undefined || selector.sku.trim() === '') &&
    Object.keys(options).length === 0
  );
}

/** The selector's option pairs, cleaned; empty names or values are dropped. */
export function selectorOptions(selector: VariantSelector | null): readonly [string, string][] {
  const out: [string, string][] = [];
  const options = selector?.options;
  if (options === undefined || options === null) return out;
  for (const name of Object.keys(options)) {
    const value = options[name];
    if (typeof value === 'string' && name.trim() !== '' && value.trim() !== '') {
      out.push([name, value]);
    }
  }
  return out;
}

/** What variant selection needs to know of one variant. */
export interface VariantView {
  /** The platform's variant id as text, or null. */
  readonly id: string | null;
  readonly sku: string | null;
  /** True when this variant has the option `name` with the value `value`, as the store writes them. */
  matchesOption(name: string, value: string): boolean;
}

/** What the URL itself selects, when the selector is empty. */
export interface UrlChoice {
  readonly id?: string | null;
  readonly options?: readonly (readonly [string, string])[];
}

export type Selection =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly detail: string };

function matchesAll(
  view: VariantView,
  id: string | null,
  sku: string | null,
  options: readonly (readonly [string, string])[],
): boolean {
  if (id !== null && view.id !== id) return false;
  if (sku !== null && (view.sku === null || !sameText(view.sku, sku))) return false;
  return options.every(([name, value]) => view.matchesOption(name, value));
}

function pick(
  views: readonly VariantView[],
  id: string | null,
  sku: string | null,
  options: readonly (readonly [string, string])[],
  who: string,
): Selection {
  let found = -1;
  let count = 0;
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    if (view !== undefined && matchesAll(view, id, sku, options)) {
      count++;
      if (found === -1) found = i;
    }
  }
  if (count === 1) return { ok: true, index: found };
  return {
    ok: false,
    detail:
      count === 0
        ? `${who} names no variant of the ${views.length} here`
        : `${who} matches ${count} of the ${views.length} variants`,
  };
}

/**
 * Variant coupling (S§5.2): the price belongs to exactly one variant. The caller's selector wins;
 * with no selector, what the URL selects; with neither, a product with one variant needs no
 * choice, and several variants with none selected is `variant_not_found`. Never the first, the
 * cheapest or the available one by default. Every field given must match the same variant.
 */
export function selectVariant(
  views: readonly VariantView[],
  selector: VariantSelector | null,
  url: UrlChoice | null,
): Selection {
  if (!selectorIsEmpty(selector)) {
    const id = selector?.variantId?.trim() || null;
    const sku = selector?.sku?.trim() || null;
    return pick(views, id, sku, selectorOptions(selector), 'the selector');
  }
  const urlId = url?.id?.trim() || null;
  const urlOptions = url?.options ?? [];
  if (urlId !== null || urlOptions.length > 0) {
    return pick(views, urlId, null, urlOptions, 'the URL');
  }
  if (views.length === 1) return { ok: true, index: 0 };
  return { ok: false, detail: `${views.length} variants and none is selected` };
}

export function emptyIdentifiers(): ReadIdentifiers {
  return { brand: null, gtin: null, mpn: null, sku: null, externalId: null };
}

/** A GTIN as the payload states it: 8, 12, 13 or 14 digits, or nothing. */
export function gtinText(value: string | null): string | null {
  const text = cleanText(value, 32);
  return text !== null && /^(?:[0-9]{8}|[0-9]{12,14})$/.test(text) ? text : null;
}

export interface ReadFields {
  readonly title: string | null;
  readonly identifiers: ReadIdentifiers;
  readonly variant: Readonly<Record<string, string>>;
  readonly currency: ListingCurrency;
  readonly sticker: number | null;
  readonly referenceClaimed: number | null;
  readonly availability: Availability;
  readonly candidates: readonly RawCandidate[];
}

/**
 * A read from a platform endpoint. Whatever the payload does not state is the honest unknown
 * (S§2.10): condition `unknown`, shipping `unknown`, tax inclusion null, no coupon, member price
 * or unit price. With currency `unknown` every amount is null (S§2.2).
 */
export function platformRead(fields: ReadFields): ReaderOutcome {
  const unknown = fields.currency === UNKNOWN_CURRENCY;
  const read: ListingRead = {
    method: PLATFORM_METHOD,
    rung: 'api',
    title: fields.title,
    identifiers: fields.identifiers,
    variant: fields.variant,
    condition: 'unknown',
    currency: fields.currency,
    sticker: unknown ? null : fields.sticker,
    referenceClaimed: unknown ? null : fields.referenceClaimed,
    coupon: null,
    memberPrice: null,
    shipping: null,
    shippingStatus: 'unknown',
    taxIncluded: null,
    unitPrice: null,
    unit: null,
    availability: fields.availability,
    candidates: fields.candidates.slice(0, MAX_CANDIDATES),
  };
  return { kind: 'read', read };
}

/** The URL as a WHATWG URL when it is http(s), else null. Never throws. */
export function httpUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  const url = URL.parse(raw);
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url;
}

/** A path segment decoded, or null when it is not valid percent-encoding or holds a separator. */
export function decodeSegment(segment: string): string | null {
  let text: string;
  try {
    text = decodeURIComponent(segment);
  } catch {
    return null;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused here
  if (text === '' || text.length > 255 || /[/?#\\\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

/** The platform of the store hints, `unknown` when there are no hints. */
export function platformOf(request: ReadRequest): string {
  return request.store?.platform ?? 'unknown';
}

/**
 * A guard against a figure a store converted (S§2.3): when the directory knows the store's base
 * currency and the platform states another, the figure is in a display currency, not the one the
 * store bills in.
 */
export function convertedFrom(request: ReadRequest, stated: MinorUnitCurrency): string | null {
  const base = request.store?.baseCurrency;
  if (base === undefined || base === UNKNOWN_CURRENCY || base === stated) return null;
  return `the platform states ${stated}, the store's base currency is ${base}`;
}

/** Decodes the HTML character references a platform leaves in a product name ("&#8211;", "&amp;"). */
export function decodeEntities(text: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code =
        ref[1] === 'x' || ref[1] === 'X'
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
    return named[ref.toLowerCase()] ?? whole;
  });
}
