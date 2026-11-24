// Evidence references into the predecessor, shared by the matcher areas. Paths are relative to the
// predecessor's repository root; the home directory in its local path is not written here.
import type { Evidence } from './contract.ts';

/** The predecessor as read for these areas (named in every matcher area's `sources`). */
export const PREDECESSOR =
  'hermes-shopping, local clone at ~/Documents/GitHub/hermes-shopping (home directory left out), ' +
  'branch browser-agent, commit 51db126 (51db12684598a1c662f6e4292ba273c2b528592a), read from ' +
  'the working tree as it stood on 2026-11-18, which has uncommitted files; the owner confirmed ' +
  'this copy as the reference on 2026-11-23';

/**
 * The owner's matcher ruling of 2026-11-23 (docs/progress.md, "Owner rulings on the Phase 1
 * questions"), quoted in the cases it settles. It answers the corpus's question 7.
 */
export const SUFFIX_RULING =
  'the owner\'s ruling of 2026-11-23: "a name suffix that changes the line (Duo vs Duo Plus) or ' +
  'the material (PLA+ vs Silk PLA+) makes a different product (other_model or variant), never ' +
  'exact"';

/**
 * The orchestrator's reading of that ruling (2026-11-23): "Plus counts the query's way" stays for
 * the material-grade mark as the predecessor's review took it and does not extend to model
 * names; matte and silk are other lines, not finishes.
 */
export const SUFFIX_READING =
  'the orchestrator\'s reading of 2026-11-23: "Plus counts the query\'s way" stays for the ' +
  'material-grade mark as the review took it and does not extend to model names; matte and silk ' +
  'are other lines, not finishes';

/** Settled by the orchestrator on 2026-11-23 (an engineering detail the owner may overrule). */
export const URL_SETTLED =
  'settled by the orchestrator 2026-11-23, the owner may overrule: "a model number in a URL path ' +
  'is supporting evidence, never identity on its own"';

/** An assertion of a predecessor test: `pricewatch/tests/<file>::<test>`, with the row if any. */
export function test(file: string, name: string, row?: string): Evidence {
  return { kind: 'test', ref: `pricewatch/tests/${file}::${name}${row ? ` ${row}` : ''}` };
}

/**
 * A hand-review label: `scripts/eval/2026-10-23-<which>-review.json`, product, store, its reason,
 * and the setups it is limited to when the entry is `{reason, setups}`.
 */
export function review(
  which: 'phase5' | 'matching',
  product: string,
  store: string,
  reason: string,
  setups?: readonly string[],
): Evidence {
  const only = setups ? ` (setups ${setups.join(', ')} only)` : '';
  return {
    kind: 'review',
    ref: `scripts/eval/2026-10-23-${which}-review.json ${product}.${store}: "${reason}"${only}`,
  };
}

/** The rule both review files state in their "about" field. */
export const REVIEW_RULE: Evidence = {
  kind: 'review',
  ref:
    'scripts/eval/2026-10-23-phase5-review.json "about": "a store counts for a product when at ' +
    'least one row the engine read there is that product itself: any colour or finish, new, open ' +
    'box or renewed. Rejected: accessories and parts, another model or generation, another ' +
    'capacity or size, a bundle, kit or multi-pack when no row is the product, a multi-capacity ' +
    'listing whose price is another capacity\'s, and a look-alike."',
};

export function report(ref: string): Evidence {
  return { kind: 'report', ref };
}

export function code(ref: string): Evidence {
  return { kind: 'code', ref };
}

/** The pure predecessor function run offline (its matching.py loaded by path, no network). */
export function run(ref: string): Evidence {
  return { kind: 'run', ref: `pricewatch/src/pricewatch/matching.py at 51db126: ${ref}` };
}

export function spec(ref: string): Evidence {
  return { kind: 'spec', ref: `docs/spec.md ${ref}` };
}

export const S54_RULES = spec(
  'S§5.4 tier 2: "accessory and part rejects, model-token conflicts, variant words"',
);
export const S54_JUDGE = spec(
  'S§5.4 tier 3 rules, binding on the code tiers: "exact means the two would share a barcode; ' +
    'variants in size, colour, capacity, configuration or pack count are not matches; a missing ' +
    'attribute is not a conflict; a match needs positive evidence"',
);
export const S54_RULINGS = spec(
  'S§5.4 tier 2: "the owner\'s rulings as fixed test cases (combo counts both ways; Plus counts ' +
    "the query's way for a material grade; a name suffix that changes the line or the material " +
    'makes a different product, `other_model` or `variant`, never `exact`; a size in place of a ' +
    'model is not a clash)"',
);
