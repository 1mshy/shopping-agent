// Offline rescoring of review files (S§5.16): no network, no model.
// Usage: node evals/review/rescore.ts <file.json>... [--json]
// Prints, per file, the predecessor's figures with their numerators, denominators and n, the
// report-derived figures, the gate candidates and what cannot be computed. Exit 1 when a file is
// not a valid review file, 2 on a usage error.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ReviewFile } from './lib/format.ts';
import { formatReport, type RescoreReport, rescore } from './lib/rescore.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: 'boolean', default: false } },
});
if (positionals.length === 0) {
  console.error('usage: node evals/review/rescore.ts <file.json>... [--json]');
  process.exit(2);
}
const reports: Array<RescoreReport & { file: string }> = [];
let failed = false;
for (const path of positionals) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
    continue;
  }
  const parsed = ReviewFile.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20)) {
      console.error(`${path}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    failed = true;
    continue;
  }
  reports.push({ file: path, ...rescore(parsed.data) });
}
if (values.json) {
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
} else {
  console.info(reports.map((r) => `== ${r.file}\n${formatReport(r)}`).join('\n\n'));
}
process.exit(failed ? 1 : 0);
