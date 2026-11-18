// Writes the golden expected figures for the parity test from the predecessor's own offline
// rescoring output. It copies the script's figures verbatim (no arithmetic here) and records how
// they were obtained.
//
// Usage (see README "Parity"):
//   node evals/review/golden.ts --script-output <rescored.json> --predecessor <dir> \
//     --run reports/<run>.json --review scripts/eval/<review>.json --python "<version>" \
//     --command "<the exact command that wrote rescored.json>" > <name>.figures.json
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'script-output': { type: 'string' },
    predecessor: { type: 'string' },
    run: { type: 'string' },
    review: { type: 'string' },
    python: { type: 'string' },
    command: { type: 'string' },
    commit: { type: 'string' },
    branch: { type: 'string' },
  },
});
const need = (k: keyof typeof values): string => {
  const v = values[k];
  if (typeof v !== 'string' || v === '') {
    console.error(`missing --${k}`);
    process.exit(2);
  }
  return v;
};
const out = need('script-output');
const root = need('predecessor');
const runRel = need('run');
const reviewRel = need('review');
const script = 'scripts/web-discovery-eval.py';
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const home = homedir();
const tilde = (p: string) => (p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

const rescored = JSON.parse(readFileSync(out, 'utf8'));
const published = JSON.parse(readFileSync(join(root, runRel), 'utf8'));

/** The row fields the script derives or rescoring writes, in the script's names. */
const ROW_FIELDS = [
  'id',
  'before_stores',
  'after_stores',
  'with_learned_stores',
  'before_stores_in_preferred',
  'after_stores_in_preferred',
  'with_learned_stores_in_preferred',
  'added_by_web',
  'added_by_learned',
  'checked_before',
  'checked_after',
  'checked_with_learned',
  'checked_before_in_preferred',
  'checked_after_in_preferred',
  'checked_with_learned_in_preferred',
  'checked_added_by_web',
  'checked_added_by_learned',
  'rejected',
] as const;

const golden = {
  about:
    'Figures computed by the predecessor’s own offline rescoring (scripts/web-discovery-eval.py --rescore --review), copied verbatim from its --json output. Expected values for evals/review/test/parity.test.ts.',
  obtainedBy: {
    method: 'script output',
    command: need('command'),
    python: need('python'),
    sandbox:
      'macOS sandbox-exec profile: (allow default)(deny network*)(deny file-write* under the predecessor tree); the run JSON was a copy in a scratch directory and --json wrote only there',
    repository: tilde(root),
    branch: need('branch'),
    commit: need('commit'),
    script,
    scriptSha256: sha256(join(root, script)),
    runFile: runRel,
    runFileSha256: sha256(join(root, runRel)),
    reviewFile: reviewRel,
    reviewFileSha256: sha256(join(root, reviewRel)),
    scriptOutputSha256: sha256(out),
    /** True when the summary the script writes today equals the one in the published run JSON. */
    publishedSummaryEqual: isDeepStrictEqual(rescored.summary, published.summary),
    /** True when every product row the script writes today equals the published run JSON's. */
    publishedProductsEqual: isDeepStrictEqual(rescored.products, published.products),
  },
  summary: rescored.summary,
  products: (rescored.products as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(ROW_FIELDS.map((k) => [k, row[k]])),
  ),
};
process.stdout.write(`${JSON.stringify(golden, null, 2)}\n`);
