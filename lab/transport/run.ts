// Live runner for spike A. Makes real requests: run it only on purpose.
//   pilot: node lab/transport/run.ts --pilot 6 --out lab/out/transport/pilot
//   full:  node lab/transport/run.ts --out lab/out/transport/full --skip lab/out/transport/pilot/results.jsonl
// Resumable: a host that already has a line in <out>/results.jsonl is not probed again.
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Pacer } from '../routes/pacer.ts';
import { mulberry32, shuffle } from '../routes/sample/random.ts';
import { createTransports } from './clients/index.ts';
import { readHosts } from './hosts/hosts.ts';
import { PER_CLIENT_CAP, type ProbeConfig, probeHost } from './probe.ts';
import type { HostResult } from './result.ts';

export const LIMITS = {
  timeoutMs: 15_000,
  maxBytes: 3 * 1024 * 1024,
  maxHops: 3,
  maxInFlight: 12,
  maxHosts: 75,
};

async function keysIn(file: string): Promise<Set<string>> {
  if (!existsSync(file)) return new Set();
  const lines = (await readFile(file, 'utf8')).split('\n').filter((l) => l.trim());
  return new Set(lines.map((l) => (JSON.parse(l) as HostResult).key));
}

/** Every client walled or rate limited on this host. */
const shutOut = (r: HostResult) =>
  r.results.every((x) => x.outcome.kind === 'wall' || x.outcome.kind === 'rate_limited');

async function main(): Promise<void> {
  const { values: a } = parseArgs({
    options: {
      out: { type: 'string', default: 'lab/out/transport/full' },
      pilot: { type: 'string' },
      seed: { type: 'string', default: '20261118' },
      skip: { type: 'string', multiple: true, default: [] },
    },
  });
  const list = readHosts();
  if (list.hosts.length > LIMITS.maxHosts) throw new Error('host list above the plan cap');
  // The rotation index is the host's position in the committed list, stable across resumes.
  let queue = list.hosts.map((entry, index) => ({ entry, index }));
  if (a.pilot !== undefined) {
    queue = shuffle(queue, mulberry32(Number(a.seed))).slice(0, Number(a.pilot));
  }
  const skip = new Set<string>();
  for (const f of a.skip) for (const k of await keysIn(f)) skip.add(k);
  await mkdir(a.out, { recursive: true });
  const file = join(a.out, 'results.jsonl');
  const done = await keysIn(file);
  queue = queue.filter((q) => !done.has(q.entry.key) && !skip.has(q.entry.key));
  const transports = createTransports();
  const cfg: ProbeConfig = {
    timeoutMs: LIMITS.timeoutMs,
    maxBytes: LIMITS.maxBytes,
    maxHops: LIMITS.maxHops,
    guard: {},
    pacer: new Pacer({ maxInFlight: LIMITS.maxInFlight }),
    bodyDir: a.out,
  };
  const clients = transports.map((t) => t.info);
  await writeFile(
    join(a.out, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        argv: process.argv.slice(2),
        node: process.versions.node,
        clients,
        limits: {
          ...LIMITS,
          perClientCap: PER_CLIENT_CAP,
          perHostCap: PER_CLIENT_CAP * clients.length,
        },
        hosts: queue.map((q) => q.entry.key),
        alreadyDone: done.size,
        skipped: [...skip],
      },
      null,
      2,
    )}\n`,
  );
  console.info(
    `${queue.length} hosts to probe (${done.size} already done, ${skip.size} skipped); clients ${clients
      .map((c) => `${c.id}=${c.library}@${c.version}/${c.profile}`)
      .join(' ')}; out ${a.out}`,
  );
  let next = 0;
  let finished = done.size;
  let stopped = false;
  const firstTwenty: HostResult[] = [];
  await Promise.all(
    Array.from({ length: LIMITS.maxInFlight }, async () => {
      while (!stopped && next < queue.length) {
        const { entry, index } = queue[next++] as (typeof queue)[number];
        const r = await probeHost(entry, transports, index, cfg);
        await appendFile(file, `${JSON.stringify(r)}\n`);
        const kinds = r.results.map((x) => `${x.client}=${x.outcome.kind}`).join(' ');
        console.info(
          `[${++finished}] ${entry.key} req=${r.requests} order=${r.order.join(',')} ${kinds}`,
        );
        if (firstTwenty.length < 20) {
          firstTwenty.push(r);
          const out = firstTwenty.filter(shutOut).length;
          // Plan stop rule: more than a third of the first 20 hosts walled or rate limited for
          // every client. Checked as results arrive, so it can fire before the 20th host.
          if (out > 20 / 3) {
            stopped = true;
            console.error(
              `STOP: ${out} of the first ${firstTwenty.length} hosts shut out for every client`,
            );
          }
        }
      }
    }),
  );
  for (const t of transports) await t.close();
  console.info(
    `done at ${new Date().toISOString()}${stopped ? ' (stopped by the stop rule)' : ''}`,
  );
  if (stopped) process.exitCode = 2;
}

if (import.meta.main) await main();
