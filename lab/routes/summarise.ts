// Turns raw result files (JSON lines of DomainResult) into the report tables.
//   node lab/routes/summarise.ts lab/out/routes/pilot/*.jsonl
import { readFile } from 'node:fs/promises';
import { platformSignalsObserved } from './classify.ts';
import { observedFrom } from './evidence.ts';
import type { DomainResult, Evidence, OutcomeKind } from './outcome.ts';

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
  /** Disallowed by a rule in a parsed robots.txt. */
  disallowedByRule: number;
  /** Disallowed because robots.txt was unreachable (5xx or network error: disallow all). */
  disallowedUnreachable: number;
  /** Disallowed, and the route had in fact answered (ok or empty). */
  disallowedAnswered: number;
  /** No verdict (robots.txt walled, off-site, or not reached for policy reasons). */
  unknown: number;
  answered: number;
  answeredUnderRespect: number;
}
export interface PlatformRow {
  list: string;
  route: string;
  n: number;
  notPlatform: number;
  /** Answers among hosts whose route did not come back `not_platform`. */
  nExcl: number;
  answersExcl: number;
  /** Answers among hosts with positive evidence of the platform (an answer or a platform signal). */
  nConfirmed: number;
  answersConfirmed: number;
}

export const pct = (k: number, n: number) => (n === 0 ? 'n/a' : `${((100 * k) / n).toFixed(1)}%`);
const cell = (k: number, n: number) => `${k} (${pct(k, n)})`;
const answered = (k: OutcomeKind) => k === 'ok' || k === 'empty';

type Route = DomainResult['routes'][number];

function byRoute(results: DomainResult[]) {
  const groups = new Map<string, Array<{ route: Route; host: DomainResult }>>();
  for (const r of results) {
    for (const route of r.routes) {
      const key = `${r.list}\t${route.route}`;
      groups.set(key, [...(groups.get(key) ?? []), { route, host: r }]);
    }
  }
  return [...groups].map(([key, items]) => {
    const [list = '', route = ''] = key.split('\t');
    return { list, route, routes: items.map((x) => x.route), items };
  });
}

const LIST_PLATFORM = {
  shopify: 'shopify',
  woocommerce: 'woocommerce',
  magento: 'magento',
} as const;

/** Every stored answer of a host: robots.txt, each route, and the Shopify home-page discovery. */
function hostEvidence(r: DomainResult): Evidence[] {
  const out: Evidence[] = [];
  if (r.robots.evidence) out.push(r.robots.evidence);
  for (const x of r.routes) {
    out.push(x.evidence);
    if (x.discovery) out.push(x.discovery);
  }
  return out;
}

/** Positive evidence that the host runs its list's platform: an answer or a platform signal. */
export function confirmedPlatform(r: DomainResult): boolean {
  const p = LIST_PLATFORM[r.list as keyof typeof LIST_PLATFORM];
  if (!p) return false;
  if (r.routes.some((x) => answered(x.outcome.kind))) return true;
  return hostEvidence(r).some((e) => {
    const o = observedFrom(e);
    return o !== undefined && platformSignalsObserved(o).includes(p);
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
  return byRoute(results).map(({ list, route, routes, items }) => {
    const ans = routes.filter((r) => answered(r.outcome.kind));
    const dis = items.filter((x) => x.route.robots === 'disallowed');
    return {
      list,
      route,
      n: routes.length,
      disallowed: dis.length,
      disallowedByRule: dis.filter((x) => x.host.robots.state === 'parsed').length,
      disallowedUnreachable: dis.filter((x) => x.host.robots.state === 'unreachable').length,
      disallowedAnswered: dis.filter((x) => answered(x.route.outcome.kind)).length,
      unknown: routes.filter((r) => r.robots === 'unknown').length,
      answered: ans.length,
      answeredUnderRespect: ans.filter((r) => r.robots === 'allowed').length,
    };
  });
}

/** Answer rates for the platform lists with the wrong-platform hosts taken out, two ways. */
export function platformRates(results: DomainResult[]): PlatformRow[] {
  return byRoute(results)
    .filter(({ list }) => list in LIST_PLATFORM)
    .map(({ list, route, items }) => {
      const excl = items.filter((x) => x.route.outcome.kind !== 'not_platform');
      const conf = items.filter((x) => confirmedPlatform(x.host));
      return {
        list,
        route,
        n: items.length,
        notPlatform: items.length - excl.length,
        nExcl: excl.length,
        answersExcl: excl.filter((x) => answered(x.route.outcome.kind)).length,
        nConfirmed: conf.length,
        answersConfirmed: conf.filter((x) => answered(x.route.outcome.kind)).length,
      };
    });
}

const platformsSeen = (signals: string[]) =>
  signals
    .filter((s) => s.startsWith('platform:') || s.startsWith('host:platform:'))
    .map((s) => (s.startsWith('host:') ? `${s.slice(14)} (on robots.txt)` : s.slice(9)))
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
    '### Platform lists: answers with the wrong-platform hosts taken out',
    '',
    '`not_platform` excluded: n = hosts whose route did not come back `not_platform`. Confirmed: n = hosts with positive evidence of the list platform (any route answered, or a platform header, cookie or page marker on any stored response, robots.txt included).',
    '',
    '| list | route | n | not_platform | n (not_platform excluded) | answers | n (confirmed platform) | answers |',
    '|---|---|---|---|---|---|---|---|',
    ...platformRates(results).map(
      (r) =>
        `| ${r.list} | ${r.route} | ${r.n} | ${cell(r.notPlatform, r.n)} | ${r.nExcl} | ${cell(r.answersExcl, r.nExcl)} | ${r.nConfirmed} | ${cell(r.answersConfirmed, r.nConfirmed)} |`,
    ),
    '',
    '### robots.txt `respect` counterfactual (probed in `report` mode)',
    '',
    '| list | route | n | robots disallows | by a rule | by unreachable robots.txt | disallowed but answered | no verdict | answered | answered and allowed by robots |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...robotsCounterfactual(results).map(
      (r) =>
        `| ${r.list} | ${r.route} | ${r.n} | ${cell(r.disallowed, r.n)} | ${r.disallowedByRule} | ${r.disallowedUnreachable} | ${r.disallowedAnswered} | ${cell(r.unknown, r.n)} | ${cell(r.answered, r.n)} | ${cell(r.answeredUnderRespect, r.n)} |`,
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
  const hist = new Map<number, number>();
  for (const r of results) hist.set(r.requests, (hist.get(r.requests) ?? 0) + 1);
  const starts = results.map((r) => Date.parse(r.startedAt));
  const ends = results.map((r) => Date.parse(r.startedAt) + r.ms);
  const span = (k: number[], f: (...x: number[]) => number) =>
    k.length ? new Date(f(...k)).toISOString() : 'n/a';
  out.push(
    '',
    '### Requests per host',
    '',
    '| requests | hosts |',
    '|---|---|',
    ...[...hist].sort(([a], [b]) => a - b).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `Domains: ${results.length}. HTTP requests: ${reqs}. Most requests to one host: ${Math.max(0, ...hist.keys())}. First host started ${span(starts, Math.min)}, last host finished ${span(ends, Math.max)}. User-Agent: ${uas.map((u) => `\`${u}\``).join(', ')}.`,
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
