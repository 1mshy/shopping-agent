// Turns spike A result files (JSON lines of HostResult) into the report tables.
//   node lab/transport/summarise.ts lab/out/transport/pilot/results.jsonl lab/out/transport/full/results.jsonl
import { readFile } from 'node:fs/promises';
import type { OutcomeKind } from '../routes/outcome.ts';
import { pct } from '../routes/summarise.ts';
import { type ClientResult, type HostResult, isReadable } from './result.ts';
import type { ClientId } from './transport.ts';

const ORDER: OutcomeKind[] = [
  'ok',
  'wall',
  'rate_limited',
  'login_required',
  'payment_required',
  'forbidden',
  'client_error',
  'not_found',
  'invalid_payload',
  'server_error',
  'off_site_redirect',
  'network_error',
  'refused_by_policy',
  'skipped',
];
const LABEL: Partial<Record<OutcomeKind, string>> = {
  ok: 'readable',
  invalid_payload: 'served, no price markup',
};
export const label = (k: OutcomeKind) => LABEL[k] ?? k;
const cell = (k: number, n: number) => `${k} (${pct(k, n)})`;

export function clientsOf(results: HostResult[]): ClientId[] {
  const seen = new Set<ClientId>();
  for (const r of results) for (const x of r.results) seen.add(x.client);
  return (['fetch', 'impit', 'wreq'] as ClientId[]).filter((c) => seen.has(c));
}

const resultOf = (r: HostResult, c: ClientId): ClientResult | undefined =>
  r.results.find((x) => x.client === c);
export const reads = (r: HostResult, c: ClientId) => {
  const x = resultOf(r, c);
  return x !== undefined && isReadable(x.outcome);
};

export interface ClientRow {
  client: ClientId;
  n: number;
  counts: Partial<Record<OutcomeKind, number>>;
  walls: Record<string, number>;
  requests: number;
}

export function tabulate(results: HostResult[]): ClientRow[] {
  return clientsOf(results).map((client) => {
    const counts: ClientRow['counts'] = {};
    const walls: Record<string, number> = {};
    let n = 0;
    let requests = 0;
    for (const r of results) {
      const x = resultOf(r, client);
      if (!x) continue;
      n++;
      requests += x.requests;
      counts[x.outcome.kind] = (counts[x.outcome.kind] ?? 0) + 1;
      if (x.outcome.kind === 'wall') {
        const k = `${x.outcome.vendor}/${x.outcome.mode}`;
        walls[k] = (walls[k] ?? 0) + 1;
      }
    }
    return { client, n, counts, walls, requests };
  });
}

export interface PairRow {
  a: ClientId;
  b: ClientId;
  n: number;
  both: number;
  onlyA: number;
  onlyB: number;
  neither: number;
}

/** Pairwise overlap over the hosts both clients were run on. */
export function overlap(results: HostResult[]): PairRow[] {
  const cs = clientsOf(results);
  const out: PairRow[] = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i] as ClientId;
      const b = cs[j] as ClientId;
      const row: PairRow = { a, b, n: 0, both: 0, onlyA: 0, onlyB: 0, neither: 0 };
      for (const r of results) {
        if (!resultOf(r, a) || !resultOf(r, b)) continue;
        row.n++;
        const x = reads(r, a);
        const y = reads(r, b);
        if (x && y) row.both++;
        else if (x) row.onlyA++;
        else if (y) row.onlyB++;
        else row.neither++;
      }
      out.push(row);
    }
  }
  return out;
}

/** Hosts exactly one client reads, by client. */
export function onlyOne(results: HostResult[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of results) {
    const readers = clientsOf([r]).filter((c) => reads(r, c));
    if (readers.length === 1) {
      const c = readers[0] as ClientId;
      out[c] = [...(out[c] ?? []), r.key];
    }
  }
  return out;
}

export interface PredecessorRow {
  basis: string;
  value: string;
  n: number;
  readable: Partial<Record<ClientId, number>>;
  any: number;
  dates: string;
}

/**
 * Readable hosts per client, grouped by what the predecessor recorded with curl_cffi: the playbook
 * strategy (`http` = its fingerprinted GET was usable), and the rung of its newest price read.
 */
