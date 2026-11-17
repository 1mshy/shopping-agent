// The dev/held-out split of a gold set (S§5.16). Writes <dir>/split.json.
// Usage:
//   node evals/gold/split.ts assign <dir> --seed <seed>
//       Assigns products the manifest does not list yet. Assigned products never move. The seed
//       is required for the first run and must match the manifest's afterwards.
//   node evals/gold/split.ts rotate <dir> (--count <n> | --ids <a,b,...>) --reason <text>
//       Retires active held-out products in place (plan P7 workstream 6); then add replacement
//       products and run `assign`, which fills the freed held-out places first.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSet, SPLIT_FILE, writeJson } from './lib/load.ts';
import { assignSplit, pickRotation, retire, SplitRefusal } from './lib/split.ts';

const usage =
  'usage: node evals/gold/split.ts assign <dir> --seed <seed>\n' +
  '       node evals/gold/split.ts rotate <dir> (--count <n> | --ids <a,b>) --reason <text>';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: 'string' },
    count: { type: 'string' },
    ids: { type: 'string' },
    reason: { type: 'string' },
  },
});
const [command, dir] = positionals;
if (!dir || (command !== 'assign' && command !== 'rotate')) {
  console.error(usage);
  process.exit(2);
}
const { set, violations } = loadSet(dir);
if (violations.length > 0) {
  console.error(
    `refusing: the set does not load cleanly\n${violations.map((x) => `  - ${x}`).join('\n')}`,
  );
  process.exit(1);
}
const out = join(dir, SPLIT_FILE);
const byId = new Map(set.products.map((p) => [p.id, p]));
const where = (id: string) =>
  `${id} (${byId.get(id)?.category ?? '?'}, ${byId.get(id)?.country ?? '?'})`;

try {
  if (command === 'assign') {
    const seed = values.seed ?? set.split?.seed;
    if (!seed) throw new SplitRefusal('the first run needs --seed');
    const res = assignSplit(set.products, set.split, seed);
    for (const f of res.forced) {
      console.warn(`leakage guard: ${f.productId} goes to ${f.side}, same product as ${f.sameAs}`);
    }
    const tally = (s: string) => res.assigned.filter((a) => a.side === s).length;
    console.info(
      `assigned ${res.assigned.length}: dev ${tally('dev')}, held_out ${tally('held_out')}`,
    );
    const active = res.manifest.assignments.filter((a) => !a.retired);
    const total = (s: string) => active.filter((a) => a.side === s).length;
    console.info(`active now: dev ${total('dev')}, held_out ${total('held_out')}`);
    if (res.assigned.length > 0 || !existsSync(out)) writeJson(out, res.manifest);
  } else {
    if (!set.split) throw new SplitRefusal('no split.json to rotate');
    if (!values.reason) throw new SplitRefusal('rotate needs --reason');
    const ids = values.ids
      ? values.ids.split(',').map((s) => s.trim())
      : pickRotation(set.split, Number(values.count ?? Number.NaN));
    if (
      ids.some((id) => set.split?.assignments.find((a) => a.productId === id)?.side !== 'held_out')
    ) {
      throw new SplitRefusal('rotation retires held-out products only');
    }
    writeJson(out, retire(set.split, ids, values.reason));
    console.info(`retired ${ids.length}; replace them in the same category and country:`);
    for (const id of ids) console.info(`  ${where(id)}`);
  }
} catch (e) {
  if (!(e instanceof SplitRefusal)) throw e;
  console.error(`refused: ${e.message}`);
  process.exit(1);
}
