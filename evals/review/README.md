# evals/review

Hand-review files and their offline rescoring (S§5.16: "Hand-review JSON plus offline rescoring is ported from `scripts/web-discovery-eval.py`"; plan P0 workstream 4). A review file holds what a run found and what a person said about it; rescoring computes the figures from the file alone, with no network and no model.

| Path | What |
|---|---|
| `lib/format.ts` | Zod schemas: the predecessor's review file as it is, and this project's review file |
| `lib/convert.ts`, `convert.ts` | Converter from a predecessor review file plus the run it reviews (function and CLI) |
| `lib/rescore.ts`, `rescore.ts` | Rescoring (pure functions and CLI) |
| `predecessor/*.json` | The two predecessor review files, converted: the seed S§5.16 names |
| `predecessor/convert-predecessor.sh` | How those were produced (`--out`) and how to check them again (`--check`) |
| `predecessor/golden/*.figures.json` | The predecessor script's own rescoring output, verbatim: the parity test's expected values |
| `predecessor/golden/published.json` | Figures the predecessor's write-ups published that its script does not compute |
| `predecessor/golden/run-predecessor.sh`, `golden.ts` | How the golden figures were obtained, re-runnable |
| `test/` | Format, converter, rescoring and parity tests (Vitest; no network, no model) |

## The predecessor

Read from `~/Documents/GitHub/hermes-shopping`, branch `browser-agent`, commit `51db126`. The script and every file used here are committed there and unmodified in the working tree (its uncommitted files are later reports and research notes, none used here). **The owner has not yet confirmed that this copy is the reference.**

History of the files (`git log -- scripts/web-discovery-eval.py scripts/eval`):

- `07817e9` (2026-10-15, Phase 1): the script (before/after coverage, no review) and `scripts/eval/web-discovery-products.json`, the fixed 20-product list.
- `ad9fba4` (2026-10-23, Phase 5, titled "not independently verified"): the `learned` setup, `--review` and `--rescore`, and `scripts/eval/2026-10-23-phase5-review.json`.
- `51db126` (2026-10-23): `scripts/eval/2026-10-23-matching-review.json`. The script is unchanged since `ad9fba4`.

### The predecessor's review file

`--review`: "hand review, `{product id: {store: reason}}`: rejected stores" (script line 335-336). Every field is written by a person:

| Field | Meaning |
|---|---|
| `about` (top level, string) | The rule, in prose. Ignored by the script (no product has the id `about`). |
| `<product id>` | An id from the product list. Ids not in the run are ignored by the script. |
| `<product id>.<store>` | A **rejected** store: no row the engine read there is the product. The store is the engine's key: a catalogue key (`amazon`, `bestbuyca`) or a host (`rona.ca`). |
| value as a string | The reason; the rejection applies to every setup. |
| value as `{reason, setups}` | The rejection applies only to the setups listed (`apply_review`, lines 87-96): "the catalog's rows at a store may be an accessory while the web read the product itself there". A missing or empty `setups` means every setup (`value.get("setups") or _SETUPS`, line 93); an unknown setup name is silently ignored. |
| anything not listed | **Accepted.** The script cannot tell an unreviewed store from an accepted one. |

The rule, as the Phase 5 file's `about` states it (the matching file's `about` says "same rule"): "a store counts for a product when at least one row the engine read there is that product itself: any colour or finish, new, open box or renewed. Rejected: accessories and parts, another model or generation, another capacity or size, a bundle, kit or multi-pack when no row is the product, a multi-capacity listing whose price is another capacity's, and a look-alike."

**The review file alone is not enough to rescore.** `--rescore <run.json> --review <review.json>` (lines 343-354) applies the rejections to a run's saved output, the `--json` file `run_one` wrote (lines 112-168). Written by the tool, per product: `catalog_results`, `web_results`, `learned_results` (rows with `store`, `url`, `price` as a float, `currency`, `title`, `method`), the store sets derived from them, `web_unreadable`, timings and discovery telemetry. The pairing: `2026-10-23-phase5-review.json` reviews `reports/2026-10-23-phase5-evaluation.json`; `2026-10-23-matching-review.json` reviews `reports/2026-10-23-matching-eval.json` (each run JSON names its review file in `review`).