export function predecessorTable(results: HostResult[]): PredecessorRow[] {
  const cs = clientsOf(results);
  const groups = new Map<string, HostResult[]>();
  const add = (k: string, r: HostResult) => groups.set(k, [...(groups.get(k) ?? []), r]);
  const dateOf = new Map<string, string[]>();
  for (const r of results) {
    const pb = r.predecessor.playbook;
    const kp = `playbook\t${pb?.strategy ?? 'no entry'}`;
    add(kp, r);
    if (pb) dateOf.set(kp, [...(dateOf.get(kp) ?? []), pb.date]);
    const rd = r.predecessor.read;
    const kr = `newest price read\t${rd?.rung ?? 'none recorded'}`;
    add(kr, r);
    if (rd) dateOf.set(kr, [...(dateOf.get(kr) ?? []), rd.date]);
  }
  return [...groups]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, rs]) => {
      const [basis = '', value = ''] = k.split('\t');
      const readable: PredecessorRow['readable'] = {};
      for (const c of cs) readable[c] = rs.filter((r) => reads(r, c)).length;
      const ds = (dateOf.get(k) ?? []).sort();
      return {
        basis,
        value,
        n: rs.length,
        readable,
        any: rs.filter((r) => cs.some((c) => reads(r, c))).length,
        dates: ds.length ? `${ds[0]} to ${ds[ds.length - 1]}` : 'n/a',
      };
    });
}

export interface RequestStats {
  hosts: number;
  total: number;
  perClient: Partial<Record<ClientId, number>>;
  maxPerHost: number;
  maxPerClientOnHost: number;
  histogram: Array<[number, number]>;
  /** How often each client was in each position (0 = first to the host). */
  positions: Partial<Record<ClientId, number[]>>;
  firstStart: string;
  lastEnd: string;
}

export function requestStats(results: HostResult[]): RequestStats {
  const cs = clientsOf(results);
  const hist = new Map<number, number>();
  const perClient: RequestStats['perClient'] = {};
  const positions: RequestStats['positions'] = {};
  let maxPerClientOnHost = 0;
  for (const r of results) {
    hist.set(r.requests, (hist.get(r.requests) ?? 0) + 1);
    for (const x of r.results) {
      perClient[x.client] = (perClient[x.client] ?? 0) + x.requests;
      maxPerClientOnHost = Math.max(maxPerClientOnHost, x.requests);
      const p = positions[x.client] ?? cs.map(() => 0);
      p[x.position] = (p[x.position] ?? 0) + 1;
      positions[x.client] = p;
    }
  }
  const starts = results.map((r) => Date.parse(r.startedAt));
  const ends = results.map((r) => Date.parse(r.startedAt) + r.ms);
  const iso = (v: number) => (Number.isFinite(v) ? new Date(v).toISOString() : 'n/a');
  return {
    hosts: results.length,
    total: results.reduce((s, r) => s + r.requests, 0),
    perClient,
    maxPerHost: Math.max(0, ...hist.keys()),
    maxPerClientOnHost,
    histogram: [...hist].sort(([a], [b]) => a - b),
    positions,
    firstStart: iso(Math.min(...starts)),
    lastEnd: iso(Math.max(...ends)),
  };
}

const detailOf = (x: ClientResult) => {
  const o = x.outcome;
  if (o.kind === 'wall') return `wall ${o.vendor}/${o.mode}`;
  if (o.kind === 'network_error') return `network_error ${o.code}`;
  if (o.kind === 'refused_by_policy' || o.kind === 'skipped') return `${o.kind} ${o.reason}`;
  if (o.kind === 'off_site_redirect') return `off_site_redirect ${o.to}`;
  return undefined;
};

