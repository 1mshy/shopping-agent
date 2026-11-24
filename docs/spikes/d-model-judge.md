# Spike D: the model judge on the matcher corpus

Plan P0 workstream 5, spike D · run 2026-11-23 · harness `evals/judge-spike/` · status: **decision proposed, owner to confirm**

> **Note (2026-11-24).** Every result below was measured on the dataset as of commit `d5acab7`: 158 items, fingerprint `e930f87b1a1f73796e60025c744c028c6779a90d651516d78c8c993a954a7e29`. Since then the matcher corpus applies the owner's rulings and the orchestrator's settled details of 2026-11-23 (P0-3e), which changed five golds and nothing else: the two URL-only `exact` golds named under "Method" are now `unknown`, and three SUNLU filament items (`plus-asked-listing-plain`, `plus-asked-listing-matte`, `another-line-silk`) now expect the set `other_model`/`variant`. The current dataset is 158 items, fingerprint `5520a85bf3f93b3e01f4eb9ee201fab5810fc414dbf931b6bf10e7240eb02236` (51 `exact`, 121 single, 37 sets). The figures here are not re-scored and stay as measured; `evals/judge-spike/README.md` describes the change.

## Question

S§5.4's tier 3 is a rule-guided, batched model judge for the listings that identifiers and title rules leave undecided: at most 3 calls of at most 15 listings, output `{id, relation, differingAttrs, reason}`, "invalid output means `unknown`". The plan asks spike D to run that prompt against the predecessor's hand-reviewed pairs and measure precision per error class (other line, wrong capacity), batch-size degradation, and tokens and cost per batch. The owner narrowed it on 2026-11-23 to **one hosted model, Claude Haiku 5.5** (`claude-haiku-5-5`), on the native Anthropic API; the second hosted model and the local model were dropped, so the veto-only reading for a local model is not measured.

Measured here, narrowly: **on 158 query/listing pairs from the matcher corpus, how often is Haiku 5.5's `exact` right, what kinds of wrong product does it accept, does that change with batch size, what does it cost, and which effort setting to use.** Not measured: the lift over the title rules (tier 2 does not exist yet), the S§6 identity-precision gate (no gold labels yet), any other model.

## Method

**Dataset** (`evals/judge-spike/dataset.ts`, described in full in `evals/judge-spike/README.md`): one item per case of the four matcher areas of the fixture corpus, 158 pairs: 53 `exact`, 70 single non-exact relations, 35 sets of non-exact relations (the evidence says "not the product" and no more). Labels come from the predecessor's tests, hand reviews, reports and the owner's rulings as the corpus ported them; heavily weighted to hard cases (accessories that name the product, Combo and Plus rulings, other models of the same line); no held-out split. The asked side is the predecessor's query string only. The judge never sees a URL (S§5.7), and 2 of the 53 `exact` golds rest on the URL alone.

**Prompt** `judge.v1` (sha256 `1d506c67…05f2`), unchanged from part 1: S§5.4's four rules, no examples, not tuned against the data; data in delimiters in the user message.

**Plan**: the default plan of part 1, unchanged: batch sizes 1, 5, 10, 15; 3 trials; seed 1. A batch holds one asked product and up to N of its listings, so most batches are shorter than their nominal size (only 3 batches of 15 exist over the 3 trials). 873 batches and 1,896 judgements per run. Each item is judged 12 times per run (4 sizes × 3 trials), so the **judgements are not independent: there are 158 distinct items, 53 of them exact.** Figures below are over judgements, as the plan's scoring rules fix them; where it matters, the distinct items are counted too.

