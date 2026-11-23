// Agent labelling of a gold set (owner decision 2026-11-23, P0-4c): Claude Opus 5.5 on the native
// Anthropic API labels every snapshot in two independent passes that order the prompt differently;
// a third call settles only the snapshots where the two passes disagree. Every answer keeps its
// cited evidence. The owner then reviews the double-label worklist (blind) and every disagreement.
//
// Usage:
//   node evals/gold/agent-label.ts <set-dir> --env <path/.env> --out <raw-dir> [--cap-usd 15]
//     [--labeller a1] [--only <productId,...>] [--dry-run]
//
// Reads CLAUDE_API_KEY and CLAUDE_API_URL from the .env file (never printed). Writes each raw
// response under <raw-dir> (gitignored), resumes from it, writes <set-dir>/agent-passes.json and
// <set-dir>/labels/<labeller>.json (primary labels). Spend is counted from the reported usage at
// $4 / $20 per million input / output tokens (cache writes and reads counted as plain input, which
// over-counts) and the run stops before a call whose projected total would pass the cap.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { MATCH_RELATIONS } from '@agentic-dasher/shared';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { GoldProduct, ListingSnapshot, RelationLabel } from './lib/formats.ts';
import { loadSet, writeJson } from './lib/load.ts';

export const MODEL = 'claude-opus-5-5';
export const PROMPT_VERSION = 'gold-label.v1';
const USD_PER_INPUT = 4 / 1e6;
const USD_PER_OUTPUT = 20 / 1e6;

export const SYSTEM = `You label listing snapshots for a product-matching gold set. For each listing, decide how the listing relates to the target product, using only the fields given. Answer with one relation per listing.

Relations:
- exact: the listing sells the target product itself: the same brand, model and generation, and every must-have attribute (capacity, size, colour, material, configuration such as printer alone vs Combo, pack quantity) agrees. The test is "the two would share a barcode". An exact label needs positive evidence: a matching GTIN, a matching MPN or model number, or a title that names the model and every must-have attribute without contradiction. A must-have attribute the listing does not state is not a conflict when the rest is positive evidence. A different GTIN or MPN than the target's is strong evidence against exact unless it is a known regional or packaging code of the same item.
- variant: the same model but a different variant: colour, capacity, size, configuration (for example the printer alone when the target is the Combo, or the Combo when the target is the printer alone), pack count (a 2-pack of the target), or a listing that offers several variants and selects one that is not the target.
- bundle: the target product sold together with other, different items (a kit with extra filament, a case, a starter pack) where the bundle is the unit sold.
- accessory_or_part: an accessory, spare or replacement part, consumable or add-on for the target or its family (case, ear pads, nozzle, build plate, brush heads, cable, battery for the tool), not the product itself.
- other_model: the same brand and product family, but another model or generation (for example XM4 or XM6 when the target is XM5; 990 EVO when the target is 990 PRO).
- other_line: a different product line, a different brand, or an unrelated item.
- unknown: the fields do not let you decide.

Fixed rulings from the owner:
- A name suffix that changes the line (Instant Pot Duo vs Duo Plus, Duo Crisp) or the material (PLA+ vs Silk PLA+, PLA vs PLA+) is never exact: label it other_model, or variant when it is the same model in another material or finish.
- "Combo" and "with AMS" mean the same bundle; Combo versus not-Combo is a variant difference, both ways.
- Condition (new, open box, refurbished, used) is NOT part of the relation: it is recorded separately in the listing's condition field. A refurbished or open-box unit of the target model in the target variant is exact.
- Seller kind (marketplace seller or the store itself) is not part of the relation either.
- Price is not evidence of identity.

Evidence: for each listing give one short sentence (at most 30 words) that quotes the listing fields that decided the label (title words, brand, MPN, GTIN, variant attributes) and, for a non-exact label, the attribute that differs. List the differing attribute names in differingAttrs (empty for exact and for other_line).

Return every listing id exactly once.`;

const Answer = z.object({
  labels: z.array(
    z.object({
      id: z.string(),
      relation: z.enum(MATCH_RELATIONS),
      differingAttrs: z.array(z.string()),
      evidence: z.string(),
    }),
  ),
});
type Answer = z.infer<typeof Answer>;

export interface PassLabel {
  relation: RelationLabel['relation'];
  differingAttrs: string[];
  evidence: string;
}
export interface SnapshotPasses {
  snapshotId: string;
  productId: string;
  passA?: PassLabel;
  passB?: PassLabel;
  tieBreak?: PassLabel;
  primary?: RelationLabel['relation'];
  resolvedBy?: 'agreement' | 'tie_break';
}

const productBlock = (p: GoldProduct) =>
  `TARGET PRODUCT\n${JSON.stringify({ description: p.notes, identity: p.identity }, null, 1)}`;

const listingLine = (s: ListingSnapshot) =>
  JSON.stringify({
    id: s.id,
    ...s.listing,
    ...(s.context ? { priceForContextOnly: `${s.context.priceText} ${s.context.currency}` } : {}),
  });

