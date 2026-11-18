// Converts a predecessor review file (`scripts/eval/*-review.json`) and the run it reviews
// (`reports/*.json`, the script's `--json` output) into this project's review file. Lossless where
// the format allows; every lossy step is written into `conversion.lossy`. Refuses, rather than
// guesses, whatever it cannot carry faithfully.
import { createHash } from 'node:crypto';
import { moneyFromDecimal } from '@agentic-dasher/core';
import { LISTING_CURRENCIES, type ListingCurrency, Timestamp } from '@agentic-dasher/shared';
import { z } from 'zod';
import {
  CONVERTER_VERSION,
  DecimalText,
  LISTING_SOURCES,
  type ListingSource,
  PredecessorReview,
  REVIEW_FORMAT_VERSION,
  ReviewFile,
  type ReviewListing,
  type ReviewProduct,
  SETUPS,
  type Setup,
  StoreKey,
  type StoreVerdict,
} from './format.ts';

/** The handle for a review whose reviewer the predecessor did not record. */
export const UNATTRIBUTED_REVIEWER = 'pred-unattributed';

export class ConversionRefused extends Error {
  override name = 'ConversionRefused';
}

const refuse = (message: string): never => {
  throw new ConversionRefused(message);
};

/** A JSON number kept as the exact text the predecessor wrote (Python's float repr). */
export class JsonNumber {
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
  toString(): string {
    return this.source;
  }
}

/**
 * Parses predecessor JSON keeping every number as its source text (JSON.parse source text
 * access), so no price passes through a float.
 */
export function parsePredecessorJson(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (typeof context?.source !== 'string') {
      return refuse('this Node.js gives no number source text to JSON.parse revivers');
    }
    return new JsonNumber(context.source);
  });
}

/**
 * A JSON number's text as a plain decimal, exactly: "5e-05" → "0.00005", "1.25E+3" → "1250".
 * Digits are moved, never computed, so nothing is rounded. Text without an exponent is unchanged.
 */
