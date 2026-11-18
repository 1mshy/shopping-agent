// Converts a predecessor review file and the run it reviews into this project's review format.
// Reads only the two files named; writes only --out (or compares with --check). No network.
//
// Usage:
//   node evals/review/convert.ts --predecessor <dir> --review scripts/eval/<x>-review.json \
//     --run reports/<x>.json --commit <sha> --branch <name> (--out <file> | --check <file>)
//
// --check compares a fresh conversion with an existing file (as parsed JSON, so formatting does
// not matter) and exits 1 when they differ. Exit 1 on a refusal, 2 on a usage error.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { ConversionRefused, convertPredecessor } from './lib/convert.ts';

const { values } = parseArgs({
  options: {
    predecessor: { type: 'string' },
    review: { type: 'string' },
    run: { type: 'string' },
    commit: { type: 'string' },
    branch: { type: 'string' },
    out: { type: 'string' },
    check: { type: 'string' },
  },
});
const usage = () => {
  console.error(
    'usage: node evals/review/convert.ts --predecessor <dir> --review <rel> --run <rel> ' +
      '--commit <sha> --branch <name> (--out <file> | --check <file>)',
  );
  process.exit(2);
};
const { predecessor, review, run, commit, branch, out, check } = values;
if (!predecessor || !review || !run || !commit || !branch || (!out && !check) || (out && check)) {
  usage();
}
const root = resolve(predecessor as string);
const home = homedir();
const repository = root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root;

try {
  const file = convertPredecessor({
    reviewText: readFileSync(join(root, review as string), 'utf8'),
    runText: readFileSync(join(root, run as string), 'utf8'),
    source: {
      repository,
      branch: branch as string,
      commit: commit as string,
      reviewFile: review as string,
      runFile: run as string,
    },
  });
  const listings = file.products.reduce((t, p) => t + p.listings.length, 0);
  const verdicts = file.products.reduce((t, p) => t + p.verdicts.length, 0);
  const summary =
    `${file.id}: ${file.products.length} products, ${listings} listings, ${verdicts} verdicts, ` +
    `${file.conversion?.lossy.length ?? 0} lossy notes`;
  if (out) {
    writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.info(`${summary}; wrote ${out}`);
  } else if (check) {
    const existing = JSON.parse(readFileSync(check, 'utf8'));
    const same = isDeepStrictEqual(existing, JSON.parse(JSON.stringify(file)));
    console.info(`${summary}; ${check} ${same ? 'is identical' : 'DIFFERS'}`);
    process.exit(same ? 0 : 1);
  }
} catch (e) {
  if (e instanceof ConversionRefused) {
    console.error(`refused: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
