// Offline rescoring of a review file: the figures the predecessor's
// `scripts/web-discovery-eval.py --rescore` computed (`apply_review` and `summarise`), with the
// same definitions, from the review file alone. No network, no model. Every ratio keeps its
// numerator, denominator and n; a zero denominator is `undefined`, never 0 or 1.
import {
  LISTING_SOURCES,
  type ReviewFile,
  type ReviewProduct,
  SETUP_SOURCES,
  SETUPS,
  type Setup,
  setupsOf,
} from './format.ts';

export type Fraction = { numerator: number; denominator: number };
/** A sum or a count (`n`: the products it is over). */
export type Count = { kind: 'count'; value: number; n: number };
/** `numerator` of `denominator`; `value` is the reduced fraction, or `undefined` for 0/0. */
export type Share = {
  kind: 'share';
  numerator: number;
  denominator: number;
  n: number;
  value: Fraction | 'undefined';
};
/** The median of `n` integers as an exact fraction (a half when n is even), or `undefined` for n = 0. */
export type Median = { kind: 'median'; n: number; value: Fraction | 'undefined' };
export type Tally = { kind: 'tally'; value: Record<string, number>; n: number };
export type Flag = { kind: 'flag'; value: boolean };
export type Label = { kind: 'label'; value: string };
export type ByCategory = {
  kind: 'by_category';
  n: number;
  value: Record<string, Record<Setup, number>>;
};
export type Figure = Count | Share | Median | Tally | Flag | Label | ByCategory;

type PerSetup = Record<Setup, string[]>;

/** One product as the script's row after `apply_review`, under this project's names. */
export interface ProductRescore {
  id: string;
  category: string;
  /** Distinct stores with a verified row, per setup (`before_stores`, ...). */
  stores: PerSetup;
  /** The same, counting only rows in the preferred currency (`*_stores_in_preferred`). */
  storesInPreferred: PerSetup | null;
  /** Stores left after the rejections that apply to the setup (`checked_*` are their sizes). */
  checked: PerSetup;
  checkedInPreferred: PerSetup | null;
  addedByWeb: string[];
  addedByLearned: string[];
  checkedAddedByWeb: string[];
  checkedAddedByLearned: string[];
  /** Rejected stores that this run has at all (the script's `row["rejected"]` keys). */
  rejectedInRun: string[];
}

export interface RescoreReport {
  id: string;
  n: { products: number; listings: number; verdicts: number; rejectionsWithoutEffect: number };
  products: ProductRescore[];
  /** The script's `summarise()` figures, under its names and definitions. */
  predecessor: Record<string, Figure>;
  /** Script figures not computed here, with why. */
  notPorted: Record<string, string>;
  /** Figures the predecessor's write-ups derived from the script's (not computed by the script). */
  reportDerived: Record<string, Figure>;
  /** Closest available figures to an S§6 gate; NOT the gate (assumptions in the README). */
  gateCandidates: Record<string, Median>;
  /** S§6 gates that cannot be computed from a review file of this kind, with what is missing. */
  notComputable: Record<string, string>;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

export function reduce(numerator: number, denominator: number): Fraction {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`not a fraction: ${numerator}/${denominator}`);
  }
  const g = gcd(numerator, denominator) || 1;
  return { numerator: numerator / g, denominator: denominator / g };
}

/** The exact value of a finite double as a reduced fraction (doubling is exact in binary). */
export function exactFractionOfDouble(x: number): Fraction {
  if (!Number.isFinite(x)) throw new RangeError(`not finite: ${x}`);
  let numerator = x;
  let denominator = 1;
  while (!Number.isInteger(numerator)) {
    numerator *= 2;
    denominator *= 2;
    if (denominator > Number.MAX_SAFE_INTEGER) throw new RangeError(`too fine: ${x}`);
  }
  return reduce(numerator, denominator);
}

export const share = (numerator: number, denominator: number, n: number): Share => ({
  kind: 'share',
  numerator,
  denominator,
  n,
  value: denominator === 0 ? 'undefined' : reduce(numerator, denominator),
});

/** `statistics.median`: the middle value, or the mean of the two middle values. */
export function medianOf(values: readonly number[]): Median {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { kind: 'median', n, value: 'undefined' };
  const hi = v[Math.floor(n / 2)] as number;
  if (n % 2 === 1) return { kind: 'median', n, value: reduce(hi, 1) };
  const lo = v[n / 2 - 1] as number;
  return { kind: 'median', n, value: reduce(lo + hi, 2) };
}

const sortedSet = (items: Iterable<string>) => [...new Set(items)].sort();
const minus = (a: readonly string[], b: readonly string[]) => {
  const drop = new Set(b);
  return a.filter((x) => !drop.has(x));
};
const perSetup = (f: (s: Setup) => string[]): PerSetup => ({
  before: f('before'),
  after: f('after'),
  with_learned: f('with_learned'),
});

