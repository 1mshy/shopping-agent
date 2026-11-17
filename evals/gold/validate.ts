// Validates a gold set directory (S§5.16).
// Usage: node evals/gold/validate.ts <dir> [--progress]
// Strict by default: exits 1 unless every requirement is met and there is no violation.
// --progress: a set still being built; "not enough yet" is reported but does not fail.
import { parseArgs } from 'node:util';
import { checkSet, formatReport } from './lib/check.ts';
import { loadSet } from './lib/load.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { progress: { type: 'boolean', default: false } },
});
const dir = positionals[0];
if (!dir) {
  console.error('usage: node evals/gold/validate.ts <dir> [--progress]');
  process.exit(2);
}
const { set, violations } = loadSet(dir);
const report = checkSet(set, values.progress ? 'progress' : 'strict');
report.violations.unshift(...violations);
report.ok &&= violations.length === 0;
console.info(formatReport(report));
process.exit(report.ok ? 0 : 1);
