// Checks the core image against the release budgets in budgets.json (S§5.14).
// Usage: node scripts/check-image-budgets.ts <image>
// Exits 1 when any budget is exceeded. Writes a Markdown table to $GITHUB_STEP_SUMMARY in CI.
//
// Sizes come from `docker export` of a created container (the flattened filesystem), so they
// do not depend on whether the Docker daemon uses the classic or the containerd image store.
// "Pull" is that tarball gzipped, a close stand-in for the registry's gzip layers.

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createGzip } from 'node:zlib';

interface Budgets {
  image: { pullMB: number; unpackedMB: number };
  runtime: { idleRssMB: number; startToHealthyMs: number };
}

interface Row {
  metric: string;
  value: number;
  budget: number;
  unit: 'MB' | 'ms';
}

const MB = 1_000_000;
const IDLE_SETTLE_MS = 5_000;
const HEALTH_TIMEOUT_MS = 30_000;

const image = process.argv[2];
if (!image) {
  console.error('usage: node scripts/check-image-budgets.ts <image>');
  process.exit(2);
}
const budgets = JSON.parse(
  readFileSync(new URL('../budgets.json', import.meta.url), 'utf8'),
) as Budgets;

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

async function filesystemSizes(img: string): Promise<{ raw: number; gz: number }> {
  const id = docker('create', img);
  try {
    let raw = 0;
    let gz = 0;
    const exp = spawn('docker', ['export', id], { stdio: ['ignore', 'pipe', 'inherit'] });
    const gzip = createGzip({ level: 6 });
    exp.stdout.on('data', (chunk: Buffer) => {
      raw += chunk.length;
    });
    gzip.on('data', (chunk: Buffer) => {
      gz += chunk.length;
    });
    exp.stdout.pipe(gzip);
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        exp.on('error', reject);
        exp.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`docker export exited ${code}`)),
        );
      }),
      new Promise<void>((resolve, reject) => {
        gzip.on('end', resolve);
        gzip.on('error', reject);
      }),
    ]);
    return { raw, gz };
  } finally {
    docker('rm', '-f', id);
  }
}

/** Parses `docker stats` sizes such as "45.3MiB" or "120MB" into bytes. */
function parseSize(text: string): number {
  const m = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(text.trim());
  if (!m?.[1] || !m[2]) throw new Error(`cannot parse size: ${text}`);
  const units: Record<string, number> = {
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  const factor = units[m[2].toLowerCase()];
  if (factor === undefined) throw new Error(`unknown unit: ${m[2]}`);
  return Number(m[1]) * factor;
}

async function runtimeMetrics(img: string) {
  const t0 = performance.now();
  const id = docker('run', '-d', '--init', '-p', '127.0.0.1::8080', img);
  try {
    const hostPort = docker('port', id, '8080/tcp').split('\n')[0]?.split(':').pop();
    const url = `http://127.0.0.1:${hostPort}/api/health`;
    let startMs: number | undefined;
    let health: { rssBytes?: number; version?: string } = {};
    while (performance.now() - t0 < HEALTH_TIMEOUT_MS) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          startMs = performance.now() - t0;
          break;
        }
      } catch {
        // not listening yet
      }
      await sleep(25);
    }
    if (startMs === undefined) {
      console.error(docker('logs', id));
      throw new Error(`container did not become healthy within ${HEALTH_TIMEOUT_MS} ms`);
    }
    await sleep(IDLE_SETTLE_MS);
    health = (await (await fetch(url)).json()) as typeof health;
    const usage = docker('stats', '--no-stream', '--format', '{{.MemUsage}}', id).split('/')[0];
    return {
      startMs,
      containerMem: parseSize(usage ?? ''),
      nodeRss: health.rssBytes,
      version: health.version,
    };
  } finally {
    docker('rm', '-f', id);
  }
}

const sizes = await filesystemSizes(image);
const rt = await runtimeMetrics(image);

const rows: Row[] = [
  { metric: 'Core pull (gzip)', value: sizes.gz / MB, budget: budgets.image.pullMB, unit: 'MB' },
  {
    metric: 'Core unpacked',
    value: sizes.raw / MB,
    budget: budgets.image.unpackedMB,
    unit: 'MB',
  },
  {
    metric: 'Idle memory (container)',
    value: rt.containerMem / MB,
    budget: budgets.runtime.idleRssMB,
    unit: 'MB',
  },
  {
    metric: 'Start to healthy',
    value: rt.startMs,
    budget: budgets.runtime.startToHealthyMs,
    unit: 'ms',
  },
];

const failed = rows.filter((r) => r.value > r.budget);
const fmt = (n: number, unit: Row['unit']) => (unit === 'MB' ? n.toFixed(1) : n.toFixed(0));
const table = [
  `### Image budgets: \`${image}\` (version ${rt.version ?? '?'})`,
  '',
  '| Metric | Value | Budget | |',
  '|---|--:|--:|---|',
  ...rows.map(
    (r) =>
      `| ${r.metric} | ${fmt(r.value, r.unit)} ${r.unit} | ${r.budget} ${r.unit} | ${r.value > r.budget ? '❌' : '✅'} |`,
  ),
  '',
  `Node process RSS at idle (from /api/health): ${rt.nodeRss ? (rt.nodeRss / MB).toFixed(1) : '?'} MB.`,
  '',
].join('\n');

console.info(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);

if (failed.length > 0) {
  console.error(`Budget exceeded: ${failed.map((r) => r.metric).join(', ')}`);
  process.exit(1);
}
