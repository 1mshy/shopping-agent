# evals/gold

Tooling for the matcher gold set (S§5.16): file formats, validators, the dev/held-out split, and double-labelling with an agreement report. The gold set measures the identity-precision gate (S§6).

**Gold data:** set v1 is `sets/matcher-v1/` (61 products, 1,307 snapshots, agent primary labels; see its README). It was captured with `capture/` and labelled with `agent-label.ts` (Claude Opus 5.5, two passes with different prompt orderings plus a tie-break, owner decision 2026-11-23). The tests use only the **synthetic** inputs built in `test/`. Every example below is marked as an example and uses invented values.

A set directory may also hold `agent-passes.json` (each agent pass with its evidence), `README.md` and the owner's review sheets (`REVIEW*.md`); the loader reads only the files listed below.

## Layout of a set

A real set lives in its own directory, proposed as `evals/gold/sets/<set-id>/` (for example `sets/matcher-v1/`):

```
<set>/
  products.json              array of products
  snapshots/<product-id>.json  array of the listing snapshots retrieved for that product
  labels/<labeller-id>.json    array of one labeller's relation labels (file name = handle)
  split.json                 split manifest, written by split.ts
  double-label.json          second-label worklist, written by double-label.ts
```

All files are pretty-printed JSON that a person can diff and edit. Objects are strict: a misspelt key is an error.

## Formats

Zod schemas are in `lib/formats.ts`. Ids are lower-case slugs (`[a-z0-9][a-z0-9._-]*`). Times are ISO 8601 with an offset or `Z`.

### Product

What a matcher is asked to find. The `identity` block mirrors the identity part of SearchIntent (S§5.4: brand, model, MPN, GTIN, must-have attributes, condition, pack quantity), but it is self-contained on purpose: the project's SearchIntent schema is being written separately. **The two must be aligned once SearchIntent lands.**

- `category`: an owner-chosen category id. The set has six; the tooling does not name them.
- `country`: the ISO 3166-1 alpha-2 market the snapshots were captured in.
- `identity.gtin`: optional; check digit validated (GTIN-8/12/13/14).
- `identity.mustHave`: attributes a listing needs to be `exact`.
- `identity.condition`: from the shared `Condition` vocabulary.

EXAMPLE (invented, not a gold product):

```json
{
  "id": "example-p001",
  "category": "example-category",
  "country": "CA",
  "identity": {
    "brand": "Example Brand",
    "model": "EX-100",
    "mpn": "EX100-BLK",
    "gtin": "2001234567893",
    "mustHave": { "colour": "black", "capacity": "256 GB" },
    "condition": "new",
    "packQuantity": 1
  },
  "notes": "free text"
}
```

### Listing snapshot

One frozen listing retrieved for a product. `capture` says where and when. `listing` holds the fields a matcher sees, as read from the page (a GTIN here is not validated: pages carry bad ones). `context` is for the labeller only and **is not an input to matching**. A price is kept, if at all, as the text as read plus its currency code (an ISO 4217 code with a minor unit, or `unknown`), never as a number.

EXAMPLE (invented):

```json
{
  "id": "example-p001-s01",
  "productId": "example-p001",
  "capture": {
    "url": "https://shop.example/products/ex-100",
    "country": "CA",
    "capturedAt": "2026-11-01T15:04:05Z"
  },
  "listing": {
    "title": "Example Brand EX-100 256 GB, black",
    "brand": "Example Brand",
    "model": "EX-100",
    "mpn": "EX100-BLK",
    "gtin": "2001234567893",
    "variantAttributes": { "colour": "black", "capacity": "256 GB" },
    "condition": "new",
    "sellerKind": "first_party",
    "storeHost": "shop.example"
  },
  "context": { "priceText": "$199.99", "currency": "CAD" }
}
```

### Relation label

One labeller's judgement of one snapshot. `relation` is the shared vocabulary (`MATCH_RELATIONS` in `@agentic-dasher/shared`: `exact, variant, bundle, accessory_or_part, other_model, other_line, unknown`). `labellerId` is an opaque handle such as `l1`, never a name or an email. `pass` is one of:

- `primary`: the label of record; every snapshot needs one;
- `second`: the independent second label, only on worklist items and by a different labeller;
- `adjudicated`: a later ruling that replaces the primary label as gold. Agreement is always computed between `primary` and `second`, so adjudicating never changes the reported agreement.

EXAMPLE (invented):

```json
{
  "snapshotId": "example-p001-s01",
  "relation": "variant",
  "labellerId": "l1",
  "labelledAt": "2026-11-02T10:00:00Z",
  "pass": "primary",
  "note": "listing is 128 GB"
}
```

### Split manifest

Written by `split.ts`. The source of truth for which products are `dev` and which are `held_out`. `seed` is fixed when the manifest is created; `toolVersion` is the tool that last wrote it; `run` numbers each assigning or retiring run.

EXAMPLE (invented):

```json
{
  "formatVersion": 1,
  "seed": "example-seed",
  "toolVersion": "gold-tools/1",
  "assignments": [
    { "productId": "example-p001", "side": "dev", "run": 1 },
    { "productId": "example-p002", "side": "held_out", "run": 1,
      "retired": { "run": 2, "reason": "release rotation" } },
    { "productId": "example-p003", "side": "held_out", "run": 3 }
  ]
}
```

### Double-label worklist

Written by `double-label.ts pick`. Each item carries the product identity and the frozen `listing` fields, and nothing about any label.

## Requirements the validator checks

Each is a named constant in `lib/requirements.ts` with its citation, and is reported with its count and n. Retired products are not counted.