### What the rescoring computes (read off the script)

- **Setups** (line 84, lines 121-133): `before` = catalogue rows (compare rows not read through a recipe); `after` = `before` + open-web discovery rows; `with_learned` = `after` + rows read through a learned recipe (`extra.source == "learned"`).
- **Verified store** (lines 69-81): a store key with at least one row whose price the engine read (`price is not None and not error`). A store is counted once per product and setup however many rows it has, and once across the catalogue and web rows (`stores()` builds a set). A snippet price is never a row.
- **In the preferred currency** (lines 79-81, 159-167): the same, counting only rows whose `currency.upper()` is the run's preferred currency (CAD).
- **Hit, "checked"** (`apply_review`, lines 87-109): a verified store of the setup that is not rejected for that setup. `checked_<setup>` is their number per product; `checked_added_by_web` = checked `after` minus checked `before`; `checked_added_by_learned` = checked `with_learned` minus checked `after`. `row["rejected"]` keeps the rejections whose store is in the run's `with_learned` stores.
- **Summary** (`summarise`, lines 171-215): `products`; `store_prices_<setup>` and `checked_store_prices_<setup>` are sums over products of those counts; `median_stores_<setup>` is `statistics.median` of the raw per-product counts; `products_improved` (raw `after > before`), `products_improved_by_learned` (raw `with_learned > after`), `checked_products_improved_by_learned` (checked `with_learned > after`), `products_with_none_<setup>` (raw count 0) count products; `unreadable_by_reason` tallies `web_unreadable` reasons; `median_discover_s`, `median_compare_s` are request times; with a preferred currency, the same sums and medians in that currency and `preferred_currency`; `hand_checked` is `all("checked_before" in r)`.
- **No precision and no recall.** The script computes counts, sums and medians only. The write-ups derive ratios from them (below).
- **Unreviewed items** count as accepted. Rescoring with no `--review` at all gives checked = raw and still `hand_checked: true` (run on the Phase 5 run: `checked_store_prices_before` 119 = `store_prices_before` 119). A rejection of a store the run does not have changes nothing (59 such in the matching review, carried over from Phase 5).

## This project's review file

`lib/format.ts`, `ReviewFile`. Objects are strict. It keeps the predecessor's semantics (store-level verdicts per setup, unlisted means accepted) and carries the run's rows inside the file, so rescoring needs nothing else. Where the project has a contract it is used: `GoldId` and `LabellerId` from `evals/gold`, `Timestamp`, `ListingCurrency` and `MinorUnitCurrency` from `@agentic-dasher/shared`, `moneyFromDecimal` from `@agentic-dasher/core`.

