// One host, every client: one GET of the host's product URL per client, one client after another,
// in an order rotated across hosts, each through the guard and the shared per-host pacer.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Budget } from '../routes/http.ts';
import { type GetConfig, guardedGet } from './get.ts';
import type { HostEntry } from './hosts/hosts.ts';
import { type ClientResult, classifyAnswer, type HostResult } from './result.ts';
import type { ClientId, HttpTransport } from './transport.ts';

/** Per client: 1 request + at most 3 redirect hops + 1 retry (S§5.1 limits, plan P0 spike A). */
export const PER_CLIENT_CAP = 5;

export interface ProbeConfig extends GetConfig {
  /** Where gzipped bodies go (`<dir>/bodies/<sha256>.gz`); omitted = bodies are not stored. */
  bodyDir?: string;
}

/** The client order for the i-th host: the base order rotated by i, so none always goes first. */
export function rotation<T>(base: readonly T[], i: number): T[] {
  const k = ((i % base.length) + base.length) % base.length;
  return [...base.slice(k), ...base.slice(0, k)];
}

async function storeBody(dir: string, raw: Uint8Array): Promise<{ path: string; sha256: string }> {
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const path = `bodies/${sha256}.gz`;
  const file = join(dir, path);
  if (!existsSync(file)) {
    await mkdir(join(dir, 'bodies'), { recursive: true });
    await writeFile(file, gzipSync(raw));
  }
  return { path, sha256 };
}

export async function probeHost(
  entry: HostEntry,
  transports: HttpTransport[],
  index: number,
  cfg: ProbeConfig,
): Promise<HostResult> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const byId = new Map<ClientId, HttpTransport>(transports.map((t) => [t.info.id, t]));
  const order = rotation(
    transports.map((t) => t.info.id),
    index,
  );
  const hostBudget = new Budget(PER_CLIENT_CAP * transports.length);
  const results: ClientResult[] = [];
  for (const [position, id] of order.entries()) {
    const transport = byId.get(id) as HttpTransport;
    const clientBudget = new Budget(PER_CLIENT_CAP);
    const started = new Date().toISOString();
    const r = await guardedGet(entry.url, transport, cfg, [hostBudget, clientBudget]);
    const head = {
      client: id,
      library: transport.info.library,
      version: transport.info.version,
      profile: transport.info.profile,
      position,
      startedAt: started,
      ms: r.ms,
      requests: r.requests,
      chain: r.chain,
      facts: r.facts,
    };
    if (r.ok) {
      const c = classifyAnswer(r.res, r.hops, r.ms);
      const body = cfg.bodyDir ? await storeBody(cfg.bodyDir, r.raw) : undefined;
      results.push({
        ...head,
        outcome: c.outcome,
        evidence: { ...c.evidence, ...(body ? { body: body.path, sha256: body.sha256 } : {}) },
      });
    } else {
      results.push({
        ...head,
        outcome: r.outcome,
        evidence: { finalUrl: r.finalUrl, signals: [], hops: r.hops, ms: r.ms },
      });
    }
  }
  return {
    v: 1,
    key: entry.key,
    host: entry.host,
    url: entry.url,
    source: entry.source,
    group: entry.group,
    predecessor: entry.predecessor,
    order,
    startedAt,
    ms: Math.round(performance.now() - t0),
    requests: hostBudget.used,
    results,
  };
}
