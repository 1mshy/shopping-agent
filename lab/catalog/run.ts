// Live runner for plan P0 spike B. A person starts it; CI never does. See README.md.
//   node lab/catalog/run.ts --profile <published https URL> --products <file.json> --owner-approved
//     [--functional-check]
// Sequential, one request every --interval-ms (min 2000), never retries, stops at the first 429
// and at the first profile rejection. --functional-check (the run chosen on 2026-11-23) caps the
// list at 6 rows and records no latency at all: the API terms forbid benchmarking the API.
// It writes measurement records only: no titles, prices or URLs, because the Catalog terms cap
// price caching at 10 minutes and forbid a standing product database (SOURCES.md §5).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProfileUrl, type ProbeResult, searchCatalog } from './client.ts';

export const MIN_INTERVAL_MS = 2000;
export const MAX_LINES = 60; // plan: 20 gold products x CA, US, DE
export const FUNCTIONAL_CHECK_MAX_LINES = 6; // 2026-11-23: e.g. 2 queries x CA, US, DE
/** [UCP-OV] / [PROF] codes by which a business rejects the agent profile. */
export const PROFILE_ERROR_CODES = new Set([
  'invalid_profile_url',
  'profile_unreachable',
  'profile_malformed',
  'profile_too_large',
  'version_unsupported',
]);
const MESSAGE_TEXT_MAX = 300;

export interface ProductLine {
  query: string;
  country: string;
  currency: string;
}

export interface RunOptions {
  profileUrl: string;
  productsFile: string;
  intervalMs: number;
  limit: number;
  shipsTo: boolean;
  outDir: string;
  functionalCheck: boolean;
}

export function parseArgs(argv: string[]): RunOptions {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const profile = value('--profile');
  if (!profile) throw new Error('--profile <published https URL> is required; there is no default');
  const productsFile = value('--products');
  if (!productsFile) throw new Error('--products <file.json> is required');
  if (!argv.includes('--owner-approved')) {
    throw new Error(
      '--owner-approved is required: the owner must have published the profile and accepted the API terms (README.md)',
    );
  }
  const intervalMs = Number(value('--interval-ms') ?? MIN_INTERVAL_MS);
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    throw new Error(`--interval-ms must be an integer >= ${MIN_INTERVAL_MS}`);
  }
  const limit = Number(value('--limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be 1..50');
  return {
    profileUrl: assertProfileUrl(profile),
    productsFile,
    intervalMs,
    limit,
    shipsTo: argv.includes('--ships-to'),
    outDir: value('--out') ?? join('lab', 'out', 'catalog'),
    functionalCheck: argv.includes('--functional-check'),
  };
}

export function parseProductList(text: string, maxLines = MAX_LINES): ProductLine[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('product list must be a JSON array');
  if (data.length > maxLines)
    throw new Error(`product list has ${data.length} rows; max ${maxLines}`);
  return data.map((row, i) => {
    const r = row as Partial<Record<keyof ProductLine, unknown>>;
    const okRow =
      typeof r.query === 'string' &&
      r.query.trim() !== '' &&
      typeof r.country === 'string' &&
      /^[A-Z]{2}$/.test(r.country) &&
      typeof r.currency === 'string' &&
      /^[A-Z]{3}$/.test(r.currency);
    if (!okRow) throw new Error(`row ${i}: needs query, country (e.g. CA) and currency (e.g. CAD)`);
    return {
      query: r.query as string,
      country: r.country as string,
      currency: r.currency as string,
    };
  });
}