| Id | Requirement | Source |
|---|---|---|
| `products` | ≥ 60 active products | S§5.16 "~60" (and 40 + 20) |
| `snapshots_per_product` | 15-25 snapshots per product | S§5.16 |
| `labels` | 1,000-1,500 snapshots with a gold relation | S§5.16 |
| `all_labelled` | every snapshot has a primary label | this unit |
| `categories` | exactly 6 (balance reported) | S§5.16 |
| `countries` | exactly 3, including CA and US | plan P0 workstream 4 |
| `hard_negatives` | ≥ 40% of labelled snapshots (also reported per side) | S§5.16 |
| `split_assigned`, `split_dev`, `split_held_out` | every product assigned; ≥ 40 dev, ≥ 20 held-out | S§5.16 |
| `double_labelled` | ≥ 10% of labelled snapshots have a second label | S§5.16, plan P0 exit criteria |

A requirement is `met`, `short` (adding products, snapshots or labels can still meet it) or `violated` (adding cannot fix it: more than 25 snapshots on a product, a seventh category, a fourth country). Integrity problems are always violations: schema errors (per entry, naming the file), duplicate ids, a snapshot or label naming something unknown, a snapshot captured in another country than its product, two labels of one pass on one snapshot, a second label by the primary labeller or off the worklist, a split that lists an unknown product or puts one real-world product on both sides, a stale worklist copy.

### Hard negative (adopted by the owner, 2026-11-23)

The spec does not define it. Adopted: **a snapshot whose gold relation is `variant`, `bundle`, `accessory_or_part` or `other_model`**: not exact, but the same brand and product line. These are what store search pads its results with, and the cases S§5.4's title rules and judge prompt exist to separate (variant words, accessory and part rejects, model-token conflicts; "variants in size, colour, capacity, configuration or pack count are not matches"). `other_line` is the easy negative and `unknown` is no decision; both count in the denominator.

The defensible alternative: every snapshot whose gold relation is neither `exact` nor `unknown`, on the grounds that every snapshot was returned by a search for the product, and that spike D names "other line" as an error class of its own. It makes the 40% bar easier to clear. It is one line to change (`HARD_NEGATIVE_RELATIONS`).

## The split

`split.ts assign` assigns only products the manifest does not list yet. **A product, once assigned, never moves**; the manifest is the source of truth. A run is deterministic from the manifest's seed and its run number (a seeded Mulberry32 generator, no `Math.random`).

- **How many go to held-out:** new products fill the free places of both targets (40 dev, 20 held-out) in proportion, then keep the 40:20 ratio beyond them.
- **Stratification:** held-out places go, one at a time, to the category × country stratum furthest below its one-third share; ties are broken in seeded order. Dev and held-out end with the same mix as far as the counts allow.
- **Leakage guard:** products that share a GTIN (normalised to 14 digits) or a normalised brand + MPN (NFKC, lower-case, letters and digits only) are one real-world product. A new one goes to the side its twin is on, and the tool says so. If the manifest already has one product on both sides, the tool refuses; the validator reports it too.
- **Rotation (plan P7 workstream 6, "10 products replaced"):** `split.ts rotate --count 10` (or `--ids`) retires active held-out products in place: they keep their side, are no longer counted, and can never reappear on the dev side. The tool prints each one's category and country. Add replacement products in those strata and run `assign`: only held-out has free places, so all replacements go there. Nothing else moves.

Remove a product by retiring it, not by deleting it, or the validator reports the manifest naming an unknown product.

## Labelling procedure (as far as the tooling defines it)

1. The labeller sees, per snapshot, the product (its `identity`) and the snapshot's `listing` fields, and may read `context` (the price text) to understand the page. The relation is judged from identity, not price.
2. Primary labels go in `labels/<handle>.json` with `"pass": "primary"`.
3. `double-label.ts pick` writes the worklist: `ceil(10%)` of each product's snapshots (so stratified by product, and through it by category, country and split side), chosen by a hash of the seed and the snapshot id. Re-running keeps earlier picks and only tops up products that gained snapshots.
4. A second labeller, with a different handle, labels the worklist items into `labels/<their-handle>.json` with `"pass": "second"`, working from `double-label.json` only. The worklist does not contain the first label; the second labeller must not open the first labeller's file.
5. `double-label.ts agreement` reports n, raw agreement, Cohen's kappa over the seven relations, the confusion matrix (rows primary, columns second), and the same for exact versus not exact, the question the precision gate asks. n = 0 is a refusal. When both labellers used a single relation, kappa is undefined (0/0) and is reported as such, not as 1.0.
6. Disagreements may then be settled with an `adjudicated` label; the agreement figure stays as measured.

## Commands

From the repository root (Node 26 runs the `.ts` files directly):

```sh
node evals/gold/validate.ts <dir>                 # strict: exit 1 unless every requirement is met
node evals/gold/validate.ts <dir> --progress      # a set being built: "short" is reported, not fatal
node evals/gold/split.ts assign <dir> --seed <s>  # first run; later runs reuse the manifest's seed
node evals/gold/split.ts rotate <dir> --count 10 --reason "<why>"
node evals/gold/double-label.ts pick <dir> --seed <s>
node evals/gold/double-label.ts agreement <dir>
node evals/gold/agent-label.ts <dir> --env <path/.env> --out evals/out/<run> [--cap-usd 15] [--concurrency 3]
```

`agent-label.ts` reads `CLAUDE_API_KEY` and `CLAUDE_API_URL` from the given `.env` (never printed), keeps each raw response under `--out` (gitignored, and a re-run resumes from it), and stops before a call whose projected spend (at $4 / $20 per million input / output tokens, from the usage the API reports) would pass the cap.

Exit codes: 0 success, 1 failed check or refusal, 2 usage error. Tests (`test/*.test.ts`) run with `pnpm test`.