export function renderMarkdown(results: HostResult[]): string {
  const rows = tabulate(results);
  const cs = clientsOf(results);
  const kinds = ORDER.filter((k) => rows.some((r) => r.counts[k]));
  const info = new Map<ClientId, string>();
  for (const r of results) {
    for (const x of r.results) info.set(x.client, `${x.library} ${x.version}, ${x.profile}`);
  }
  const out = [
    '### Outcomes per client',
    '',
    `| client | n | ${kinds.map(label).join(' | ')} | requests |`,
    `|---|--:|${kinds.map(() => '---|').join('')}--:|`,
    ...rows.map(
      (r) =>
        `| ${r.client} (${info.get(r.client)}) | ${r.n} | ${kinds
          .map((k) => (r.counts[k] ? cell(r.counts[k] ?? 0, r.n) : '0'))
          .join(' | ')} | ${r.requests} |`,
    ),
    '',
    '### Readable by host source',
    '',
    `| source | n | ${cs.join(' | ')} | any client |`,
    `|---|--:|${cs.map(() => '---|').join('')}---|`,
  ];
  for (const source of ['lab', 'playbook', 'all'] as const) {
    const rs = source === 'all' ? results : results.filter((r) => r.source === source);
    const any = rs.filter((r) => cs.some((c) => reads(r, c))).length;
    out.push(
      `| ${source} | ${rs.length} | ${cs.map((c) => cell(rs.filter((r) => reads(r, c)).length, rs.length)).join(' | ')} | ${cell(any, rs.length)} |`,
    );
  }
  out.push('', '### Walls by vendor', '', '| client | vendor/mode | hosts |', '|---|---|--:|');
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.walls).sort()) out.push(`| ${r.client} | ${k} | ${v} |`);
  }
  out.push(
    '',
    '### Pairwise overlap (readable)',
    '',
    '| A | B | n | both | only A | only B | neither |',
    '|---|---|--:|--:|--:|--:|--:|',
    ...overlap(results).map(
      (p) => `| ${p.a} | ${p.b} | ${p.n} | ${p.both} | ${p.onlyA} | ${p.onlyB} | ${p.neither} |`,
    ),
    '',
    'Hosts exactly one client reads:',
    '',
  );
  const only = onlyOne(results);
  for (const c of cs) out.push(`- ${c}: ${(only[c] ?? []).join(', ') || 'none'}`);
  out.push(
    '',
    '### Against the predecessor (curl_cffi) on the same hosts',
    '',
    `| predecessor record | value | n | ${cs.map((c) => `${c} readable`).join(' | ')} | any client | record dates |`,
    `|---|---|--:|${cs.map(() => '---|').join('')}---|---|`,
    ...predecessorTable(results).map(
      (p) =>
        `| ${p.basis} | ${p.value} | ${p.n} | ${cs.map((c) => cell(p.readable[c] ?? 0, p.n)).join(' | ')} | ${cell(p.any, p.n)} | ${p.dates} |`,
    ),
    '',
    '### Detail: walls, network errors, refusals, off-site redirects',
    '',
    '| client | detail | count |',
    '|---|---|--:|',
  );
  const detail = new Map<string, number>();
  for (const r of results) {
    for (const x of r.results) {
      const d = detailOf(x);
      if (d) detail.set(`${x.client} | ${d}`, (detail.get(`${x.client} | ${d}`) ?? 0) + 1);
    }
  }
  for (const [k, v] of [...detail].sort()) out.push(`| ${k} | ${v} |`);
  const s = requestStats(results);
  out.push(
    '',
    '### Requests and order',
    '',
    '| requests to a host | hosts |',
    '|--:|--:|',
    ...s.histogram.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `| client | requests | ${cs.map((_, i) => `position ${i + 1}`).join(' | ')} |`,
    `|---|--:|${cs.map(() => '--:|').join('')}`,
    ...cs.map(
      (c) =>
        `| ${c} | ${s.perClient[c] ?? 0} | ${cs.map((_, i) => s.positions[c]?.[i] ?? 0).join(' | ')} |`,
    ),
    '',
    `Hosts: ${s.hosts}. HTTP requests: ${s.total}. Most requests to one host: ${s.maxPerHost}; most by one client on one host: ${s.maxPerClientOnHost}. First host started ${s.firstStart}, last host finished ${s.lastEnd}.`,
  );
  return out.join('\n');
}

export async function readResults(files: string[]): Promise<HostResult[]> {
  const out: HostResult[] = [];
  for (const f of files) {
    for (const line of (await readFile(f, 'utf8')).split('\n')) {
      if (line.trim()) out.push(JSON.parse(line) as HostResult);
    }
  }
  return out;
}

if (import.meta.main) {
  console.info(renderMarkdown(await readResults(process.argv.slice(2))));
}