/** Pass A: product first, listings in id order. Pass B: listings first in reverse order, product after. */
export function userPrompt(
  pass: 'A' | 'B',
  p: GoldProduct,
  snaps: readonly ListingSnapshot[],
): string {
  if (pass === 'A') {
    return `${productBlock(p)}\n\nLISTINGS (${snaps.length})\n${snaps.map(listingLine).join('\n')}\n\nLabel every listing against the target product.`;
  }
  const rev = [...snaps].reverse();
  return `Here are ${rev.length} store listings. After them comes the product they were retrieved for.\n\nLISTINGS\n${rev.map(listingLine).join('\n')}\n\n${productBlock(p)}\n\nFor each listing, decide its relation to this product.`;
}

function tiePrompt(p: GoldProduct, items: { snap: ListingSnapshot; a: PassLabel; b: PassLabel }[]) {
  const lines = items.map(({ snap, a, b }) =>
    JSON.stringify({
      listing: JSON.parse(listingLine(snap)),
      readingOne: { relation: a.relation, evidence: a.evidence },
      readingTwo: { relation: b.relation, evidence: b.evidence },
    }),
  );
  return `${productBlock(p)}\n\nTwo independent readings disagreed on these ${items.length} listings. Decide each one yourself from the fields; the readings are only arguments, and either or neither may be right.\n${lines.join('\n')}`;
}

function readEnv(path: string): { apiKey: string; baseURL: string | undefined } {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  const apiKey = env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error(`CLAUDE_API_KEY not set in ${path}`);
  const url = env.CLAUDE_API_URL?.replace(/\/+$/, '').replace(/\/v1$/, '');
  return { apiKey, baseURL: url || undefined };
}

interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}
const usdOf = (s: Pick<Spend, 'inputTokens' | 'outputTokens'>) =>
  s.inputTokens * USD_PER_INPUT + s.outputTokens * USD_PER_OUTPUT;

