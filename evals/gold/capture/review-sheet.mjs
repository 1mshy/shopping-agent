// node review-sheet.mjs <setDir> : writes REVIEW.md (blind worklist) and REVIEW-disagreements.md.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2];
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const products = new Map(read('products.json').map((p) => [p.id, p]));
const snaps = new Map();
for (const f of readdirSync(`${dir}/snapshots`))
  for (const s of read(`snapshots/${f}`)) snaps.set(s.id, s);
const worklist = read('double-label.json');
const passes = read('agent-passes.json').snapshots;
const split = new Map(read('split.json').assignments.map((a) => [a.productId, a.side]));

const esc = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const identityLine = (p) => {
  const i = p.identity;
  const parts = [`brand **${esc(i.brand)}**`];
  if (i.model) parts.push(`model **${esc(i.model)}**`);
  if (i.mpn) parts.push(`MPN \`${esc(i.mpn)}\``);
  if (i.gtin) parts.push(`GTIN \`${esc(i.gtin)}\``);
  const mh = Object.entries(i.mustHave)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  if (mh) parts.push(`must have: ${esc(mh)}`);
  return parts.join(', ');
};
const fields = (l) => {
  const parts = [];
  if (l.brand) parts.push(`brand ${l.brand}`);
  if (l.mpn) parts.push(`MPN ${l.mpn}`);
  if (l.gtin) parts.push(`GTIN ${l.gtin}`);
  const v = Object.entries(l.variantAttributes)
    .map(([k, x]) => `${k}=${x}`)
    .join(', ');
  if (v) parts.push(v);
  if (l.condition !== 'new') parts.push(`condition ${l.condition}`);
  if (l.sellerKind !== 'first_party') parts.push(l.sellerKind);
  parts.push(l.storeHost);
  return esc(parts.join('; '));
};
const RELATIONS = 'exact, variant, bundle, accessory_or_part, other_model, other_line, unknown';

// ---------- REVIEW.md: the blind 10% worklist ----------
let md = `# Gold set v1: owner review, part 1 (blind second labels)

This is the double-label worklist written by \`double-label.ts pick\` (${worklist.items.length} snapshots, ${Math.round(worklist.rate * 100)}% of every product's snapshots, seed \`${worklist.seed}\`). It is **blind**: it shows the product and the listing, never the agent's label. Please label every row before opening \`REVIEW-disagreements.md\`, which shows the agent's labels.

**How to mark.** Write one relation in the last column: ${RELATIONS}. Judge identity only; condition (open box, refurbished) and price are not part of the relation. Rulings in force: a suffix that changes the line (Duo vs Duo Plus) or the material (PLA+ vs Silk PLA+) is never \`exact\`; Combo versus not-Combo is \`variant\` both ways; a 2-pack of the target is \`variant\` (pack count); the product plus other items is \`bundle\`; a model number in a URL is supporting evidence only (URLs are not shown here). The orchestrator copies the column into \`labels/<your handle>.json\` with \`"pass": "second"\`, and \`double-label.ts agreement\` then reports raw agreement and Cohen's kappa.

Relation meanings: **exact** the same item (would share a barcode); **variant** same model, another colour, capacity, size, configuration or pack count; **bundle** the item plus other items sold as one; **accessory_or_part** an accessory, spare part or consumable for it; **other_model** same brand and family, another model or generation; **other_line** another line, brand or unrelated item; **unknown** cannot tell from the fields.

`;
let prev = '';
let n = 0;
for (const it of worklist.items) {
  const p = products.get(it.productId);
  if (it.productId !== prev) {
    md += `\n## ${p.id} (${p.category}, ${p.country}, ${split.get(p.id) ?? 'unassigned'})\n\n${esc(p.notes)}\n\nTarget: ${identityLine(p)}\n\n| # | Snapshot | Listing title | Listing fields | Your relation |\n|---|---|---|---|---|\n`;
    prev = it.productId;
  }
  n++;
  md += `| ${n} | \`${it.snapshotId}\` | ${esc(it.listing.title)} | ${fields(it.listing)} |  |\n`;
}
writeFileSync(`${dir}/REVIEW.md`, md);

// ---------- REVIEW-disagreements.md ----------
const dis = passes.filter((p) => p.passA && p.passB && p.passA.relation !== p.passB.relation);
const onWorklist = new Set(worklist.items.map((i) => i.snapshotId));
let d = `# Gold set v1: owner review, part 2 (agent disagreements)

Open this after part 1 (\`REVIEW.md\`). These are the ${dis.length} snapshots where the two agent passes (Claude Opus 5.5, \`claude-opus-5-5\`, prompt \`gold-label.v1\`) gave different relations. Pass A saw the product first and the listings in id order; pass B saw the listings first in reverse order and the product after. A third call saw both readings and decided; its answer is the primary label in \`labels/a1.json\` until you rule. Rows marked **(W)** are also on the blind worklist.

**How to mark.** In the last column write the relation you rule (${RELATIONS}), or "ok" to keep the primary. The orchestrator records a ruling that differs as an \`adjudicated\` label; the agreement figure is not changed by it.

`;
prev = '';
for (const r of dis) {
  const p = products.get(r.productId);
  const s = snaps.get(r.snapshotId);
  if (r.productId !== prev) {
    d += `\n## ${p.id} (${p.category}, ${p.country})\n\nTarget: ${identityLine(p)}\n\n| Snapshot | Listing title | Listing fields | Pass A | Pass B | Primary (tie-break) | Your ruling |\n|---|---|---|---|---|---|---|\n`;
    prev = r.productId;
  }
  d += `| \`${r.snapshotId}\`${onWorklist.has(r.snapshotId) ? ' (W)' : ''} | ${esc(s.listing.title)} | ${fields(s.listing)} | **${r.passA.relation}**: ${esc(r.passA.evidence)} | **${r.passB.relation}**: ${esc(r.passB.evidence)} | **${r.primary ?? '(none)'}**: ${esc(r.tieBreak?.evidence ?? '')} |  |\n`;
}
writeFileSync(`${dir}/REVIEW-disagreements.md`, d);
console.info(
  `REVIEW.md: ${worklist.items.length} items; REVIEW-disagreements.md: ${dis.length} items (${dis.filter((x) => onWorklist.has(x.snapshotId)).length} also on the worklist)`,
);