export function exactDecimalText(text: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) return refuse(`not a JSON number: ${JSON.stringify(text)}`);
  const [, sign = '', whole = '', fraction = '', exponent] = m;
  if (exponent === undefined) return text;
  const digits = whole + fraction;
  // Position of the decimal point within `digits` after shifting.
  const point = whole.length + Number(exponent);
  if (!Number.isSafeInteger(point) || Math.abs(point) > 400)
    return refuse(`exponent out of range: ${text}`);
  let intPart: string;
  let fracPart: string;
  if (point <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    intPart = digits + '0'.repeat(point - digits.length);
    fracPart = '';
  } else {
    intPart = digits.slice(0, point);
    fracPart = digits.slice(point);
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  fracPart = fracPart.replace(/0+$/, '');
  return `${sign}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

const Num = z.instanceof(JsonNumber);
const PredRow = z.looseObject({
  store: z.string(),
  url: z.string(),
  price: Num,
  currency: z.string().nullable(),
  title: z.string(),
  method: z.string().nullable().optional(),
});
type PredRow = z.infer<typeof PredRow>;
const Stores = z.array(z.string());
const PredProduct = z.looseObject({
  id: z.string(),
  category: z.string(),
  query: z.string(),
  catalog_results: z.array(PredRow),
  web_results: z.array(PredRow),
  learned_results: z.array(PredRow, {
    error:
      'no learned_results: the run predates the learned setup, and the script cannot rescore it',
  }),
  web_unreadable: z.array(z.looseObject({ host: z.string(), url: z.string(), reason: z.string() })),
  before_stores: Stores,
  after_stores: Stores,
  with_learned_stores: Stores,
  before_stores_in_preferred: Stores.optional(),
  after_stores_in_preferred: Stores.optional(),
  with_learned_stores_in_preferred: Stores.optional(),
});
type PredProduct = z.infer<typeof PredProduct>;
const PredRun = z.looseObject({
  started_at: z.string(),
  finished_at: z.string(),
  product_list: z.string().nullable().optional(),
  locale: z
    .looseObject({
      preferred_currency: z.string().nullable().optional(),
      preferred_region: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  products: z.array(PredProduct),
});

/** Run fields not carried, with why. Per-product fields are listed separately. */
const DROPPED_RUN_FIELDS: Record<string, string> = {
  base_url: 'the engine URL of the run',
  summary: 'recomputed by rescoring from the listings and verdicts',
  explorer: 'store-explorer cost telemetry, not a review figure',
  learned_stores: 'engine state at run time',
  exploration_queue: 'engine state at run time',
  review:
    'the path of the review file the run was last rescored with (kept in conversion.reviewFile)',
};
const DROPPED_PRODUCT_FIELDS: Record<string, string> = {
  compare_s: 'request timing (float seconds), not a review figure',
  discover_s: 'request timing (float seconds), not a review figure',
  web_stores_checked: 'discovery telemetry',
  web_unmatched: 'discovery telemetry',
  web_timed_out: 'discovery telemetry',
  web_queued: 'discovery telemetry',
  web_searched: 'discovery telemetry',
  web_engines_not_answering: 'discovery telemetry',
};
/** Fields derived from the rows; the converter checks they follow from the rows, then drops them. */
const DERIVED_PRODUCT_FIELDS = [
  'before',
  'after',
  'with_learned',
  'before_in_preferred',
  'after_in_preferred',
  'with_learned_in_preferred',
  'added_by_web',
  'added_by_learned',
  'learned_found_web_already_had',
  'web_found_catalog_already_had',
  'before_stores',
  'after_stores',
  'with_learned_stores',
  'before_stores_in_preferred',
  'after_stores_in_preferred',
  'with_learned_stores_in_preferred',
  'rejected',
  'checked_before',
  'checked_after',
  'checked_with_learned',
  'checked_before_in_preferred',
  'checked_after_in_preferred',
  'checked_with_learned_in_preferred',
  'checked_added_by_web',
  'checked_added_by_learned',
];
const KEPT_PRODUCT_FIELDS = [
  'id',
  'category',
  'query',
  'catalog_results',
  'web_results',
  'learned_results',
  'web_unreadable',
  'compare_error',
  'discover_error',
];

/** Python's `datetime.isoformat()` in UTC, truncated to milliseconds. */
function utcMillis(text: string, where: string, lossy: string[]): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|\+00:00)$/.exec(text);
  if (!m) return refuse(`${where}: not a UTC ISO time: ${JSON.stringify(text)}`);
  const [, base, frac = ''] = m;
  const out = `${base}.${frac.padEnd(3, '0').slice(0, 3)}Z`;
  if (!Timestamp.safeParse(out).success) return refuse(`${where}: not a valid time: ${text}`);
  if (frac.length > 3 && /[^0]/.test(frac.slice(3))) {
    lossy.push(`${where}: ${JSON.stringify(text)} truncated to milliseconds as ${out}`);
  }
  return out;
}

const LISTING_CURRENCY_SET: ReadonlySet<string> = new Set(LISTING_CURRENCIES);

function convertPrice(row: PredRow, where: string, lossy: string[]): ReviewListing['price'] {
  let currency: ListingCurrency;
  if (row.currency === null) {
    currency = 'unknown';
    lossy.push(`${where}: currency null written as "unknown"`);
  } else if (row.currency !== 'unknown' && LISTING_CURRENCY_SET.has(row.currency)) {
    currency = row.currency as ListingCurrency;
  } else {
    return refuse(
      `${where}: currency ${JSON.stringify(row.currency)} is not an ISO code with minor units`,
    );
  }
  const decimal = exactDecimalText(row.price.source);
  if (decimal !== row.price.source) {
    lossy.push(`${where}: price ${row.price.source} written out as ${decimal} (same value)`);
  }
  if (!DecimalText.safeParse(decimal).success) return refuse(`${where}: price ${row.price.source}`);
  const money = moneyFromDecimal(decimal, currency);
  return money.ok
    ? { decimal, currency, amountMinor: money.value.amountMinor, refusal: null }
    : { decimal, currency, amountMinor: null, refusal: money.refusal.code };
}

const sorted = (s: Iterable<string>) => [...s].sort();
const sameSet = (a: readonly string[], b: Iterable<string>) => {
  const x = sorted(a);
  const y = sorted(new Set(b));
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Checks that the run's stored store lists follow from its rows, as `run_one` built them. */
function checkDerived(p: PredProduct, preferred: string | null): void {
  const of = (rows: PredRow[], currency: string | null = null) =>
    rows
      .filter((r) => currency === null || (r.currency ?? '').toUpperCase() === currency)
      .map((r) => r.store);
  const want: Record<string, string[]> = {
    before_stores: of(p.catalog_results),
    after_stores: [...of(p.catalog_results), ...of(p.web_results)],
    with_learned_stores: [...of(p.catalog_results), ...of(p.web_results), ...of(p.learned_results)],
  };
  if (preferred) {
    const after = [...of(p.catalog_results, preferred), ...of(p.web_results, preferred)];
    want.before_stores_in_preferred = of(p.catalog_results, preferred);
    want.after_stores_in_preferred = after;
    want.with_learned_stores_in_preferred = [...after, ...of(p.learned_results, preferred)];
  }
  for (const [key, stores] of Object.entries(want)) {
    const stored = (p as Record<string, unknown>)[key];
    if (stored === undefined && key.endsWith('_in_preferred')) continue;
    if (!Array.isArray(stored) || !sameSet(stored as string[], stores)) {
      refuse(`product ${p.id}: ${key} does not follow from its rows`);
    }
  }
}

function convertRejection(
  productId: string,
  store: string,
  value: unknown,
  lossy: string[],
): StoreVerdict {
  const where = `review ${productId}/${store}`;
  if (!StoreKey.safeParse(store).success) return refuse(`${where}: not a store key`);
  if (typeof value === 'string') {
    if (value.trim() === '') return refuse(`${where}: empty reason`);
    return { store, verdict: 'rejected', setups: 'all', reason: value };
  }
  const v = z
    .strictObject({ reason: z.string(), setups: z.array(z.string()).optional() })
    .safeParse(value);
  if (!v.success) return refuse(`${where}: a rejection is a reason or {reason, setups}`);
  if (v.data.reason.trim() === '') return refuse(`${where}: empty reason`);
  const names = v.data.setups ?? [];
  if (names.length === 0) {
    // The script: `tuple(value.get("setups") or _SETUPS)`.
    lossy.push(
      `${where}: {reason${v.data.setups ? ', setups: []' : ''}} written as setups "all", as the script reads it`,
    );
    return { store, verdict: 'rejected', setups: 'all', reason: v.data.reason };
  }
  for (const name of names) {
    if (!(SETUPS as readonly string[]).includes(name)) {
      return refuse(
        `${where}: setup ${JSON.stringify(name)} is unknown (the script would ignore it)`,
      );
    }
  }
  if (new Set(names).size !== names.length) return refuse(`${where}: a setup named twice`);
  return { store, verdict: 'rejected', setups: names as Setup[], reason: v.data.reason };
}

export interface PredecessorSource {
  /** Where the predecessor checkout is, written with `~` (never an absolute home path). */
  repository: string;
  branch: string;
  commit: string;
  /** Paths relative to the predecessor root. */
  reviewFile: string;
  runFile: string;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export function convertPredecessor(input: {
  reviewText: string;
  runText: string;
  source: PredecessorSource;
}): ReviewFile {
  const { source } = input;
  const lossy: string[] = [];

  const reviewParsed = PredecessorReview.safeParse(JSON.parse(input.reviewText));
  if (!reviewParsed.success) {
    return refuse(`review file: ${reviewParsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const review = reviewParsed.data;
  const runParsed = PredRun.safeParse(parsePredecessorJson(input.runText));
  if (!runParsed.success) {
    const issue = runParsed.error.issues[0];
    return refuse(`run file: ${issue?.path.join('.')}: ${issue?.message ?? 'invalid'}`);
  }
  const run = runParsed.data;

  const preferred = run.locale?.preferred_currency ?? null;
  const notes = Object.entries(review).filter(([, v]) => typeof v === 'string');
  for (const [key] of notes) {
    if (key !== 'about') return refuse(`review file: unexpected note ${JSON.stringify(key)}`);
  }
  const about = review.about;
  if (typeof about !== 'string' || about.trim() === '') {
    return refuse('review file: no "about" note stating the rule');
  }
  const runIds = new Set(run.products.map((p) => p.id));
  for (const key of Object.keys(review)) {
    if (key !== 'about' && !runIds.has(key)) {
      return refuse(`review file: product ${JSON.stringify(key)} is not in the run`);
    }
  }

  for (const [key, why] of Object.entries(DROPPED_RUN_FIELDS)) {
    if (key in run) lossy.push(`run.${key} not carried: ${why}`);
  }
  const otherRun = Object.keys(run).filter(
    (k) =>
      !(k in DROPPED_RUN_FIELDS) &&
      !['started_at', 'finished_at', 'product_list', 'locale', 'products'].includes(k),
  );
  if (otherRun.length > 0) return refuse(`run file: fields not understood: ${otherRun.join(', ')}`);

  const droppedSeen = new Set<string>();
  const unreadableExtra = new Set<string>();
  const products: ReviewProduct[] = run.products.map((p) => {
    checkDerived(p, preferred);
    for (const k of Object.keys(p)) {
      if (k in DROPPED_PRODUCT_FIELDS) droppedSeen.add(k);
      else if (!DERIVED_PRODUCT_FIELDS.includes(k) && !KEPT_PRODUCT_FIELDS.includes(k)) {
        refuse(`product ${p.id}: field ${k} not understood`);
      }
    }
    for (const k of ['compare_error', 'discover_error']) {
      const v = (p as Record<string, unknown>)[k];
      if (v !== null && v !== undefined) {
        lossy.push(`product ${p.id}: ${k} not carried: ${JSON.stringify(String(v))}`);
      }
    }
    const listings: ReviewListing[] = [];
    const bySource: Record<ListingSource, PredRow[]> = {
      catalog: p.catalog_results,
      web: p.web_results,
      learned: p.learned_results,
    };
    for (const src of LISTING_SOURCES) {
      bySource[src].forEach((row, i) => {
        const where = `product ${p.id} ${src}[${i}]`;
        if (!StoreKey.safeParse(row.store).success) refuse(`${where}: store ${row.store}`);
        if (row.url === '') refuse(`${where}: empty url`);
        listings.push({
          source: src,
          store: row.store,
          url: row.url,
          title: row.title,
          price: convertPrice(row, where, lossy),
          readMethod: row.method ?? null,
        });
      });
    }
    const unreadable = p.web_unreadable.map((u) => {
      for (const k of Object.keys(u)) {
        if (!['host', 'url', 'reason'].includes(k)) unreadableExtra.add(k);
      }
      if (u.host === '' || u.url === '' || u.reason === '') {
        refuse(`product ${p.id}: an unreadable page without host, url or reason`);
      }
      return { host: u.host, url: u.url, reason: u.reason };
    });
    const entry = review[p.id];
    const verdicts =
      entry === undefined || typeof entry === 'string'
        ? []
        : Object.entries(entry).map(([store, v]) => convertRejection(p.id, store, v, lossy));
    const slug = /^[a-z0-9][a-z0-9._-]{0,79}$/;
    if (!slug.test(p.id) || !slug.test(p.category)) refuse(`product ${p.id}: id or category`);
    return { id: p.id, category: p.category, query: p.query, listings, unreadable, verdicts };
  });
  for (const k of sorted(droppedSeen)) {
    lossy.push(`product field ${k} not carried: ${DROPPED_PRODUCT_FIELDS[k]}`);
  }
  if (unreadableExtra.size > 0) {
    lossy.push(
      `web_unreadable fields ${sorted(unreadableExtra).join(', ')} not carried (host, url and reason are)`,
    );
  }
  lossy.push(
    'derived product fields (before/after/with_learned counts and store lists, added_by_*, ' +
      '*_already_had, rejected, checked_*) not carried: checked to follow from the rows, recomputed by rescoring',
    `review.reviewerId: the predecessor records no reviewer; "${UNATTRIBUTED_REVIEWER}" stands for "not recorded"`,
    'review.reviewedAt: the predecessor records no review time; null',
  );

  const region = run.locale?.preferred_region ?? null;
  const fileName = source.reviewFile.split('/').pop() ?? '';
  const file: ReviewFile = {
    formatVersion: REVIEW_FORMAT_VERSION,
    id: fileName.replace(/\.json$/, ''),
    run: {
      startedAt: utcMillis(run.started_at, 'run.started_at', lossy),
      finishedAt: utcMillis(run.finished_at, 'run.finished_at', lossy),
      preferredCurrency: preferred as ReviewFile['run']['preferredCurrency'],
      preferredRegion: region,
      productList: run.product_list ?? null,
    },
    review: {
      reviewerId: UNATTRIBUTED_REVIEWER,
      reviewedAt: null,
      rule: about,
      unlistedStores: 'accepted',
    },
    products,
    conversion: {
      converter: CONVERTER_VERSION,
      repository: source.repository,
      branch: source.branch,
      commit: source.commit,
      reviewFile: source.reviewFile,
      reviewFileSha256: sha256(input.reviewText),
      runFile: source.runFile,
      runFileSha256: sha256(input.runText),
      lossy,
    },
  };
  const checked = ReviewFile.safeParse(file);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return refuse(`converted file invalid: ${issue?.path.join('.')}: ${issue?.message}`);
  }
  return checked.data;
}