function checkAnswer(a: Answer | null, ids: readonly string[]): Map<string, PassLabel> {
  if (!a) throw new Error('no parsed output');
  const want = new Set(ids);
  const got = new Map<string, PassLabel>();
  for (const l of a.labels) {
    if (!want.has(l.id)) throw new Error(`unknown id ${l.id}`);
    if (got.has(l.id)) throw new Error(`id ${l.id} twice`);
    got.set(l.id, { relation: l.relation, differingAttrs: l.differingAttrs, evidence: l.evidence });
  }
  if (got.size !== want.size) throw new Error(`answered ${got.size} of ${want.size}`);
  return got;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: 'string' },
      out: { type: 'string' },
      'cap-usd': { type: 'string', default: '15' },
      labeller: { type: 'string', default: 'a1' },
      only: { type: 'string' },
      effort: { type: 'string', default: 'low' },
      concurrency: { type: 'string', default: '3' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const dir = positionals[0];
  if (!dir || !values.env || !values.out) {
    console.error('usage: node evals/gold/agent-label.ts <set-dir> --env <.env> --out <raw-dir>');
    process.exit(2);
  }
  const effort = values.effort as 'low' | 'medium' | 'high';
  const cap = Number(values['cap-usd']);
  const raw = values.out;
  mkdirSync(raw, { recursive: true });
  const { set, violations } = loadSet(dir);
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  const only = values.only ? new Set(values.only.split(',')) : null;
  const products = set.products.filter((p) => !only || only.has(p.id));
  const { apiKey, baseURL } = readEnv(values.env);
  const client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  console.info(
    `model ${MODEL}, effort ${effort}, endpoint ${baseURL ?? '(SDK default)'}, cap $${cap}`,
  );

  const spendFile = join(raw, 'spend.json');
  const spend: Spend = existsSync(spendFile)
    ? JSON.parse(readFileSync(spendFile, 'utf8'))
    : { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  const plannedCalls = products.length * 2;
  let maxCallUsd = 0;
  let inFlight = 0;

  async function call(key: string, user: string, ids: readonly string[]) {
    const file = join(raw, `${key}.json`);
    if (existsSync(file)) return checkAnswer(JSON.parse(readFileSync(file, 'utf8')).parsed, ids);
    if (values['dry-run']) return null;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      // Projection: what is spent, plus every call in flight and this one at the dearest seen.
      const perCall = Math.max(spend.calls ? spend.usd / spend.calls : 0.15, maxCallUsd);
      if (spend.usd + (inFlight + 1) * perCall > cap) {
        throw new Error(
          `stopping: $${spend.usd.toFixed(2)} spent, ${inFlight} calls in flight; the next could pass the $${cap} cap`,
        );
      }
      inFlight++;
      const res = await client.messages
        .parse({
          model: MODEL,
          max_tokens: 16000,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          output_config: { effort, format: zodOutputFormat(Answer) },
          messages: [{ role: 'user', content: user }],
        })
        .finally(() => inFlight--);
      const u = res.usage;
      const inTok =
        u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      const callUsd = usdOf({ inputTokens: inTok, outputTokens: u.output_tokens });
      spend.calls++;
      spend.inputTokens += inTok;
      spend.outputTokens += u.output_tokens;
      spend.usd = usdOf(spend);
      maxCallUsd = Math.max(maxCallUsd, callUsd);
      writeJson(spendFile, spend);
      if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
        lastErr = new Error(`${key}: stop_reason ${res.stop_reason}`);
        continue;
      }
      try {
        const got = checkAnswer(res.parsed_output, ids);
        writeJson(file, {
          key,
          model: res.model,
          promptVersion: PROMPT_VERSION,
          effort,
          at: new Date().toISOString(),
          usage: u,
          stopReason: res.stop_reason,
          parsed: res.parsed_output,
        });
        console.info(
          `${key}: ${ids.length} labels, in ${inTok} out ${u.output_tokens}, $${callUsd.toFixed(3)}; total $${spend.usd.toFixed(2)} over ${spend.calls} calls`,
        );
        return got;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  const passesFile = join(dir, 'agent-passes.json');
  const passes = new Map<string, SnapshotPasses>(
    existsSync(passesFile)
      ? (JSON.parse(readFileSync(passesFile, 'utf8')).snapshots as SnapshotPasses[]).map((s) => [
          s.snapshotId,
          s,
        ])
      : [],
  );
  const save = () => {
    const snapshots = set.snapshots
      .map((s) => passes.get(s.id))
      .filter((x): x is SnapshotPasses => x !== undefined);
    writeJson(passesFile, {
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      effort,
      system: SYSTEM,
      note: 'Pass A: product first, listings in id order. Pass B: listings first in reverse order, product after. tieBreak: only where A and B disagree.',
      snapshots,
    });
  };

  async function labelProduct(p: GoldProduct) {
    {
      const snaps = set.snapshots
        .filter((s) => s.productId === p.id)
        .sort((a, b) => a.id.localeCompare(b.id));
      const ids = snaps.map((s) => s.id);
      // The two passes are independent requests; neither sees the other's answer.
      const [a, b] = await Promise.all([
        call(`${p.id}.A`, userPrompt('A', p, snaps), ids),
        call(`${p.id}.B`, userPrompt('B', p, snaps), ids),
      ]);
      if (!a || !b) return;
      const split: { snap: ListingSnapshot; a: PassLabel; b: PassLabel }[] = [];
      for (const s of snaps) {
        const pa = a.get(s.id);
        const pb = b.get(s.id);
        if (!pa || !pb) continue;
        const rec: SnapshotPasses = { snapshotId: s.id, productId: p.id, passA: pa, passB: pb };
        if (pa.relation === pb.relation) {
          rec.primary = pa.relation;
          rec.resolvedBy = 'agreement';
        } else split.push({ snap: s, a: pa, b: pb });
        passes.set(s.id, rec);
      }
      if (split.length) {
        const t = await call(
          `${p.id}.T`,
          tiePrompt(p, split),
          split.map((x) => x.snap.id),
        );
        for (const { snap } of split) {
          const rec = passes.get(snap.id);
          const tb = t?.get(snap.id);
          if (rec && tb) {
            rec.tieBreak = tb;
            rec.primary = tb.relation;
            rec.resolvedBy = 'tie_break';
          }
        }
      }
      save();
    }
  }

  // Bounded concurrency: `--concurrency` products at a time (each runs its A and B in parallel).
  const queue = [...products];
  const workers = Array.from({ length: Number(values.concurrency) }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await labelProduct(p);
  });
  try {
    const results = await Promise.allSettled(workers);
    const failed = results.filter((r) => r.status === 'rejected');
    for (const f of failed) console.error(String((f as PromiseRejectedResult).reason));
  } finally {
    save();
    console.info(
      `spend: $${spend.usd.toFixed(2)} over ${spend.calls} calls (${spend.inputTokens} in, ${spend.outputTokens} out); planned at least ${plannedCalls} calls`,
    );
  }

  // Primary labels of record, one per snapshot that has a resolved label.
  const at = new Date().toISOString();
  const labels: RelationLabel[] = set.snapshots.flatMap((s) => {
    const r = passes.get(s.id);
    if (!r?.primary) return [];
    const note =
      r.resolvedBy === 'agreement'
        ? `agent passes A and B agree: ${r.passA?.evidence ?? ''}`
        : `A=${r.passA?.relation}, B=${r.passB?.relation}, tie-break: ${r.tieBreak?.evidence ?? ''}`;
    return [
      {
        snapshotId: s.id,
        relation: r.primary,
        labellerId: values.labeller ?? 'a1',
        labelledAt: at,
        pass: 'primary' as const,
        note,
      },
    ];
  });
  mkdirSync(join(dir, 'labels'), { recursive: true });
  writeJson(join(dir, 'labels', `${values.labeller}.json`), labels);
  console.info(`${labels.length} primary labels of ${set.snapshots.length} snapshots`);
}

await main();