**Call path** (new in part 2; `evals/judge-spike/lib/anthropic.ts`): the native Messages API through the official `@anthropic-ai/sdk` 1.12.0 (API version `2026-10-21`), one non-streaming `messages.create` per call. `system` carries the rules; structured output by `output_config.format: {type: "json_schema"}` with the part-1 schema; `thinking: {type: "adaptive"}` (Haiku 5.5's default); `output_config.effort` set per run; no `temperature`, `top_p` or `top_k` (Haiku 5.5 and API version `2026-10-21` reject them); no assistant prefill (a repair retry ends on the user's turn); `max_tokens` 4,096; SDK retries off. `stop_reason` is read before any content (`refusal`, `max_tokens` and `model_context_window_exceeded` are refused). The four budgets, the one repair retry, `JudgeBatch` validation, the records and the key leak check are part 1's, shared with the Chat Completions path. Tests run against scripted servers only (`test/anthropic.test.ts`, the Messages blocks in `test/runner.test.ts` and `test/e2e.test.ts`).

**Cost**: the API reports no money figure, so cost is the reported usage at the owner's prices, **$0.10 / $0.50 per million input / output tokens** (Haiku 5.5, prompts under 100K tokens), in whole nano-dollars; every input token at the input price (no prompt cache was hit: 0 cache-read tokens over all calls). The spend cap reserves the worst case of each call (estimated input + 4,096 output tokens) before sending it.

