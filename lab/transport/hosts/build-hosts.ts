// Builds hosts.json, the spike A host list, from the predecessor's own records. Reads only:
//   scripts/browser-lab/stores.json            the 42 lab stores
//   scripts/browser-lab/results/results.jsonl  the product pages the browser lab opened
//   data/fetch_playbook.json                   host -> {strategy, at}; nothing else in data/ is read
//   reports/*.json                             price reads recorded by the predecessor's engine
// Makes no network request.
//   node lab/transport/hosts/build-hosts.ts --predecessor ~/Documents/GitHub/hermes-shopping
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { canonicalUrl, type HostEntry, type HostList, isSearchUrl } from './hosts.ts';

interface Store {
  key: string;
  group: string;
  host: string;
  query: string;
  prior_wall: string | null;
}
interface LabRow {
  ts: string;
  cell: string;
  store: string;
  stage: string;
  verdict?: string;
  price?: unknown;
  requested_url?: string | null;
  final_url?: string | null;
}
interface PricedRead {
  report: string;
  date: string;
  url: string;
  method: string | null;
}

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
const hostOf = (u: string) => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return undefined;
  }
};
const real = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);

/** Every record in a report that carries a URL and a non-empty price the engine read. */
function pricedReads(dir: string): PricedRead[] {
  const out: PricedRead[] = [];
  for (const f of readdirSync(dir).sort()) {
    const date = /^(\d{4}-\d{2}-\d{2})-.*\.json$/.exec(f)?.[1];
    if (!date) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const walk = (x: unknown, path: string) => {
      if (Array.isArray(x)) {
        for (const v of x) walk(v, `${path}[]`);
        return;
      }
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      const price = o.price;
      const priced = price !== null && price !== undefined && price !== '' && price !== 0;
      if (real(o.url) && priced && !path.includes('web_unreadable')) {
        out.push({
          report: f,
          date,
          url: o.url,
          method: typeof o.method === 'string' ? o.method : null,
        });
      }
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(doc, '$');
  }
  return out;
}

const rung = (m: string | null) =>
  m?.startsWith('http:') ? 'http' : m?.startsWith('browser:') ? 'browser' : 'unknown';

/**
 * The newest priced read of a product page on a host: the latest report date, preferring a
 * record that names its rung, then the first such record in file order. Search pages are skipped.
 */
function newestRead(reads: PricedRead[], host: string): PricedRead | undefined {
  const mine = reads.filter((r) => hostOf(r.url) === host && !isSearchUrl(r.url));
  const latest = mine
    .map((r) => r.date)
    .sort()
    .at(-1);
  const newest = mine.filter((r) => r.date === latest);
  return newest.find((r) => rung(r.method) !== 'unknown') ?? newest[0];
}

function main(): void {
  const { values: a } = parseArgs({
    options: {
      predecessor: { type: 'string' },
      out: { type: 'string', default: 'lab/transport/hosts/hosts.json' },
    },
  });
  if (!a.predecessor) throw new Error('usage: build-hosts.ts --predecessor <path> [--out file]');
  const root = a.predecessor;
  const lab = join(root, 'scripts/browser-lab');
  const stores = (JSON.parse(readFileSync(join(lab, 'stores.json'), 'utf8')) as { stores: Store[] })
    .stores;
  const rows = readFileSync(join(lab, 'results/results.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LabRow);
  const rawPlaybook = JSON.parse(
    readFileSync(join(root, 'data/fetch_playbook.json'), 'utf8'),
  ) as Record<string, { strategy?: unknown; at?: unknown }>;
  // Only host names and outcomes leave the playbook: strategy and the date it was recorded.
  const playbook = new Map<string, { strategy: string; date: string }>();
  for (const [h, v] of Object.entries(rawPlaybook)) {
    if (typeof v.strategy !== 'string' || typeof v.at !== 'number') continue;
    playbook.set(bare(h), {
      strategy: v.strategy,
      date: new Date(v.at * 1000).toISOString().slice(0, 10),
    });
  }
  const reads = pricedReads(join(root, 'reports'));
  const cellsOf = (key: string) =>
    new Set(rows.filter((r) => r.store === key && r.stage !== 'run').map((r) => r.cell)).size;

  const hosts: HostEntry[] = [];
  const excluded: HostList['excluded'] = [];
  const labHosts = new Set(stores.map((s) => bare(s.host)));
  for (const s of stores) {
    const priced = rows.filter(
      (r) =>
        r.store === s.key &&
        (r.stage === 'product' || r.stage === 'product_click') &&
        Boolean(r.price) &&
        (real(r.requested_url) || real(r.final_url)) &&
        !isSearchUrl(real(r.requested_url) ? r.requested_url : (r.final_url as string)),
    );
    const counts = new Map<string, { n: number; first: string }>();
    for (const r of priced) {
      const u = canonicalUrl(real(r.requested_url) ? r.requested_url : (r.final_url as string));
      const c = counts.get(u) ?? { n: 0, first: r.ts };
      counts.set(u, { n: c.n + 1, first: [r.ts, c.first].sort()[0] as string });
    }
    const best = [...counts].sort(([, x], [, y]) => y.n - x.n || x.first.localeCompare(y.first))[0];
    const host = bare(s.host);
    const priceCells = new Set(priced.map((r) => r.cell)).size;
    const read = newestRead(reads, host);
    const predecessor: HostEntry['predecessor'] = {
      playbook: playbook.get(host) ?? null,
      read: read
        ? {
            rung: rung(read.method),
            method: read.method,
            report: read.report,
            date: read.date,
            sameUrl: best !== undefined && canonicalUrl(read.url) === best[0],
          }
        : null,
      lab: { cellsTried: cellsOf(s.key), cellsWithPrice: priceCells },
    };
    if (!best && read) {
      // The lab reached no priced product page; the engine's own newest price read stands in.
      hosts.push({
        key: s.key,
        host: s.host,
        url: canonicalUrl(read.url),
        source: 'lab',
        group: s.group,
        urlFrom: `no priced product page in the browser lab; ${read.report}: price read by the engine (${read.method ?? 'method not recorded'})`,
        predecessor: {
          ...predecessor,
          read: {
            rung: rung(read.method),
            method: read.method,
            report: read.report,
            date: read.date,
            sameUrl: true,
          },
        },
      });
      continue;
    }
    if (!best) {
      excluded.push({
        key: s.key,
        host: s.host,
        source: 'lab',
        reason: 'the browser lab read no price on a product page of this store',
        predecessor,
      });
      continue;
    }
    hosts.push({
      key: s.key,
      host: s.host,
      url: best[0],
      source: 'lab',
      group: s.group,
      urlFrom: `browser lab product page with a price read (${best[1].n} of ${priced.length} priced rows, first ${best[1].first.slice(0, 10)})`,
      predecessor,
    });
  }
  for (const [host, entry] of [...playbook].sort(([x], [y]) => x.localeCompare(y))) {
    if (labHosts.has(host)) continue;
    const read = newestRead(reads, host);
    if (!read) continue; // no product URL with a price on record: left out, not invented
    const url = canonicalUrl(read.url);
    hosts.push({
      key: host,
      host: new URL(url).hostname,
      url,
      source: 'playbook',
      group: 'playbook',
      urlFrom: `${read.report}: price read by the engine (${read.method ?? 'method not recorded'})`,
      predecessor: {
        playbook: entry,
        read: {
          rung: rung(read.method),
          method: read.method,
          report: read.report,
          date: read.date,
          sameUrl: true,
        },
        lab: null,
      },
    });
  }
  const playbookHosts = [...playbook.keys()].filter((h) => !labHosts.has(h));
  const list: HostList = {
    version: 1,
    built: new Date().toISOString().slice(0, 10),
    predecessor: {
      path: '~/Documents/GitHub/hermes-shopping',
      branch: 'browser-agent',
      commit: '51db126',
      note: 'plus uncommitted files; the owner has not confirmed this copy',
    },
    counts: {
      labStores: stores.length,
      labWithUrl: hosts.filter((h) => h.source === 'lab').length,
      playbookHosts: playbook.size,
      playbookOutsideLab: playbookHosts.length,
      playbookWithUrl: hosts.filter((h) => h.source === 'playbook').length,
    },
    hosts,
    excluded,
  };
  writeFileSync(a.out, `${JSON.stringify(list, null, 2)}\n`);
  console.info(
    `${hosts.length} hosts with a URL (${list.counts.labWithUrl} lab, ${list.counts.playbookWithUrl} playbook); ${excluded.length} lab stores excluded; written to ${a.out}`,
  );
}

if (import.meta.main) main();