export interface RunRecord {
  index: number;
  query: string;
  country: string;
  currency: string;
  status: number | null;
  latencyMs: number | null; // null in a functional check: no latency is recorded
  contentType: string | null;
  rateLimitHeaders: Record<string, string>;
  errorKind: string | null;
  error: unknown;
  ucpVersion: string | null;
  /** UCP `messages[]` of a successful reply: type, code, severity and at most 300 chars of text. */
  messages: {
    type: string | null;
    code: string | null;
    severity: string | null;
    content: string | null;
  }[];
  productCount: number;
  offerCount: number;
  offersWithUrl: number;
  offersWithCheckoutUrl: number;
  offersRequestedCurrency: number;
  offersOtherCurrency: number;
  offersMissingPrice: number;
  currenciesSeen: string[];
  amountJsonTypes: Record<string, number>;
  attributionParamCounts: Record<string, number>;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function toRecord(
  index: number,
  line: ProductLine,
  r: ProbeResult,
  opts: { latency?: boolean } = {},
): RunRecord {
  const offers = r.ok ? r.offers : [];
  const amountJsonTypes: Record<string, number> = {};
  const attributionParamCounts: Record<string, number> = {};
  for (const o of offers) {
    if (o.price) bump(amountJsonTypes, o.price.amountJsonType);
    for (const p of o.attributionParams) bump(attributionParamCounts, p);
  }
  const count = (m: string) => offers.filter((o) => o.currencyMatch === m).length;
  return {
    index,
    ...line,
    status: r.status,
    latencyMs: opts.latency === false ? null : r.latencyMs,
    contentType: r.contentType,
    rateLimitHeaders: r.rateLimitHeaders,
    errorKind: r.ok ? null : r.error.kind,
    error: r.ok ? null : r.error, // error bodies carry no product data
    ucpVersion: r.ok ? r.ucpVersion : null,
    messages: (r.ok ? r.messages : []).map((m) => {
      const o = typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {};
      const content = strOrNull(o.content);
      return {
        type: strOrNull(o.type),
        code: strOrNull(o.code),
        severity: strOrNull(o.severity),
        content: content === null ? null : content.slice(0, MESSAGE_TEXT_MAX),
      };
    }),
    productCount: r.ok ? r.productCount : 0,
    offerCount: offers.length,
    offersWithUrl: offers.filter((o) => o.url !== null).length,
    offersWithCheckoutUrl: offers.filter((o) => o.checkoutUrl !== null).length,
    offersRequestedCurrency: count('requested'),
    offersOtherCurrency: count('other'),
    offersMissingPrice: count('missing'),
    currenciesSeen: [...new Set(offers.flatMap((o) => (o.price ? [o.price.currency] : [])))].sort(),
    amountJsonTypes,
    attributionParamCounts,
  };
}

/** Nearest-rank percentile; null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1] ?? null;
}

/** True when the reply is a profile rejection ([UCP-OV]: MCP code -32001 or a profile error code). */
export function isProfileRejection(r: RunRecord): boolean {
  if (r.errorKind !== 'jsonrpc' && r.errorKind !== 'ucp_error') return false;
  const e = (r.error ?? {}) as { jsonrpcCode?: number; ucpCode?: string };
  return (
    e.jsonrpcCode === -32001 || (e.ucpCode !== undefined && PROFILE_ERROR_CODES.has(e.ucpCode))
  );
}

export function summarise(records: RunRecord[], planned: number, opts: { latency?: boolean } = {}) {
  const answered = records.flatMap((r) =>
    r.status !== null && r.latencyMs !== null ? [r.latencyMs] : [],
  );
  const ok = records.filter((r) => r.errorKind === null);
  const hits = ok.map((r) => r.productCount);
  const sum = (f: (r: RunRecord) => number) => records.reduce((a, r) => a + f(r), 0);
  const offers = {
    total: sum((r) => r.offerCount),
    withPrice: sum((r) => r.offersRequestedCurrency + r.offersOtherCurrency),
    requestedCurrency: sum((r) => r.offersRequestedCurrency),
    otherCurrency: sum((r) => r.offersOtherCurrency),
    missingPrice: sum((r) => r.offersMissingPrice),
  };
  const errorsByKind: Record<string, number> = {};
  for (const r of records) if (r.errorKind) bump(errorsByKind, r.errorKind);
  return {
    planned,
    attempted: records.length,
    ok: ok.length,
    ...(opts.latency === false
      ? {}
      : {
          latencyMs: {
            n: answered.length,
            p50: percentile(answered, 50),
            p95: percentile(answered, 95),
          },
        }),
    hitsPerQuery: {
      n: hits.length,
      mean: hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : null,
      median: percentile(hits, 50),
      zeroHit: hits.filter((h) => h === 0).length,
    },
    offers,
    shareRequestedCurrency: offers.withPrice ? offers.requestedCurrency / offers.withPrice : null,
    errorsByKind,
    profileRejections: records.filter(isProfileRejection).length,
  };
}

export async function runAll(
  lines: ProductLine[],
  deps: {
    intervalMs: number;
    search: (line: ProductLine, index: number) => Promise<ProbeResult>;
    sleep: (ms: number) => Promise<void>;
    onRecord?: (r: RunRecord) => void;
    latency?: boolean;
  },
): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const [i, line] of lines.entries()) {
    if (i > 0) await deps.sleep(deps.intervalMs);
    const record = toRecord(i, line, await deps.search(line, i), { latency: deps.latency });
    records.push(record);
    deps.onRecord?.(record);
    if (record.errorKind === 'rate_limited') break; // stop; do not retry against a shared pool
    if (isProfileRejection(record)) break; // every later request would be rejected the same way
  }
  return records;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const latency = !opts.functionalCheck;
  const lines = parseProductList(
    readFileSync(opts.productsFile, 'utf8'),
    opts.functionalCheck ? FUNCTIONAL_CHECK_MAX_LINES : MAX_LINES,
  );
  const dir = resolve(opts.outDir, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(dir, { recursive: true });
  console.info(
    `${lines.length} requests, one every ${opts.intervalMs} ms, profile ${opts.profileUrl}`,
  );
  const records = await runAll(lines, {
    intervalMs: opts.intervalMs,
    latency,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    search: (line, i) =>
      searchCatalog(
        { ...line, limit: opts.limit, shipsTo: opts.shipsTo },
        { profileUrl: opts.profileUrl, id: i + 1 },
      ),
    onRecord: (r) => {
      writeFileSync(join(dir, 'records.jsonl'), `${JSON.stringify(r)}\n`, { flag: 'a' });
      const ms = r.latencyMs === null ? '' : ` ${r.latencyMs} ms`;
      console.info(
        `#${r.index} ${r.country} ${r.status ?? '-'}${ms} ${r.errorKind ?? `${r.productCount} hits`}`,
      );
    },
  });
  const summary = summarise(records, lines.length, { latency });
  writeFileSync(
    join(dir, 'summary.json'),
    `${JSON.stringify({ options: opts, summary }, null, 2)}\n`,
  );
  console.info(JSON.stringify(summary, null, 2));
  console.info(`records and summary in ${dir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
