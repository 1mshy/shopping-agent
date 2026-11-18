// Offline re-classification of spike A results: re-runs the readable criterion on each stored
// body and spike C's classifier on the stored response view. Makes no request. Results that got
// no answer (network errors, refusals, caps) are left as they are.
//   node lab/transport/reclassify.ts --out lab/out/transport/full-reclassified lab/out/transport/full/results.jsonl
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { classifyObserved } from '../routes/classify.ts';
import { observedFrom, validationFrom } from '../routes/evidence.ts';
import { type ClientResult, classifyBody, type HostResult, validationOf } from './result.ts';
import { readResults } from './summarise.ts';

export function reclassifyClient(x: ClientResult, dir: string): ClientResult {
  const o = observedFrom(x.evidence);
  if (!o) return x;
  const file = x.evidence.body ? join(dir, x.evidence.body) : undefined;
  if (file && existsSync(file)) {
    // The whole classifier input is stored: readable criterion, spike C's rules, the body rule.
    const c = classifyBody(o, new TextDecoder().decode(gunzipSync(readFileSync(file))));
    return {
      ...x,
      outcome: c.outcome,
      evidence: {
        ...x.evidence,
        readable: c.readable,
        valid: c.v.valid,
        validation: c.v.valid ? (c.v.note ?? '') : c.v.reason,
        signals: c.signals,
      },
    };
  }
  // No stored body: spike C's rules on the stored view and the stored verdict only.
  const v = x.evidence.readable ? validationOf(x.evidence.readable) : validationFrom(x.evidence);
  if (!v) return x;
  const c = classifyObserved(o, v, 'any');
  return { ...x, outcome: c.outcome, evidence: { ...x.evidence, signals: c.signals } };
}

export function reclassifyHost(r: HostResult, dir: string): HostResult {
  return { ...r, results: r.results.map((x) => reclassifyClient(x, dir)) };
}

/** What changed, as `key client: before -> after`. */
export function changes(before: HostResult[], after: HostResult[]): string[] {
  const out: string[] = [];
  before.forEach((b, i) => {
    b.results.forEach((x, j) => {
      const y = after[i]?.results[j];
      if (y && JSON.stringify(x.outcome) !== JSON.stringify(y.outcome)) {
        out.push(
          `${b.key} ${x.client}: ${JSON.stringify(x.outcome)} -> ${JSON.stringify(y.outcome)}`,
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
  if (!a.out || files.length === 0)
    throw new Error('usage: reclassify.ts --out <dir> <results.jsonl...>');
  await mkdir(a.out, { recursive: true });
  let changed = 0;
  for (const f of files) {
    const before = await readResults([f]);
    const after = before.map((r) => reclassifyHost(r, dirname(f)));
    const diff = changes(before, after);
    changed += diff.length;
    for (const d of diff) console.info(d);
    // One output per input, named after its run directory (pilot.jsonl, full.jsonl).
    const name = `${basename(dirname(f))}.jsonl`;
    await writeFile(join(a.out, name), `${after.map((r) => JSON.stringify(r)).join('\n')}\n`);
  }
  console.info(`${changed} changes; written to ${a.out}`);
}

if (import.meta.main) await main();