function rescoreProduct(p: ReviewProduct, preferred: string | null): ProductRescore {
  const storesOf = (setup: Setup, currency: string | null) =>
    sortedSet(
      p.listings
        .filter((l) => SETUP_SOURCES[setup].includes(l.source))
        .filter((l) => currency === null || l.price.currency === currency)
        .map((l) => l.store),
    );
  const rejected = p.verdicts.filter((v) => v.verdict === 'rejected');
  const rejectedIn = (setup: Setup) =>
    rejected.filter((v) => setupsOf(v).includes(setup)).map((v) => v.store);
  const stores = perSetup((s) => storesOf(s, null));
  const storesInPreferred = preferred === null ? null : perSetup((s) => storesOf(s, preferred));
  const checked = perSetup((s) => minus(stores[s], rejectedIn(s)));
  const checkedInPreferred =
    storesInPreferred === null ? null : perSetup((s) => minus(storesInPreferred[s], rejectedIn(s)));
  const bySource = Object.fromEntries(
    LISTING_SOURCES.map((src) => [
      src,
      sortedSet(p.listings.filter((l) => l.source === src).map((l) => l.store)),
    ]),
  ) as Record<(typeof LISTING_SOURCES)[number], string[]>;
  return {
    id: p.id,
    category: p.category,
    stores,
    storesInPreferred,
    checked,
    checkedInPreferred,
    addedByWeb: minus(bySource.web, stores.before),
    addedByLearned: minus(bySource.learned, stores.after),
    checkedAddedByWeb: minus(checked.after, checked.before),
    checkedAddedByLearned: minus(checked.with_learned, checked.after),
    rejectedInRun: sortedSet(rejected.map((v) => v.store)).filter((s) =>
      stores.with_learned.includes(s),
    ),
  };
}

export const NOT_PORTED: Readonly<Record<string, string>> = {
  median_discover_s:
    'median request time of /api/discover: run telemetry (float seconds), not carried in a review file',
  median_compare_s:
    'median request time of /api/compare: run telemetry (float seconds), not carried in a review file',
};

export const NOT_COMPUTABLE: Readonly<Record<string, string>> = {
  identity_precision:
    'needs, per listing, whether the engine showed it as exact and a reviewed relation; the review ' +
    'is per store (one unnamed row may be the product, in any colour or finish) and the ' +
    'predecessor engine output a score, not a relation',
  price_correctness:
    'needs a reviewed correct price per shown listing; the review judges identity per store and ' +
    'rejects a price only in passing (multi-capacity listings)',
  best_offer_recall:
    'needs a reference set of best offers found independently of the engine, and correct prices; ' +
    'the review covers only stores the engine found, and does not say which row at an accepted ' +
    'store is the product',
};

export function rescore(file: ReviewFile): RescoreReport {
  const preferred = file.run.preferredCurrency;
  const rows = file.products.map((p) => rescoreProduct(p, preferred));
  const P = rows.length;
  const count = (f: (r: ProductRescore) => number): Count => ({
    kind: 'count',
    value: rows.reduce((t, r) => t + f(r), 0),
    n: P,
  });
  const products = (f: (r: ProductRescore) => boolean) => share(rows.filter(f).length, P, P);
  const median = (f: (r: ProductRescore) => number) => medianOf(rows.map(f));

  const predecessor: Record<string, Figure> = {
    products: { kind: 'count', value: P, n: P },
    // `hand_checked: all("checked_before" in r for r in rows)`: true once a review is applied.
    hand_checked: { kind: 'flag', value: true },
    checked_products_improved_by_learned: products(
      (r) => r.checked.with_learned.length > r.checked.after.length,
    ),
    products_improved: products((r) => r.stores.after.length > r.stores.before.length),
    products_improved_by_learned: products(
      (r) => r.stores.with_learned.length > r.stores.after.length,
    ),
  };
  const unreadable: Record<string, number> = {};
  for (const p of file.products) {
    for (const u of p.unreadable) unreadable[u.reason] = (unreadable[u.reason] ?? 0) + 1;
  }
  predecessor.unreadable_by_reason = { kind: 'tally', value: unreadable, n: P };
  for (const s of SETUPS) {
    predecessor[`store_prices_${s}`] = count((r) => r.stores[s].length);
    predecessor[`checked_store_prices_${s}`] = count((r) => r.checked[s].length);
    predecessor[`median_stores_${s}`] = median((r) => r.stores[s].length);
    predecessor[`products_with_none_${s}`] = products((r) => r.stores[s].length === 0);
  }
  if (preferred !== null) {
    predecessor.preferred_currency = { kind: 'label', value: preferred };
    for (const s of SETUPS) {
      predecessor[`store_prices_in_preferred_${s}`] = count(
        (r) => r.storesInPreferred?.[s].length ?? 0,
      );
      predecessor[`checked_in_preferred_${s}`] = count(
        (r) => r.checkedInPreferred?.[s].length ?? 0,
      );
      predecessor[`median_in_preferred_${s}`] = median((r) => r.storesInPreferred?.[s].length ?? 0);
    }
  }

  const reportDerived: Record<string, Figure> = {
    checked_products_improved_by_web: products(
      (r) => r.checked.after.length > r.checked.before.length,
    ),
  };
  const byCategory: Record<string, Record<Setup, number>> = {};
  for (const r of rows) {
    const totals = byCategory[r.category] ?? { before: 0, after: 0, with_learned: 0 };
    for (const s of SETUPS) totals[s] += r.checked[s].length;
    byCategory[r.category] = totals;
  }
  reportDerived.checked_store_prices_by_category = { kind: 'by_category', n: P, value: byCategory };
  const gateCandidates: Record<string, Median> = {};
  for (const s of SETUPS) {
    const checkedTotal = rows.reduce((t, r) => t + r.checked[s].length, 0);
    const rawTotal = rows.reduce((t, r) => t + r.stores[s].length, 0);
    reportDerived[`checked_share_of_raw_${s}`] = share(checkedTotal, rawTotal, P);
    reportDerived[`products_with_none_checked_${s}`] = products((r) => r.checked[s].length === 0);
    gateCandidates[`median_checked_stores_per_product_${s}`] = median((r) => r.checked[s].length);
  }

  let rejectionsWithoutEffect = 0;
  let verdicts = 0;
  file.products.forEach((p, i) => {
    const r = rows[i] as ProductRescore;
    for (const v of p.verdicts) {
      verdicts += 1;
      if (v.verdict !== 'rejected') continue;
      if (!setupsOf(v).some((s) => r.stores[s].includes(v.store))) rejectionsWithoutEffect += 1;
    }
  });

  return {
    id: file.id,
    n: {
      products: P,
      listings: file.products.reduce((t, p) => t + p.listings.length, 0),
      verdicts,
      rejectionsWithoutEffect,
    },
    products: rows,
    predecessor,
    notPorted: { ...NOT_PORTED },
    reportDerived,
    gateCandidates,
    notComputable: { ...NOT_COMPUTABLE },
  };
}

