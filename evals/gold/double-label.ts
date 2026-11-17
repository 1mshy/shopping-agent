// Double labelling of a gold set (S§5.16, plan P0 exit criteria).
// Usage:
//   node evals/gold/double-label.ts pick <dir> --seed <seed>
//       Writes <dir>/double-label.json: at least 10% of every product's snapshots, with the
//       product identity and frozen listing fields and no label. Earlier picks are kept.
//   node evals/gold/double-label.ts agreement <dir>
//       Agreement between the primary and second labels on the worklist. Exits 1 if n = 0.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AgreementRefusal,
  agreementReport,
  formatAgreement,
  pickDoubleLabel,
} from './lib/double-label.ts';
import { loadSet, WORKLIST_FILE, writeJson } from './lib/load.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { seed: { type: 'string' } },
});
const [command, dir] = positionals;
if (!dir || (command !== 'pick' && command !== 'agreement')) {
  console.error(
    'usage: node evals/gold/double-label.ts pick <dir> --seed <seed>\n' +
      '       node evals/gold/double-label.ts agreement <dir>',
  );
  process.exit(2);
}
const { set, violations } = loadSet(dir);
if (violations.length > 0) {
  console.error(
    `refusing: the set does not load cleanly\n${violations.map((x) => `  - ${x}`).join('\n')}`,
  );
  process.exit(1);
}

if (command === 'pick') {
  const seed = values.seed ?? set.worklist?.seed;
  if (!seed) {
    console.error('refused: the first pick needs --seed');
    process.exit(1);
  }
  const worklist = pickDoubleLabel(set, set.worklist, seed);
  writeJson(join(dir, WORKLIST_FILE), worklist);
  const before = set.worklist?.items.length ?? 0;
  console.info(
    `worklist: ${worklist.items.length} of ${set.snapshots.length} snapshots ` +
      `(${worklist.items.length - before} new), written to ${WORKLIST_FILE}`,
  );
} else {
  if (!set.worklist) {
    console.error(`refused: no ${WORKLIST_FILE}; run pick first`);
    process.exit(1);
  }
  try {
    console.info(formatAgreement(agreementReport(set.labels, set.worklist)));
  } catch (e) {
    if (!(e instanceof AgreementRefusal)) throw e;
    console.error(`refused: ${e.message}`);
    process.exit(1);
  }
}
