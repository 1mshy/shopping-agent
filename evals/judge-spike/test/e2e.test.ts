// End to end: `node evals/judge-spike/run.ts` against a scripted OpenAI-compatible server on
// 127.0.0.1, then `node evals/judge-spike/report.ts` on what it wrote. The key is made up, lives in
// a made-up variable, and the child gets a scrubbed environment. Everything is synthetic.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { secretsIn } from '../../wire/leak-check.ts';
import { DATASET } from '../dataset.ts';
import { composeBatches } from '../lib/batches.ts';
import { completion, startScriptedJudge, verdicts } from './scripted-judge.ts';

const RUN_TS = new URL('../run.ts', import.meta.url).pathname;
const REPORT_TS = new URL('../report.ts', import.meta.url).pathname;
const KEY_VAR = 'JUDGE_SPIKE_E2E_MADE_UP_TOKEN';
// Made up; shares no 8-character run with the paths and labels the test writes.
const KEY = 'Vb4Jw8Zq2Xm6Tr9Kd3Hy';

let out: string;
let server: Awaited<ReturnType<typeof startScriptedJudge>>;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'judge-spike-e2e-'));
  // The first call's reply is not JSON, to exercise the repair; the rest are valid.
  server = await startScriptedJudge((ids, n) => ({
    body: completion(n === 1 ? 'I think they are all fine.' : verdicts(ids)),
  }));
});
afterAll(async () => {
  await server.close();
  await rm(out, { recursive: true, force: true });
});

type Exec = { code: number; stdout: string; stderr: string };
async function node(args: string[], extraEnv: Record<string, string> = {}): Promise<Exec> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, args, {
      env: { PATH: process.env.PATH ?? '', ...extraEnv },
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function allFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir, { recursive: true, withFileTypes: true });
  return names.filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
}

describe('the CLI end to end against a scripted server', () => {
  let runDir = '';
  let run: Exec;

  it('runs the plan, repairs once, and keeps the key out of every file and output', async () => {
    run = await node(
      [
        RUN_TS,
        ...['--base-url', `${server.origin}/v1`, '--model', 'scripted/judge', '--label', 'e2e'],
        ...['--api-key-env', KEY_VAR, '--batch-sizes', '5,15', '--trials', '2', '--seed', '7'],
        ...['--max-calls', '1000', '--max-input-tokens', '50000000', '--deadline-ms', '120000'],
        ...['--max-spend-nanos', '1000000000', '--currency', 'USD'],
        ...['--price-input-nanos-per-mtok', '150000000'],
        ...['--price-output-nanos-per-mtok', '600000000'],
        ...['--out', out, '--owner-approved', '--synthetic'],
      ],
      { [KEY_VAR]: KEY },
    );
    expect(run.code, run.stderr).toBe(0);
    expect(secretsIn(`${run.stdout}${run.stderr}`, [KEY])).toBe(false);
    // The key went to the server, and only there.
    expect(server.calls.every((c) => c.authorization === `Bearer ${KEY}`)).toBe(true);
    const planned = composeBatches(DATASET, { batchSizes: [5, 15], trials: 2, seed: 7 }).length;
    expect(server.calls).toHaveLength(planned + 1);

    const dirs = await readdir(out);
    expect(dirs).toHaveLength(1);
    runDir = join(out, dirs[0] as string);
    for (const f of await allFiles(out)) {
      expect(secretsIn(await readFile(f, 'utf8'), [KEY]), f).toBe(false);
    }
    const items = (await readFile(join(runDir, 'items.jsonl'), 'utf8')).trim().split('\n');
    // 158 items x 2 batch sizes x 2 trials.
    expect(items).toHaveLength(632);
    const meta = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
    expect(meta.synthetic).toBe(true);
    expect(meta.promptVersion).toBe('judge.v1');
  });

  it('feeds the report generator, which labels the run synthetic and refuses a draft from it', async () => {
    const report = await node([REPORT_TS, runDir]);
    expect(report.code, report.stderr).toBe(0);
    expect(report.stdout).toMatch(/SYNTHETIC/);
    expect(report.stdout).toMatch(/Precision of exact/);
    expect(report.stdout).toMatch(/False accepts by error class/);
    expect(report.stdout).toMatch(/Tokens and cost/);
    expect(report.stdout).toMatch(/lift over rules cannot be measured in Phase 0/i);
    expect(secretsIn(report.stdout, [KEY])).toBe(false);

    const draft = join(out, 'draft.md');
    const refused = await node([REPORT_TS, runDir, '--draft', draft]);
    expect(refused.code).toBe(2);
    expect(await readdir(out)).not.toContain('draft.md');
  });
});
