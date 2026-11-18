// Classification review from stored evidence (no request): prints every row of each bucket of
// 30 rows or fewer, and a seeded sample of 15 of a larger one.
//   node lab/transport/review.ts [--bucket wall] [--all] <results.jsonl...>
import { parseArgs } from 'node:util';
import { mulberry32, shuffle } from '../routes/sample/random.ts';
import type { ClientResult, HostResult } from './result.ts';
import { readResults } from './summarise.ts';

const bucketOf = (x: ClientResult) => {
  const o = x.outcome;
  return o.kind === 'wall' ? `wall ${o.vendor}/${o.mode}` : o.kind;
};

export function describe(r: HostResult, x: ClientResult): string {
  const e = x.evidence;
  const h = e.headers ?? {};
  const head = ['server', 'cf-mitigated', 'x-datadome', 'akamai-grn', 'x-iinfo', 'set-cookie']
    .filter((k) => h[k] !== undefined)
    .map((k) => `${k}=${String(h[k]).slice(0, 80)}`)
    .join('; ');
  const chain = x.chain
    .map((c) => `${c.status ?? c.error}${c.location ? `->${c.location.slice(0, 60)}` : ''}`)
    .join(' ');
  return [
    `${r.key} ${x.client} pos=${x.position} ${JSON.stringify(x.outcome)}`,
    `  url ${r.url}`,
    `  final ${e.finalUrl ?? '-'} status=${e.status ?? '-'} bytes=${e.bytes ?? '-'} type=${e.contentType ?? '-'}`,
    `  chain ${chain}`,
    `  title ${JSON.stringify(e.title ?? null)} readable=${JSON.stringify(e.readable ?? null)}`,
    `  signals ${e.signals.join(',') || '-'}; headers ${head || '-'}`,
    ...(x.chain.some((c) => c.detail)
      ? [`  error ${x.chain.map((c) => c.detail ?? '').join(' / ')}`]
      : []),
    ...(e.snippet ? [`  snippet ${e.snippet.slice(0, 300)}`] : []),
  ].join('\n');
}

async function main(): Promise<void> {
  const { values: a, positionals: files } = parseArgs({
    options: {
      bucket: { type: 'string' },
      all: { type: 'boolean', default: false },
      every: { type: 'boolean', default: false },
      seed: { type: 'string', default: '20261118' },
    },
    allowPositionals: true,
  });
  const results = await readResults(files);
  const buckets = new Map<string, Array<[HostResult, ClientResult]>>();
  for (const r of results) {
    for (const x of r.results) {
      const b = bucketOf(x);
      if (!a.all && b === 'ok') continue;
      if (a.bucket && !b.startsWith(a.bucket)) continue;
      buckets.set(b, [...(buckets.get(b) ?? []), [r, x]]);
    }
  }
  for (const [b, rows] of [...buckets].sort(([x], [y]) => x.localeCompare(y))) {
    const read =
      rows.length > 30 && !a.every ? shuffle(rows, mulberry32(Number(a.seed))).slice(0, 15) : rows;
    console.info(`\n=== ${b}: ${rows.length} rows, ${read.length} shown`);
    for (const [r, x] of read) console.info(describe(r, x));
  }
}

if (import.meta.main) await main();