const frac = (f: Fraction | 'undefined') =>
  f === 'undefined'
    ? 'undefined'
    : f.denominator === 1
      ? `${f.numerator}`
      : `${f.numerator}/${f.denominator}`;

/** One line per figure: every ratio as numerator/denominator with n; no percentage. */
export function describeFigure(f: Figure): string {
  switch (f.kind) {
    case 'count':
      return `${f.value} (count, n = ${f.n} products)`;
    case 'share':
      return `${f.numerator}/${f.denominator}${f.value === 'undefined' ? ' (undefined: zero denominator)' : ''} (n = ${f.n} products)`;
    case 'median':
      return `${frac(f.value)}${f.value === 'undefined' ? ' (no values)' : ''} (median of n = ${f.n} products)`;
    case 'tally':
      return `${JSON.stringify(f.value)} (over n = ${f.n} products)`;
    case 'flag':
    case 'label':
      return String(f.value);
    case 'by_category':
      return Object.entries(f.value)
        .map(([c, v]) => `${c} ${v.before} / ${v.after} / ${v.with_learned}`)
        .join('; ')
        .concat(` (before / after / with_learned, n = ${f.n} products)`);
  }
}

export function formatReport(r: RescoreReport): string {
  const out: string[] = [];
  const section = (title: string, figures: Record<string, Figure>) => {
    out.push(title);
    const width = Math.max(0, ...Object.keys(figures).map((k) => k.length));
    for (const key of Object.keys(figures).sort()) {
      out.push(`  ${key.padEnd(width)}  ${describeFigure(figures[key] as Figure)}`);
    }
  };
  out.push(
    `${r.id}: ${r.n.products} products, ${r.n.listings} listings, ${r.n.verdicts} verdicts ` +
      `(${r.n.rejectionsWithoutEffect} rejections name no store of their setups in this run)`,
  );
  out.push(
    'Per product: raw stores before / after / with_learned | checked before / after / with_learned',
  );
  for (const p of r.products) {
    const raw = SETUPS.map((s) => p.stores[s].length).join(' / ');
    const checked = SETUPS.map((s) => p.checked[s].length).join(' / ');
    out.push(`  ${p.id.padEnd(18)} ${raw.padEnd(14)} | ${checked}`);
  }
  section(
    'Predecessor figures (scripts/web-discovery-eval.py summarise, same definitions):',
    r.predecessor,
  );
  out.push('  not ported:');
  for (const [k, why] of Object.entries(r.notPorted)) out.push(`    ${k}: ${why}`);
  section(
    "Report-derived figures (in the predecessor's write-ups, not its script):",
    r.reportDerived,
  );
  section(
    'Gate candidates (NOT the S§6 gates; assumptions in evals/review/README.md):',
    r.gateCandidates,
  );
  out.push('S§6 gates not computable from this review file:');
  for (const [k, why] of Object.entries(r.notComputable)) out.push(`  ${k}: ${why}`);
  return out.join('\n');
}