| Field | Written by | Meaning | From the predecessor |
|---|---|---|---|
| `formatVersion` | tool | `1` | |
| `id` | tool | file id (slug) | review file name without `.json` |
| `run.startedAt`, `run.finishedAt` | tool | UTC, `YYYY-MM-DDTHH:MM:SS.sssZ` (S§4 `Timestamp`) | `started_at`, `finished_at`, truncated to ms (lossy) |
| `run.preferredCurrency` | tool | ISO code with minor units, or null | `locale.preferred_currency` |
| `run.preferredRegion` | tool | ISO 3166-1 alpha-2, or null | `locale.preferred_region` |
| `run.productList` | tool | path of the product list used | `product_list` |
| `review.reviewerId` | person | opaque handle (gold's `LabellerId`); never a name or an email | none recorded: `pred-unattributed` |
| `review.reviewedAt` | person | `Timestamp`, or null when not recorded | none recorded: null |
| `review.rule` | person | the rule applied, in prose | `about` |
| `review.unlistedStores` | format | `accepted`: a store with no verdict counts (the predecessor's semantics; the only value in v1) | implicit in the script |
| `products[].id`, `.category`, `.query` | tool | product id and category (slugs), the query typed | same |
| `products[].listings[]` | tool | every verified row: `source` (`catalog`, `web`, `learned`), `store` (engine store key), `url`, `title`, `price`, `readMethod` (null for catalogue rows, which have none) | `catalog_results`, `web_results`, `learned_results` |
| `listings[].price` | tool | `decimal`: exact decimal text; `currency`: `ListingCurrency`; `amountMinor`: integer minor units from `moneyFromDecimal(decimal, currency)`, or null; `refusal`: its refusal code, or null. The schema checks `amountMinor`/`refusal` against `moneyFromDecimal`, so the two can never disagree. **No float anywhere in the file.** | `price` (a JSON float): its source text, exactly; `currency` null becomes `unknown` |
| `products[].unreadable[]` | tool | `host`, `url`, `reason` of pages discovery could not read | `web_unreadable` (`error`, `manufacturer` dropped) |
| `products[].verdicts[]` | person | `store`, `verdict` (`rejected` or `accepted`), `setups` (`all` or a non-empty list of `before`, `after`, `with_learned`), `reason` (required for a rejection). At most one verdict per store and setup. | a reason → `setups: "all"`; `{reason, setups}` → that list; `{reason}` → `all` |
| `conversion` | converter | provenance of a converted file: converter version, repository (with `~`), branch, commit, both source files and their SHA-256, and `lossy`, one line per lossy step | |

### Verdicts and match relations

Neither predecessor verdict determines a `MatchRelation` (`exact, variant, bundle, accessory_or_part, other_model, other_line, unknown`), so the format keeps the coarse value and `STORE_VERDICT_POSSIBLE_RELATIONS` says what each could be:

- `accepted`: one unnamed listing at the store is `exact` or a `variant` by colour or finish (the rule accepts "any colour or finish"; S§5.4 makes a colour a variant), in any condition (new, open box, renewed). The other listings at the store are not judged.
- `rejected`: every listing at the store, in those setups, is a `variant` (capacity, size), `bundle`, `accessory_or_part`, `other_model` or `other_line` (a look-alike), **or**, for "a multi-capacity listing whose price is another capacity's", even `exact` or `variant` with the wrong price: the rejection mixes identity and price. The reason is free text; the converter does not classify it.

### How a review file relates to the gold set (`evals/gold`)

Nothing here is written into `evals/gold`. **No reviewed item in these files can become a gold relation label as it stands:**

- A gold `RelationLabel` is one relation per listing snapshot. A predecessor verdict is per store and setup, and determines no relation (above). A person must label each listing; `rejected` stores are a worklist of likely hard negatives and an `accepted` store with a single listing narrows it to `exact` or a colour/finish `variant`, but neither may be copied as a label.
- A gold `ListingSnapshot` needs fields the predecessor did not record: `condition`, `sellerKind`, `variantAttributes`, brand/model/MPN/GTIN, a per-listing `capturedAt` and `country`, and a `storeHost` (a catalogue key such as `amazon` is not a host). Title, URL and the price (as `context.priceText` + `currency`) can be carried.
- A gold `GoldProduct` needs an `identity` (brand, model, must-have attributes, condition, pack quantity); the predecessor's products have only a query string.
- The reviewer is unattributed: the gold set's labels come from a person (`evals/README.md`), and these files do not say who reviewed (see open questions).

### Aligning with `evals/gold` and the Phase 2 eval runner

- Gold times are ISO with any offset; review times are the S§4 `Timestamp` (UTC, milliseconds), as this unit's brief requires. One of the two should change.
- Gold keeps a price as page text (`priceText`); a review file keeps the machine decimal the engine read, plus minor units. The runner should write both: page text in raw candidates, Money from the observation.
- The runner should key stores by host (and store id), not by catalogue key, and write the listing fields a snapshot needs, so a reviewed listing can become a snapshot without a lookup.
- The setups `before` / `after` / `with_learned` are the predecessor's; the project's sources are the coverage record's kinds (`catalog`, `web_search`, `store`, `marketplace`). The runner's setups should be defined from those.
- The review queue labels listings ("one-tap labels that feed the gold set"): those are gold `RelationLabel`s, and a store verdict can be derived from them. A per-listing label field, and `unlistedStores: "unreviewed"`, belong in format version 2 once the queue is designed.

## The converter

```sh
node evals/review/convert.ts --predecessor ~/Documents/GitHub/hermes-shopping \
  --review scripts/eval/2026-10-23-phase5-review.json --run reports/2026-10-23-phase5-evaluation.json \
  --commit 51db126 --branch browser-agent --out evals/review/predecessor/2026-10-23-phase5-review.json
sh evals/review/predecessor/convert-predecessor.sh --check 51db126 browser-agent   # both files, compare
```

It reads only the two files, never writes into the predecessor, and refuses (exit 1) rather than guesses: an unknown setup name, a review entry for a product not in the run, extra keys on a rejection, an empty reason, a currency that is not an upper-case ISO code with minor units, a run without `learned_results`, a non-UTC run time, an unknown field, and **store lists that do not follow from the rows** (rescoring derives them from the rows, so the converter first checks every `*_stores` list of the run against them).

Prices: the run JSON is parsed with number source text kept (`JSON.parse` source access), so a price is the exact text Python wrote; exponent notation would be written out by moving digits, never through a float; minor units come only from `moneyFromDecimal`, and a refusal is kept as `amountMinor: null` plus the code (none occurred: all 809 prices convert).

Lossy steps (each converted file lists its own in `conversion.lossy`, with original values):

1. Run times truncated from microseconds to milliseconds (the originals are in `lossy`).
2. Not carried, run level: `base_url`, `summary` (recomputed), `explorer` (explorer cost telemetry), `learned_stores`, `exploration_queue`, `review` (path; kept as `conversion.reviewFile`).
3. Not carried, per product: `compare_s`, `discover_s` (float timings), `web_stores_checked`, `web_unmatched`, `web_timed_out`, `web_queued`, `web_searched`, `web_engines_not_answering`; `compare_error`, `discover_error` would be listed if set (all null in both runs).
4. `web_unreadable[].error` and `.manufacturer` not carried.
5. Derived product fields (counts, store lists, `added_by_*`, `*_already_had`, `rejected`, `checked_*`) not carried, after checking they follow from the rows; rescoring recomputes them.
6. Form, not meaning: a rejection `{reason}` with no `setups` becomes `setups: "all"` (none in these files).
7. Added: `reviewerId: "pred-unattributed"` and `reviewedAt: null`, because the predecessor records neither.

Converted: both predecessor review files (`2026-10-23-phase5-review`: 20 products, 482 listings, 81 rejections; `2026-10-23-matching-review`: 20 products, 327 listings, 78 rejections, 60 of which name no store of their setups in that run). **Left out:** `scripts/eval/web-discovery-products.json`, the product list, is not a review file; its 20 products (id, category, query) are carried in both converted files. `reports/2026-10-14-web-discovery.json` (Phase 1) has no review file (its hand check of the 35 web additions exists only as prose, `reports/2026-10-14-web-discovery.md` lines 34 and 109-111), and today's script cannot rescore it: `--rescore` on it stops with `KeyError: 'with_learned_stores'`. No personal details were found: no reviewer name, and no URL with a session, tracking or user parameter.

## Rescoring

```sh
node evals/review/rescore.ts evals/review/predecessor/*.json          # text
node evals/review/rescore.ts evals/review/predecessor/*.json --json   # machine-readable
```

Figures come in kinds: `count` (a count or sum, with n products), `share` (numerator, denominator, n, and the reduced fraction, or `undefined` for 0/0), `median` (an exact fraction, a half when n is even, or `undefined` for n = 0), `tally`, `flag`, `label`. No percentage is printed.

- **`predecessor`**: every `summarise()` figure under the script's name and definition (above), except `median_discover_s` and `median_compare_s` (request timings, not review results, not carried: `notPorted`).
- **`reportDerived`**: figures the write-ups derived, under their own names: `checked_share_of_raw_<setup>` (checked over raw store prices, the "83% of what the engine reports is the product" of `reports/2026-10-23-matching.md`), `checked_products_improved_by_web`, `products_with_none_checked_<setup>`, `checked_store_prices_by_category`.
- **`gateCandidates`**: `median_checked_stores_per_product_<setup>`, the closest figure to the S§6 gate "Verified stores per product (median) ≥6". It is **not** that gate: (1) "verified" is the predecessor engine's read, not the project's S§2.8 verified price; (2) a store counts when one unnamed row is the product in any colour or finish (S§5.4 counts a colour as a variant), new, open box or renewed; (3) the 20 products are not a held-out set; (4) the setup must be chosen (`with_learned` is everything the engine had); (5) the reviewer is unattributed.
- **`notComputable`**: the S§6 gates the data cannot give, and what is missing.

How the predecessor's figures differ from S§6:

| Predecessor figure | S§6 gate it resembles | Difference |
|---|---|---|
| `checked_share_of_raw_<setup>` (report-derived) | Identity precision (listings shown as exact) | Unit is a store, not a listing; denominator is every store with a verified row (the engine showed everything over a score of 65, with no "exact" label), not listings shown as exact; numerator includes colour variants and open-box or renewed rows; not held-out. **Not computable**: needs a per-listing shown-as-exact decision and a per-listing reviewed relation. |
| `checked_store_prices_<setup>` (a sum) and `median_stores_<setup>` (raw) | Verified stores per product (median) | A sum, or a median of raw counts, which S§6 says are never success; see the gate candidate above for the median of checked counts. |
| none | Price correctness of shown offers | **Not computable**: prices were not reviewed (a few rejections cite a price in passing). |
| none | Best-offer recall on the reviewed set | **Not computable**: no reference set of best offers independent of the engine, no reviewed prices, and an accepted store does not say which row is the product. |

## Parity

`test/parity.test.ts` rescoring each converted file must give exactly what the predecessor's own `--rescore` gave on the originals: every `summarise()` figure (except the two timings) as an exact fraction (counts as n/1, medians from the script's float converted exactly, shares' numerators plus their denominator = products), and every product row's store sets, checked counts, added stores and rejected stores, store by store. It also ties each converted file to its golden file by the SHA-256 of both source files.

The golden figures were obtained by running the script itself, not by calling its functions: `sh evals/review/predecessor/golden/run-predecessor.sh <scratch> 51db126 browser-agent` runs `python -I -B scripts/web-discovery-eval.py --rescore <copy of the run JSON> --review scripts/eval/<review>.json --json <scratch>/<name>.rescored.json` with the predecessor's Python (`pricewatch/.venv`, Python 3.12.11) under `sandbox-exec` with the network denied (a loopback connect inside it fails with `PermissionError`) and writes denied under the predecessor tree; `golden.ts` then copies the figures verbatim. Re-run on 2026-11-18, the outputs equal the committed golden files as parsed JSON. Running the copied file matters: `--rescore` without `--json` overwrites the run file it reads (line 351).

Published numbers against the script today: the summary and every product row the script writes today **equal** the published run JSONs (`publishedSummaryEqual`, `publishedProductsEqual`). The write-ups' figures agree with it too (checked in the parity test from `golden/published.json`): 64 / 108 / 124 checked and 119 / 163 / 201 raw (Phase 5), 70 / 110 / 123 and 84 / 124 / 140 (matching rerun), 54% / 66% / 62% = 64/119, 108/163, 124/201 and 83% / 89% / 88% = 70/84, 110/124, 123/140, 17 of 20 products gaining a checked store from the web, SUNLU PLA+ the one product with no checked catalogue store, and the per-category sums. Two labelling points, not number differences: `reports/2026-10-23-matching.md` line 139 heads a row "Median stores per product, hand-checked setups" whose values are the raw medians (its last column says so); and the matching report's failure-class breakdown (classes 1-4) cannot be reproduced, because the class of a rejection is not in the review file.

## Open questions for the owner

1. Is `~/Documents/GitHub/hermes-shopping` at `51db126` (branch `browser-agent`) the reference copy?
2. Who made the two reviews? The files record no reviewer; the Phase 5 commit is titled "not independently verified". If the predecessor's agent made them, they are not person labels and should not seed gold labels.
3. Should a colour or finish variant count as a hit in this project's coverage figures, as the predecessor's rule had it, given S§5.4 treats it as a variant?
4. Should price-based rejections ("a multi-capacity listing whose price is another capacity's") stay in the identity verdict, or become a separate price verdict?
5. Review times: S§4 `Timestamp` here, offset datetimes in `evals/gold`. Which one for both?
