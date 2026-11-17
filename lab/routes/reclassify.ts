// Offline re-classification: re-runs the current classifier on the evidence stored with each
// result. Makes no request. Routes decided without the classifier (network errors, refusals,
// skips, an absent OpenSearch link) are left as they are.
//   node lab/routes/reclassify.ts --out lab/out/routes/full-reclassified lab/out/routes/full/*.jsonl
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { classifyObserved, detectWallObserved } from './classify.ts';
import { hostPlatforms, observedFrom, validationFrom } from './evidence.ts';
import type { DomainResult, Platform, RouteKind, RouteResult } from './outcome.ts';
import { readResults } from './summarise.ts';

const PLATFORM: Record<RouteKind, Platform> = {
  woo_store_search: 'woocommerce',
  magento_graphql: 'magento',
  shopify_suggest: 'shopify',
  shopify_product_js: 'shopify',
  home_searchaction: 'any',
  opensearch: 'any',
};

export function reclassifyRoute(
  r: RouteResult,
  host: Array<Exclude<Platform, 'any'>> = [],
): RouteResult {
  const o = observedFrom(r.evidence);
  const v = validationFrom(r.evidence);
  if (!o || !v) return r;
  const c = classifyObserved(o, v, PLATFORM[r.route], host);
  return { ...r, outcome: c.outcome, evidence: { ...r.evidence, signals: c.signals } };
}

/**
 * robots.txt again from its stored answer (robots.ts rules). Verdicts that do not depend on the
 * rules (absent: allow all; unreachable: disallow all; unknown) are re-derived; a robots.txt that
 * would now be `parsed` cannot be, since its rules are not stored, and is left as it was.
 */
function reclassifyRobots(r: DomainResult): DomainResult {
  const e = r.robots.evidence;
  const o = e ? observedFrom(e) : undefined;
  if (!o) return r;
  const walled = detectWallObserved(o) !== undefined;
  const outcome =
    o.status < 300 && !walled
      ? 'ok'
      : classifyObserved(o, { valid: false, reason: 'robots' }, 'any').outcome.kind;
  const state = walled
    ? 'unknown'
    : o.status >= 500
      ? 'unreachable'
      : o.status >= 400
        ? 'absent'
        : 'parsed';
  if (state === 'parsed' && r.robots.state !== 'parsed') return r;
  const verdict = { unknown: 'unknown', unreachable: 'disallowed', absent: 'allowed' } as const;
  return {
    ...r,
    robots: { ...r.robots, state, outcome },
    routes:
      state === 'parsed' || state === r.robots.state
        ? r.routes
        : r.routes.map((x) => ({ ...x, robots: verdict[state] })),
  };
}

export function reclassifyResult(r: DomainResult): DomainResult {
  const robots = reclassifyRobots(r);
  const host = hostPlatforms(robots.robots.evidence);
  return { ...robots, routes: robots.routes.map((x) => reclassifyRoute(x, host)) };
}

/** What changed, as `list route domain: before -> after` (robots state as route `robots.txt`). */
export function changes(before: DomainResult[], after: DomainResult[]): string[] {
  const out: string[] = [];
  before.forEach((b, i) => {
    const a = after[i];
    if (a && a.robots.state !== b.robots.state) {
      out.push(`${b.list} robots.txt ${b.domain}: ${b.robots.state} -> ${a.robots.state}`);
    }
    b.routes.forEach((x, j) => {
      const y = a?.routes[j];
      if (y && JSON.stringify(x.outcome) !== JSON.stringify(y.outcome)) {
        out.push(
          `${b.list} ${x.route} ${b.domain}: ${JSON.stringify(x.outcome)} -> ${JSON.stringify(y.outcome)}`,
        );
      }
    });
  });
  return out;
}

async function main(): Promise<void> {
  const { values: a, positionals: files } = parseArgs({
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  if (!a.out || files.length === 0) {
    throw new Error('usage: reclassify.ts --out <dir> <results.jsonl...>');
  }
  await mkdir(a.out, { recursive: true });
  let changed = 0;
  for (const f of files) {
    const before = await readResults([f]);
    const old = before.filter((r) => r.v !== 2).length;
    if (old > 0) throw new Error(`${f}: ${old} lines are not v2 and carry no classifier input`);
    const after = before.map(reclassifyResult);
    const diff = changes(before, after);
    changed += diff.length;
    for (const d of diff) console.info(d);
    const text = after.map((r) => JSON.stringify(r)).join('\n');
    await writeFile(join(a.out, basename(f)), `${text}\n`);
  }
  console.info(`${changed} changes; written to ${a.out}`);
}

if (import.meta.main) await main();
