// Turns raw result files (JSON lines of DomainResult) into the report tables.
//   node lab/routes/summarise.ts lab/out/routes/pilot/*.jsonl
import { readFile } from 'node:fs/promises';
import type { DomainResult, OutcomeKind } from './outcome.ts';

const ORDER: OutcomeKind[] = [
  'ok',
  'empty',
  'wall',
  'rate_limited',
  'login_required',
  'payment_required',
  'forbidden',
  'client_error',
  'not_found',
  'not_platform',
  'off_site_redirect',
  'invalid_payload',
  'server_error',
  'network_error',
  'refused_by_policy',
  'skipped',
];

export interface Row {
  list: string;
  route: string;
  n: number;
  counts: Partial<Record<OutcomeKind, number>>;
}
export interface RobotsRow {
  list: string;
  route: string;
  n: number;
  disallowed: number;
  answered: number;
  answeredUnderRespect: number;
}

export const pct = (k: number, n: number) => (n === 0 ? 'n/a' : `${((100 * k) / n).toFixed(1)}%`);
const cell = (k: number, n: number) => `${k} (${pct(k, n)})`;
const answered = (k: OutcomeKind) => k === 'ok' || k === 'empty';

function byRoute(results: DomainResult[]) {
  const groups = new Map<string, Array<DomainResult['routes'][number]>>();
  for (const r of results) {
    for (const route of r.routes) {
      const key = `${r.list}\t${route.route}`;
      groups.set(key, [...(groups.get(key) ?? []), route]);
    }
  }
  return [...groups].map(([key, routes]) => {
    const [list = '', route = ''] = key.split('\t');
    return { list, route, routes };
  });
}

export function tabulate(results: DomainResult[]): Row[] {
  return byRoute(results).map(({ list, route, routes }) => {
    const counts: Row['counts'] = {};
    for (const r of routes) counts[r.outcome.kind] = (counts[r.outcome.kind] ?? 0) + 1;
    return { list, route, n: routes.length, counts };
  });
}

/** What `respect` would have cost: routes that answered but robots.txt disallowed. */
export function robotsCounterfactual(results: DomainResult[]): RobotsRow[] {
  return byRoute(results).map(({ list, route, routes }) => {
    const ans = routes.filter((r) => answered(r.outcome.kind));
    return {
      list,
      route,
      n: routes.length,
      disallowed: routes.filter((r) => r.robots === 'disallowed').length,
      answered: ans.length,
      answeredUnderRespect: ans.filter((r) => r.robots === 'allowed').length,
    };
  });
}

const platformsSeen = (signals: string[]) =>
  signals
    .filter((s) => s.startsWith('platform:'))
    .map((s) => s.slice(9))
    .join('+') || 'none';

export function renderMarkdown(results: DomainResult[]): string {
  const rows = tabulate(results);
  const kinds = ORDER.filter((k) => rows.some((r) => r.counts[k]));
  const out = [
    '### Outcomes per list and route',
    '',
    `| list | route | n | answers (ok+empty) | ${kinds.join(' | ')} |`,
    `|---|---|---|---|${kinds.map(() => '---|').join('')}`,
    ...rows.map((r) => {
      const ans = (r.counts.ok ?? 0) + (r.counts.empty ?? 0);
      const cells = kinds.map((k) => (r.counts[k] ? cell(r.counts[k] ?? 0, r.n) : '0'));
      return `| ${r.list} | ${r.route} | ${r.n} | ${cell(ans, r.n)} | ${cells.join(' | ')} |`;
    }),
    '',
    '### robots.txt `respect` counterfactual (probed in `report` mode)',
    '',
    '| list | route | n | robots disallows | answered | answered and allowed by robots |',
    '|---|---|---|---|---|---|',
    ...robotsCounterfactual(results).map(
      (r) =>
        `| ${r.list} | ${r.route} | ${r.n} | ${cell(r.disallowed, r.n)} | ${cell(r.answered, r.n)} | ${cell(r.answeredUnderRespect, r.n)} |`,
    ),
    '',
    '### Detail: walls by vendor, errors by code, refusals by reason, platform seen on 404s',
    '',
    '| list | route | detail | count |',
    '|---|---|---|---|',
  ];
  const detail = new Map<string, number>();
  for (const r of results) {
    for (const x of r.routes) {
      const o = x.outcome;
      const d =
        o.kind === 'wall'
          ? `wall ${o.vendor}/${o.mode}`
          : o.kind === 'network_error'
            ? `network_error ${o.code}`
            : o.kind === 'refused_by_policy' || o.kind === 'skipped'
              ? `${o.kind} ${o.reason}`
              : o.kind === 'not_platform' || o.kind === 'not_found'
                ? `${o.kind}, platform seen: ${platformsSeen(x.evidence.signals)}`
                : undefined;
      if (d)
        detail.set(
          `${r.list} | ${x.route} | ${d}`,
          (detail.get(`${r.list} | ${x.route} | ${d}`) ?? 0) + 1,
        );
    }
  }
  for (const [k, v] of [...detail].sort()) out.push(`| ${k} | ${v} |`);
  const robotsStates = new Map<string, number>();
  for (const r of results) {
    const k = `${r.list} | ${r.robots.state}`;
    robotsStates.set(k, (robotsStates.get(k) ?? 0) + 1);
  }
  out.push('', '### robots.txt fetch per list', '', '| list | state | count |', '|---|---|---|');
  for (const [k, v] of [...robotsStates].sort()) out.push(`| ${k} | ${v} |`);
  const reqs = results.reduce((s, r) => s + r.requests, 0);
  const uas = [...new Set(results.map((r) => r.userAgent))];
  out.push(
    '',
    `Domains: ${results.length}. HTTP requests: ${reqs}. User-Agent: ${uas.map((u) => `\`${u}\``).join(', ')}.`,
  );
  return out.join('\n');
}

export async function readResults(files: string[]): Promise<DomainResult[]> {
  const out: DomainResult[] = [];
  for (const f of files) {
    for (const line of (await readFile(f, 'utf8')).split('\n')) {
      if (line.trim()) out.push(JSON.parse(line) as DomainResult);
    }
  }
  return out;
}

if (import.meta.main) {
  console.info(renderMarkdown(await readResults(process.argv.slice(2))));
}
