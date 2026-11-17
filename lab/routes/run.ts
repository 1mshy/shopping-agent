// Live runner for spike C. Makes real requests: run it only on purpose.
//   pilot: node lab/routes/run.ts --limit 10 --out lab/out/routes/pilot
//   full:  node lab/routes/run.ts --out lab/out/routes/full
// Resumable: a domain that already has a line in <out>/<list>.jsonl is not probed again.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { DomainResult, ListKind } from './outcome.ts';
import { Pacer } from './pacer.ts';
import { type ProbeConfig, probeDomain } from './probe.ts';
import { mulberry32, shuffle } from './sample/random.ts';

/** Fixed, honest, and free of anything that identifies the person running it. */
export const USER_AGENT = 'agentic-dasher-lab/0.1 (route reachability probe)';
export const DEFAULTS = {
  maxRequests: 5,
  timeoutMs: 15_000,
  maxBytes: 3 * 1024 * 1024,
  maxHops: 3,
  maxInFlight: 12,
};
const ALL: ListKind[] = ['shopify', 'woocommerce', 'magento', 'searchaction'];

export async function readList(list: ListKind): Promise<string[]> {
  const text = await readFile(new URL(`./sample/${list}.txt`, import.meta.url), 'utf8');
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}

async function done(file: string): Promise<Set<string>> {
  if (!existsSync(file)) return new Set();
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l.trim());
  return new Set(lines.map((l) => (JSON.parse(l) as DomainResult).domain));
}

async function main(): Promise<void> {
  const { values: a } = parseArgs({
    options: {
      lists: { type: 'string', default: ALL.join(',') },
      limit: { type: 'string' },
      seed: { type: 'string', default: '20261117' },
      out: { type: 'string', default: 'lab/out/routes/full' },
    },
  });
  const lists = a.lists.split(',') as ListKind[];
  const limit = a.limit === undefined ? undefined : Number(a.limit);
  await mkdir(a.out, { recursive: true });
  const cfg: ProbeConfig = {
    userAgent: USER_AGENT,
    maxRequests: DEFAULTS.maxRequests,
    timeoutMs: DEFAULTS.timeoutMs,
    maxBytes: DEFAULTS.maxBytes,
    maxHops: DEFAULTS.maxHops,
    scheme: 'https',
    guard: {},
    pacer: new Pacer({ maxInFlight: DEFAULTS.maxInFlight }),
  };
  // Per list: the list order, or a seeded random `limit` for a pilot; then interleave lists.
  const queues: Array<Array<[ListKind, string]>> = [];
  for (const list of lists) {
    if (!ALL.includes(list)) throw new Error(`unknown list ${list}`);
    let hosts = await readList(list);
    if (limit !== undefined) hosts = shuffle(hosts, mulberry32(Number(a.seed))).slice(0, limit);
    const seen = await done(join(a.out, `${list}.jsonl`));
    queues.push(hosts.filter((h) => !seen.has(h)).map((h) => [list, h]));
  }
  const queue: Array<[ListKind, string]> = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (q[i]) queue.push(q[i] as [ListKind, string]);
  }
  console.info(`${queue.length} domains to probe; UA "${USER_AGENT}"; out ${a.out}`);
  let next = 0;
  let finished = 0;
  await Promise.all(
    Array.from({ length: DEFAULTS.maxInFlight }, async () => {
      while (next < queue.length) {
        const [list, domain] = queue[next++] as [ListKind, string];
        const r = await probeDomain(domain, list, cfg);
        await appendFile(join(a.out, `${list}.jsonl`), `${JSON.stringify(r)}\n`);
        const kinds = r.routes.map((x) => `${x.route}=${x.outcome.kind}`).join(' ');
        console.info(
          `[${++finished}/${queue.length}] ${list} ${domain} req=${r.requests} ${kinds}`,
        );
      }
    }),
  );
}

if (import.meta.main) await main();
