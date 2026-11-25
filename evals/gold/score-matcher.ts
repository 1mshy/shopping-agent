// Scores the matcher's code tiers (S§5.4 tiers 1-2, packages/core) on one side of a gold set's
// split: identity precision and recall of `exact`, the confusion table, the `unknown` count.
// Usage: node evals/gold/score-matcher.ts <set-dir> <dev|held_out> [--rows]
//
// Only the products on the named side are read: their snapshot files, and the labels of their
// snapshots. Nothing of the other side's snapshots or labels is loaded or printed. The held-out
// side is run once, by the orchestrator, at the phase gate; development runs use `dev`.
// --rows prints each scored snapshot (id, gold, matcher, rule) after the report.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { decideMatch, MATCHER_VERSION } from '@agentic-dasher/core';
import { z } from 'zod';
import {
  GoldProduct,
  ListingSnapshot,
  RelationLabel,
  SPLIT_SIDES,
  SplitManifest,
} from './lib/formats.ts';
import {
  askedFor,
  formatScore,
  goldRelations,
  listingFor,
  type ScoredRow,
  scoreRows,
} from './lib/score-matcher.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { rows: { type: 'boolean', default: false } },
});
const [dir, side] = positionals;
const sideParsed = z.enum(SPLIT_SIDES).safeParse(side);
if (!dir || !sideParsed.success) {
  console.error('usage: node evals/gold/score-matcher.ts <set-dir> <dev|held_out> [--rows]');
  process.exit(2);
}

const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

const split = SplitManifest.parse(readJson('split.json'));
const ids = new Set(
  split.assignments
    .filter((a) => a.side === sideParsed.data && a.retired === undefined)
    .map((a) => a.productId),
);
const products = z
  .array(GoldProduct)
  .parse(readJson('products.json'))
  .filter((p) => ids.has(p.id));

const snapshots = products.flatMap((p) => {
  const rel = join('snapshots', `${p.id}.json`);
  return existsSync(join(dir, rel)) ? z.array(ListingSnapshot).parse(readJson(rel)) : [];
});
const snapshotIds = new Set(snapshots.map((s) => s.id));
const labels = readdirSync(join(dir, 'labels'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => z.array(RelationLabel).parse(readJson(join('labels', f))))
  .filter((l) => snapshotIds.has(l.snapshotId));
const gold = goldRelations(labels);

const byId = new Map(products.map((p) => [p.id, p]));
const rows: (ScoredRow & { rule: string })[] = [];
let unlabelled = 0;
for (const s of snapshots) {
  const product = byId.get(s.productId);
  const relation = gold.get(s.id);
  if (product === undefined || relation === undefined) {
    unlabelled++;
    continue;
  }
  const d = decideMatch({ asked: askedFor(product), listing: listingFor(s) });
  rows.push({ snapshotId: s.id, gold: relation, predicted: d.relation, rule: d.rule });
}

const score = scoreRows(rows);
console.info(
  formatScore(
    score,
    `matcher ${MATCHER_VERSION} on ${dir}, split ${sideParsed.data}: ${products.length} products`,
  ),
);
if (unlabelled > 0) console.info(`snapshots without a gold label (not scored): ${unlabelled}`);
if (values.rows) {
  for (const r of rows) console.info(`${r.snapshotId}\t${r.gold}\t${r.predicted}\t${r.rule}`);
}