**Runs** (key and URL from the owner's gitignored `.env`; key never printed or written; every run leak-checked):

| Run | Effort | When (UTC, 2026-11-23) | Batches | Calls | Spend |
|---|---|---|--:|--:|--:|
| smoke | low | 16:37:34 | 3 | 3 | $0.000837 |
| smoke | medium | 16:37:56 | 3 | 3 | $0.001332 |
| `haiku55-low` | low | 16:38:59 to 17:02:41 | 873 of 873 | 878 | $0.208681 |
| `haiku55-medium` | medium | 16:38:59 to 17:17:02 | 873 of 873 | 876 | $0.310461 |
| **total** | | | | **1,760** | **$0.521310** |

Plus 5 calls to the free token-counting endpoint (below). **Smoke check before the full runs**: the first three batches of the size-15 plan (2, 3 and 6 listings) cost $0.000279 per call at `low` and $0.000444 at `medium`, against $0.000176-0.000342 per batch for `low` and $0.000258-0.000512 for `medium` in the full runs. Projected for 873 calls: about $0.24 (`low`) and $0.39 (`medium`), together about $0.63, under the $5 cap, so both were run, concurrently. Each full run had `--max-spend-nanos` 2,400,000,000 ($2.40), so the two could not together pass $5 even in the worst case; neither came near it. **The brief asked for one run of the default plan; two were made**, one per effort level, because the effort setting had to be decided and the smoke check showed both fit far under the cap. Both completed with no budget stop.

Raw results are not committed: `evals/out/judge-spike/` of the worktree that ran the spike (git-ignored): `run.json`, `calls.jsonl` (every request with the credential redacted, every raw reply), `items.jsonl`, `summary.json`. The tables below are `node evals/judge-spike/report.ts <run dir>` on those files, except where a table says otherwise.

## Results

Every run: 0 refusals, 0 truncations, 0 HTTP or transport errors over 1,754 calls of the full runs; every `stop_reason` was `end_turn`.

### Precision of `exact`, by nominal batch size

`medium` (n = 474 judgements per size; 159 of them on exact golds, 315 on non-exact):

| Nominal size | Precision of exact | Recall of exact | Abstention (`unknown`) | Wrong non-exact relation | False reject | Needed the repair | Invalid after it |
|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | 135/141 = 0.957 | 135/159 = 0.849 | 48/474 = 0.101 | 15/315 = 0.048 | 18/159 = 0.113 | 0/474 | 0/474 |
| 5 | 116/123 = 0.943 | 116/159 = 0.730 | 49/474 = 0.103 | 17/315 = 0.054 | 29/159 = 0.182 | 0/162 | 0/162 |
| 10 | 122/127 = 0.961 | 122/159 = 0.767 | 45/474 = 0.095 | 16/315 = 0.051 | 23/159 = 0.145 | 2/123 | 0/123 |
| 15 | 117/124 = 0.944 | 117/159 = 0.736 | 39/474 = 0.082 | 20/315 = 0.063 | 32/159 = 0.201 | 1/114 | 0/114 |
| **all** | **490/515 = 0.951** | **490/636 = 0.770** | 181/1896 = 0.095 | | | 3/873 | 0/873 |

`low` (same n):

| Nominal size | Precision of exact | Recall of exact | Abstention | Wrong non-exact relation | False reject | Needed the repair | Invalid after it |
|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | 102/107 = 0.953 | 102/159 = 0.642 | 51/474 = 0.108 | 10/315 = 0.032 | 47/159 = 0.296 | 3/474 | 1/474 |
| 5 | 84/89 = 0.944 | 84/159 = 0.528 | 44/474 = 0.093 | 20/315 = 0.063 | 60/159 = 0.377 | 0/162 | 0/162 |
| 10 | 92/99 = 0.929 | 92/159 = 0.579 | 42/474 = 0.089 | 27/315 = 0.086 | 55/159 = 0.346 | 1/123 | 0/123 |
| 15 | 84/90 = 0.933 | 84/159 = 0.528 | 45/474 = 0.095 | 22/315 = 0.070 | 58/159 = 0.365 | 1/114 | 0/114 |
| **all** | **362/385 = 0.940** | **362/636 = 0.569** | 182/1896 = 0.096 | | | 5/873 | 1/873 |

**Effort.** At the same precision (0.951 against 0.940), `medium` accepted 490 of the 636 exact judgements and `low` 362: recall 0.770 against 0.569. The difference is in false rejects (`medium` 102, `low` 220 over the four sizes), not in false accepts (25 against 23). `low` calls more listings a variant for a colour, an "assembled" or "For Mac" word, or a heatsink; `medium` more often reads rule 3 ("a missing attribute is not a conflict").

### False accepts by error class

Rate within the class over all sizes (each class's items × 12 judgements), then the distinct items involved. Per-size cells are in the generated report.

| Class | Items | `medium` false accepts | `low` false accepts | Items ever falsely accepted (`medium` / `low`) |
|---|--:|--:|--:|---|
| `other_line` | 5 | 0/60 | 0/60 | none / none |
| `other_model` | 17 | 0/204 | 0/204 | none / none |
| `variant:capacity` | 1 | 0/12 | 0/12 | none / none |
| `variant:configuration` | 5 | 0/60 | 1/60 | none / `for-business-ranked-over-an-accessory` |
| `variant:unspecified` | 1 | 0/12 | 0/12 | none / none |
| `bundle` | 2 | 0/24 | 0/24 | none / none |
| `accessory_or_part` | 35 | 5/420 = 0.012 | 5/420 = 0.012 | `printer-touch-screen` / the same |
| `no_positive_evidence` | 4 | 0/48 | 0/48 | none / none |
| set (no single label) | 35 | 20/420 = 0.048 | 17/420 = 0.040 | `model-word-without-digits`, `combo-kit-in-listing`, `combo-asked-listing-a-single-tool` / the same |

The plan's two named classes: **other line 0 of 60 judgements, wrong capacity 0 of 12 (one item)** at either effort. Every `medium` false accept is one of **4 distinct items of the 105 non-exact ones**:

| Item | Asked | Listing title | Gold | `medium` |
|---|---|---|---|--:|
| `match-identifiers/model-word-without-digits` | keurig k-mini | Single Serve Coffee Maker (MPN `K-MINI`) | set, never exact | 10 of 12 exact |
| `match-owner-rulings/combo-kit-in-listing` | dewalt dcd793d1 | DEWALT DCD793D1 Combo kit | bundle or variant | 7 of 12 |
| `match-title-rules/printer-touch-screen` | Creality K1C | Creality K1C 3D Printer Touch Screen | accessory_or_part | 5 of 12 |
| `match-owner-rulings/combo-asked-listing-a-single-tool` | DEWALT DCD793D1 Combo | DEWALT DCD793D1 20V MAX Compact Brushless Cordless 1/2-in Drill/Driver | variant or other_model | 3 of 12 |

Two of the four are the Combo rulings (the owner's own "combo counts both ways"), one is an accessory whose title is the product's name plus a part word, and one is a listing whose only identifying field is an MPN equal to the asked model word (`K-MINI`), which tier 1 would see before the judge.

### Batch-size degradation

Precision does not fall with batch size at either effort (`medium`: 0.957, 0.943, 0.961, 0.944 at 1, 5, 10, 15). **Recall does**: at `medium` 0.849 for one listing a call against 0.730-0.767 for batches, at `low` 0.642 against 0.528-0.579. Agreement across the three trials falls with it:

| Nominal size | Items in 3 trials | `medium` same relation | `medium` same exact-or-not | `low` same relation | `low` same exact-or-not |
|---|--:|--:|--:|--:|--:|
| 1 | 158 | 144/158 = 0.911 | 152/158 = 0.962 | 142/158 = 0.899 | 151/158 = 0.956 |
| 5 | 158 | 125/158 = 0.791 | 141/158 = 0.892 | 125/158 = 0.791 | 145/158 = 0.918 |
| 10 | 158 | 133/158 = 0.842 | 147/158 = 0.930 | 119/158 = 0.753 | 137/158 = 0.867 |
| 15 | 158 | 132/158 = 0.835 | 145/158 = 0.918 | 120/158 = 0.759 | 142/158 = 0.899 |

By actual batch length (`medium`, generated report): precision is 0.855 to 1.000 for every length with 13 or more accepts (length 2: 47/55; length 1: 188/197 = 0.954); the lowest is length 14, 6/9 = 0.667, from 3 batches. There are only 3 batches of 15 listings (13/13) and 3 of 14 over the three trials, so nothing is established for full batches. Position in the batch shows no consistent trend (the generated report has the tables; most cells beyond position 6 have fewer than 30 judgements).

### Tokens, cost and latency

Over all calls of each size's batches, repairs included; token counts as the API reported them:

| Nominal size | Effort | Batches | Calls | Input / batch | Output / batch | Cost / batch | Cost / listing | Latency median / p95 / max (ms) |
|---|---|--:|--:|--:|--:|--:|--:|---|
| 1 | medium | 474 | 474 | 1,183.4 | 278.9 | $0.000258 | $0.000258 | 1,764 / 3,641 / 4,920 |
| 5 | medium | 162 | 162 | 1,278.8 | 585.3 | $0.000421 | $0.000144 | 3,091 / 5,305 / 7,699 |
| 10 | medium | 123 | 125 | 1,362.0 | 731.3 | $0.000502 | $0.000130 | 3,205 / 6,465 / 7,562 |
| 15 | medium | 114 | 115 | 1,362.4 | 752.2 | $0.000512 | $0.000123 | 3,343 / 7,384 / 9,435 |
| 1 | low | 474 | 477 | 1,192.0 | 114.1 | $0.000176 | $0.000176 | 1,040 / 2,275 / 3,671 |
| 5 | low | 162 | 162 | 1,278.8 | 307.1 | $0.000281 | $0.000096 | 1,676 / 4,181 / 6,971 |
| 10 | low | 123 | 124 | 1,342.9 | 390.0 | $0.000329 | $0.000085 | 1,955 / 4,770 / 7,598 |
| 15 | low | 114 | 115 | 1,361.2 | 412.7 | $0.000342 | $0.000082 | 1,904 / 4,931 / 10,883 |

- **Reasoning**: `medium` 244,036 of 402,738 output tokens were thinking (0.606); `low` 43,127 of 198,855 (0.217). Largest output of one call: 1,891 (`medium`), 1,741 (`low`), under the 4,096 cap and also under part 1's 2,048 default.
- **Output dominates cost**: at `medium`, size 15, $0.000136 of input and $0.000376 of output per batch.
- **In the product's terms** (S§5.4: at most 3 calls of at most 15): about $0.0015 and 6,300 tokens for a full judge step at `medium`, against S§5.6's median model spend of about $0.01 and 30K tokens for a whole fast search. Every call finished inside S§5.7's 20 s per call (max 9.4 s at `medium`, 10.9 s at `low`).

**Prompt size in Haiku 5.5's tokenizer** (checklist item 3). The part-1 estimator undercounts this tokenizer: one-listing calls reported 1,150-1,271 input tokens where the code estimated 683-747. The free token-counting endpoint (`messages.countTokens`, 5 calls, the same `system` and user wrapper; a bare one-word request counts 9) gives: **the fixed part (rules + wrapper) about 682 tokens**, under S§5.7's 800 (estimated 537); **the structured-output schema about 419 tokens** of input when sent as `output_config.format` (estimated 118 as text), which is the API's own framing of the schema, not the prompt file. So a one-listing call is about 1,100 tokens of fixed input before any listing.

### Invalid output and the repair

9 of 1,754 first attempts were refused, all by the same rule (`schema`: a non-empty `differingAttrs` on an `exact` verdict, which `JudgeBatch` forbids): 6 times `["condition"]` on an open-box listing the judge called exact (AirPods Pro 2, Bambu Lab A1 Mini), twice `["configuration"]` and once `["colour"]`. The one repair retry fixed 8; one batch at `low` (an open-box AirPods listing, one listing) failed twice and scored `unknown`. No reply was empty, cut off, refused or malformed JSON: `output_config.format` held the shape on every call.

### Where the exact golds were missed (`medium`)

146 of the 636 exact judgements were not `exact` (102 a non-exact relation, 44 `unknown`). Six of the 53 exact items were never accepted in 12 judgements:

- 2 rest on the URL, which the judge is not shown (`url-path-names-the-model`, `canonical-url-names-the-model`): a recall cost built into the set (part 1's README).
- 4 are predecessor or owner rulings that a listing with an extra word is still the product. "SAMSUNG SSD 990 PRO with Heatsink 2TB … (MZ-V9P2T0CW)" for "Samsung 990 Pro 2TB" and "MX Master 3S For Mac" for "Logitech MX Master 3S": the judge called them variants, which is what rule 2 of S§5.4 says for a configuration difference ("variants in size, colour, capacity, configuration or pack count are not matches"). "PolyTerra™ PLA+ Black" for "Polymaker PolyTerra PLA 1kg" and "SUNLU PLA+ 2.0 …" for "SUNLU PLA+ 1.75mm 1kg": the owner's ruling is "Plus counts the query's way" (S§5.4 tier 2); the judge, which is not told the ruling, called them another model. Here the corpus label and the prompt disagree; the rulings belong to tier 2's rules, not to the judge's prompt.

## Limits and biases

- **One model only**, by the owner's decision: nothing here compares Haiku 5.5 with another hosted model, a smaller model or a local one, and the veto-only reading (S§5.4, local models) was not measured.
- **Labels are the predecessor's reviewed pairs, as the corpus ported them**: tests, hand reviews (per store, not per listing), reports and owner rulings. 35 items have a set, not a label. Some labels are owner rulings the prompt does not carry, or disagree with S§5.4's rule 2 (above), so a part of the "false rejects" is the judge following its rules against the label.
- **Not the S§6 gate.** That is measured on the held-out gold set, which has no labels yet. Every figure here is "on the matcher corpus (158 pairs, hard-weighted, no held-out split)".
- **No lift over rules.** Tier 2 is not implemented until Phase 1; the judge was shown every pair, including ones the rules settle, and no price. The risk-register question ("model judge adds little over rules") is open until the P2 gate.
- **12 readings of 158 items.** 1,896 judgements are not 1,896 independent observations: false accepts come from 4 items (`medium`), and the class rates for `variant:capacity` and `variant:unspecified` rest on one item each.
- **Short batches.** One asked product per batch, so nominal 10 and 15 are mostly 2-6 listings; only 3 batches of 15 listings were judged per run.
- **One day, one key, two runs side by side.** Latency includes the API's load on 2026-11-23 and the two runs sharing it; no retries were allowed.
- **Prompt `judge.v1` unchanged**: no condition rule (open-box listings drew 6 of the 9 schema refusals), no examples, not tuned.

## Decision (proposed)

The measurement is above; what follows is the author's recommendation, for the owner and the orchestrator to accept or change.

1. **Haiku 5.5 is a usable tier-3 judge on this set**: `exact` was right 490 times of 515 at `medium` (0.951), never for another product line (0 of 60) or another model of the line (0 of 204), and its false accepts are four items, two of them Combo rulings and one an MPN-only listing that tier 1 sees first. It does not show the judge clears S§6; the gold set decides that.
2. **Effort `medium`**, which is Haiku 5.5's default, sent explicitly (`output_config.effort: "medium"`). Against `low` it found 128 more exact judgements (recall 0.770 against 0.569) at the same precision, for about 1.5 times the cost ($0.31 against $0.21 per 873 calls) and about 1.7 times the median latency (3.3 s against 1.9 s at size 15). S§5.7's "minimum reasoning effort" for the judge does not hold for this model: on this set the lowest effort gives up a fifth of exact recall and gains no precision. `high` and above were not measured.
3. **Keep batches of up to 15 (S§5.4).** Precision held at every size; recall fell by about 0.08-0.12 from one listing a call to a batch, while the cost per listing halved and the latency per listing fell more. Whether full batches of 15 hold is not established here (3 such batches); the gold set's 15-25 listings per product is where to check it.
4. **Structured output by `output_config.format` works on Haiku 5.5**: no malformed, empty, truncated or refused reply in 1,754 calls; the only invalid replies broke a rule the schema cannot express (empty `differingAttrs` for `exact`), and the repair retry fixed 8 of 9.
5. **A `judge.v2` should say that condition is not identity** (open question 3 of part 1): open-box listings caused 6 of the 9 invalid first attempts. That is a prompt change for the owner to approve, not made here.
6. **The data does not support** a claim about the judge's lift over rules, about the S§6 gate, about other models, about effort `high`, or about full batches of 15.

**Spec edits I would make** (not made; `docs/spec.md` is unchanged):

- S§5.7, Roles: "The judge defaults to a small hosted model at minimum reasoning effort" becomes "The judge defaults to a small hosted model at the effort its spike measured (Claude Haiku 5.5: `medium`; spike D, 2026-11-23: `low` lost a fifth of exact recall at the same precision)."
- S§5.7, Wire adapters: add after (3) "A Messages call through the official SDK was built for the Phase 0 lab (`evals/judge-spike/lib/anthropic.ts`): adaptive thinking with `output_config.effort`, structured output by `output_config.format`, no sampling parameters, no prefill, `stop_reason` read before content." The product's adapter decision (S§9 #5) stays open.
- S§5.7, usage: add "On Messages, input is `input_tokens` plus `cache_read_input_tokens` and `cache_creation_input_tokens` (Anthropic's `input_tokens` excludes both), and reasoning is `usage.output_tokens_details.thinking_tokens`; thinking text is omitted by default."
- S§5.7, Prompts: add "The under-800 budget is checked with the endpoint's own token count (the capability probe or the provider's counting endpoint), not an estimate; a schema sent as structured output adds its own input (about 420 tokens for the judge schema on Claude Haiku 5.5)."
- Plan, risk register "Model judge adds little over rules": unchanged, still answered at P2. Plan spike D text: one hosted model (owner, 2026-11-23); veto-only reading not measured.
