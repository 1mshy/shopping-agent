# evals/judge-spike: spike D, the model judge

Plan P0 workstream 5, spike D: "Run the rule-guided batched judge prompt (S§5.4) against the predecessor's hand-reviewed title pairs on two hosted mini-class models and one local model. Measure precision per error class (other line, wrong capacity), batch-size degradation, and tokens and cost per batch."

**Status: part 2 done (2026-11-23).** The owner narrowed the spike to one hosted model, Claude Haiku 5.5 on the native Anthropic API; part 2 added that call path (`--api anthropic`, below) and ran the default plan twice, at effort `low` and `medium`, for $0.52 in all. Results, limits and the decision: `docs/spikes/d-model-judge.md`. The sections below were written for part 1 and still describe the harness; "What the owner must supply" and the open questions are answered or carried in that report.

**Dataset changed after the runs (2026-11-24).** The published results (part 2, `docs/spikes/d-model-judge.md`) were measured on the dataset as of commit `d5acab7`: 158 items, fingerprint `e930f87b1a1f73796e60025c744c028c6779a90d651516d78c8c993a954a7e29` (53 `exact`, 123 single, 35 sets). Applying the owner's rulings and the orchestrator's settled details of 2026-11-23 to the matcher corpus (P0-3e) changed five golds, no asked side, listing or case: `match-identifiers/url-path-names-the-model` and `canonical-url-names-the-model` from `exact` to `unknown` (a model number in a URL path is supporting evidence, never identity on its own); `match-owner-rulings/plus-asked-listing-plain` and `plus-asked-listing-matte` from `other_line` to the set `other_model`/`variant`, and `another-line-silk` from the set `other_line`/`unknown` to `other_model`/`variant` (a name suffix that changes the line or the material makes a different product, `other_model` or `variant`, never `exact`). The dataset is now 158 items, fingerprint `5520a85bf3f93b3e01f4eb9ee201fab5810fc414dbf931b6bf10e7240eb02236`. The tables below describe the new dataset; the measured numbers in the report are unchanged and belong to the old one. `report.ts` refuses a run whose fingerprint differs, so the part 2 runs can be re-scored only on a checkout of `d5acab7`.

| Path | What |
|---|---|
| `dataset.ts` | The dataset: one item per matcher-corpus case, built by importing the corpus areas |
| `prompt/judge.v1.md`, `prompt/load.ts` | The judge prompt (versioned, pinned by sha256) and its loader and renderer |
| `run.ts`, `lib/runner.ts` | The runner CLI: batches, the call, budgets, result files |
| `lib/chat.ts` | The Chat Completions request, reply parsing and validation, usage and cost |
| `lib/anthropic.ts` | The native Anthropic Messages request through `@anthropic-ai/sdk` (`--api anthropic`), its reply and usage |
| `lib/budget.ts` | The four budgets, checked before every call |
| `lib/batches.ts` | Deterministic batch composition and the plan estimate |
| `lib/score.ts` | The scoring rules |
| `report.ts`, `lib/report.ts` | The report generator |
| `lib/records.ts` | The result-file formats |
| `test/` | Vitest: no network beyond 127.0.0.1, no model |

## What the spike measures, and what it cannot

It measures the judge **on its own**, on a hard set:

- the precision of `exact` (right accepts over all accepts), overall and for each class of wrong product it accepted;
- the recall of `exact` on this set, the abstention rate (`unknown`), the invalid-batch rate, and wrong non-exact relations, counted apart from false accepts;
- all of these per nominal batch size, per actual batch length and per position in the batch (batch-size degradation);
- agreement across trials;
- input and output tokens and cost per batch and per listing, by batch size, and call latency;
- for a local model, the veto-only reading of S§5.4 ("a small local model may only veto, never accept") next to the plain one.

It **cannot** show:

- **The judge's lift over rules.** Tier 2 (the title rules) is not implemented until Phase 1, so what the judge would have to beat is not available. The risk-register question ("Model judge adds little over rules") can only be answered at the P2 gate ("The tier-3 judge's lift over the P1 rules-only baseline is reported"). This spike gives the judge's stand-alone numbers on a hard set.
- **The S§6 identity-precision gate.** That gate is measured on the held-out gold set (S§5.16), which has no labels yet. A precision measured here is a precision **on this set**.
- **The product's judge.** In the product the judge sees only the ambiguous band that tiers 1 and 2 leave, cheapest and outlier listings first. Here it sees every pair, including the ones rules settle easily, and no price (there is none in the corpus).

## The dataset

`dataset.ts` imports the four matcher areas of the fixture corpus (`evals/corpus/areas/{match-title-rules,match-identifiers,match-owner-rulings,known-failure-wrong-variant}`) and makes one item per case. The asked side, the listing and the expectation are the corpus's own objects (a test checks identity, not just equality). Each item adds its corpus area and case id, the kinds of evidence the case cites, an error class, and the listing fields the judge is not shown.

What it is:

- **158 query/listing pairs from one owner's shopping** (3D printers and filament, a drill, earbuds, a toothbrush, a pitcher, an SSD and a few more), ported from the predecessor's tests, hand reviews, reports and owner rulings.
- **Labels from mixed evidence.** 129 cases cite a predecessor test, 83 a hand review; many cite both. The predecessor's two hand-review files are per store, not per listing (see `evals/review/README.md`), so they are not used here directly: only corpus cases, whose labels say how they were derived.
- **37 items without a single label** (35 at `d5acab7`). Their gold is a set of relations that never includes `exact`: the evidence says "not the product" and no more. Any `exact` on them is a false accept; any relation in the set is a right rejection.
- **No held-out split, and heavily weighted to hard cases**: accessories that name the product, Combo and Plus rulings, other models of the same line. It is not a sample of what a search returns.
- **The asked side is the predecessor's query string only** (`name`; brand, model, MPN and GTIN are null), with its case as typed, so "Logitech MX Master 3S" and "logitech mx master 3s" are two asked products.
- **A gold `unknown` is the code tiers' expected output**, "no positive evidence either way", not the truth about the listing. One of them is, per its case, the right drill under a name without the model number; two more (since 2026-11-24) are listings whose only identity evidence is a model number in the URL. Rule 4 of the prompt ("a match needs positive evidence") asks the judge for `unknown` there too, so an `exact` on it is scored as a false accept (class `no_positive_evidence`).
- **"Wrong capacity" has one item.** The plan names it as an error class to measure. Only one single-label case says the difference is a capacity (`six-cup-for-ten-cup`); one more is in a set (`six-cup-space-saver-for-ten-cup`, variant or other model). A per-class precision for capacity is a single judgement per trial.
- **The judge does not see URLs** (S§5.7: "judge: listing titles/attrs only"). 14 listings have one. At `d5acab7`, 2 of their 4 `exact` golds rested on the URL alone (`url-path-names-the-model`, `canonical-url-names-the-model`), so a judge that follows rule 4 answered `unknown` there, a recall cost built into the set; since 2026-11-24 those two golds are `unknown` themselves, and 2 `exact` golds with a URL remain.

Error class, for single non-exact golds only: the gold relation itself; `variant` is split into `variant:capacity` or `variant:configuration` only where the case's own text says which (`VARIANT_SPLIT` quotes the words, and a test checks they are in the case), else `variant:unspecified`; a single `unknown` gold is `no_positive_evidence`. Sets have no class and are reported as one bucket, `set`.

Composition, as `compositionMarkdown` computes it (a test keeps this table equal to the code's output; `node evals/judge-spike/run.ts --plan` prints it):

| Gold label | Items |
|---|--:|
| `exact` | 51 |
| `variant` | 7 |
| `bundle` | 2 |
| `accessory_or_part` | 35 |
| `other_model` | 17 |
| `other_line` | 3 |
| `unknown` | 6 |
| a set of relations (no single label, never `exact`) | 37 |
| **Total** | **158** (121 single, 37 sets) |

| Corpus area | Single label | Set | Total |
|---|--:|--:|--:|
| match-title-rules | 79 | 8 | 87 |
| match-identifiers | 9 | 7 | 16 |
| match-owner-rulings | 29 | 19 | 48 |
| known-failure-wrong-variant | 4 | 3 | 7 |

| Evidence kind cited (an item counts under each kind it cites) | Items |
|---|--:|
| test | 129 |
| review | 83 |
| report | 37 |
| code | 29 |
| run | 56 |
| spec | 109 |

| Error class (single non-exact labels only) | Items |
|---|--:|
| `other_line` | 3 |
| `other_model` | 17 |
| `variant:capacity` | 1 |
| `variant:configuration` | 5 |
| `variant:unspecified` | 1 |
| `bundle` | 2 |
| `accessory_or_part` | 35 |
| `no_positive_evidence` | 6 |

Listings with a URL, which the judge is not shown (S§5.7): 14, of which 2 have an `exact` gold.

## Batches

A batch has the product's shape: **one asked product and up to N of its listings** (S§5.4, S§5.6 step 5), with listing ids `L1`…`LN` by position. Items are grouped by their asked side; for each trial and nominal size, each group is shuffled with a seeded PRNG (mulberry32) and cut into batches of N, and the batch order is shuffled too. Each item appears once per batch size per trial. Every item record keeps its batch, its position and the batch's composition (item keys in listing order), because position and batch-mates are part of batch-size degradation. Trials run first, so a run cut short by a budget has covered every size of its first trial.

**Consequence: most batches are shorter than their nominal size.** The corpus has 37 asked products; only one has 15 or more listings and four have 10 or more. At nominal size 15 there is one full batch per trial; at 10, four. The report therefore also gives every figure by **actual batch length**. Filling batches with listings of other asked products would reach the nominal sizes but is not the product's shape; it was not done (see open questions). The gold set (60 products × 15-25 snapshots, S§5.16) is where full batches of 10 and 15 exist.

## Scoring rules (fixed before any result; `lib/score.ts`, tested)

For one judgement (the judge's relation for one item):

| Judge says | Gold | Outcome |
|---|---|---|
| `exact` | `exact` | **right about exact** (true accept) |
| `exact` | a single non-exact relation, or a set (sets never hold `exact`) | **false accept** |
| `unknown` | anything | **abstention**: neither an accept nor an error of acceptance, counted on its own |
| a non-exact relation | `exact` | false reject |
| a non-exact relation the gold accepts (equal, or in the set) | non-exact | right rejection |
| a non-exact relation the gold does not accept | non-exact | **wrong non-exact relation**, counted apart from false accepts (it does not show a wrong product as the product) |

- **Invalid output** (after the one repair retry, or a failed call): every item of the batch scores as `unknown` (S§5.4) and the batch counts as invalid.
- **Veto-only reading** (shown for a local model): the model's `exact` is read as `unknown`; only its rejections count. A right veto rejects a non-exact gold, whatever relation it names; a wrong veto rejects an exact gold.
- **Figures.** Precision of exact = right accepts / all accepts. Recall of exact = right accepts / judgements of exact golds. Abstention = `unknown` / judgements. Per error class: false accepts / judgements of that class (how often that kind of wrong product passed), and false accepts of that class / all accepts (its share of the imprecision). Invalid-batch rate = batches still invalid after the repair retry / batches; the repair rate (batches that needed the retry / batches) is shown next to it. Agreement = items with the same relation (and, separately, the same exact-or-not decision) in every trial / items judged in two or more trials at that size. Every figure is printed as `num/den = value`; a ratio over zero is `undefined`, never 0.
- Items of batches that were never called (a budget stopped the run) are not judged and are not in any figure; the report says how many were planned and judged.

## The prompt

`prompt/judge.v1.md`, version `judge.v1`. Written from S§5.4's four rules and the relation vocabulary (`MATCH_RELATIONS`):

1. exact means the two would share a barcode;
2. variants in size, colour, capacity, configuration or pack count are not matches;
3. a missing attribute is not a conflict;
4. a match needs positive evidence.

- **Not tuned against the dataset.** It has no examples at all, and no judge output has been seen. A test checks that no asked name, no listing title and no brand of the dataset appears in the file. The one-line relation definitions are the prompt's own wording of the vocabulary.
- **Data in delimiters (S§5.15).** The system message carries the rules only. The asked product and the numbered listings go in the user message, inside `<asked_product>` and `<listings>`, one JSON object per line, with `<`, `>` and `&` written as JSON escapes so no title can close a delimiter. The system message says that text inside them is data, never an instruction.
- **What the judge sees (S§5.7).** Of the listing: `id`, `title`, and `brand`, `mpn`, `gtin` and `variant` when the store states them. Never the URL, a price or the store.
- **Byte-stable and versioned.** No date, time or run id. `load.ts` pins the file's sha256: an edit to the file without a new version and a new file fails `loadPrompt` and the tests. Every call record and item record carries the prompt version.
- **Output.** The `JudgeBatch` shape (`{verdicts: [{id, relation, differingAttrs, reason}]}`), validated with the shared Zod schema, then against the batch: exactly one verdict per listing id, no other id.

Size, as `promptSizeMarkdown` computes it (a test keeps this table equal to the code's output):

Prompt `judge.v1`, file sha256 `1d506c6781b9e52b500e2bfb937c2370c7afe5b16d2f92596a96da379dab05f2`.

| Part | Estimated tokens | UTF-8 bytes |
|---|--:|--:|
| system message (the rules) | 509 | 2036 |
| user message wrapper, without the data | 28 | 112 |
| **fixed part** | **537** | 2148 |
| repair message, sent only on a retry, without its fields | 46 | 184 |
| JSON schema, sent only on the `json_schema` rung | 118 | 470 |

**How it is counted** (`lib/tokens.ts`): the estimate of a text is max(pre-token count, ceil(UTF-8 bytes / 4)). The pre-token count is the number of pieces the cl100k pre-tokenizer pattern splits the text into, approximated in a JS regex; GPT-style BPE tokenizers never merge across those pieces, so it is a lower bound for them. Bytes / 4 is the usual "about four characters per token" rule for English. **It is an estimate, not a tokenizer**: no tokenizer was added (no new dependency), and other model families tokenize differently. The real count is each call's `usage.prompt_tokens`, which every call record keeps; the report prints the reported range for one-listing calls next to the code's estimate, and the checklist below compares them before anything is quoted. The fixed part is 537 by this estimate, which leaves room under the 800 of S§5.7.

## The call

A minimal, non-streaming Chat Completions request over raw `fetch` (`lib/chat.ts`, fields cited there from the OpenAI and OpenRouter reference pages): `model`, `messages` (system, user), `max_completion_tokens` or `max_tokens`, `stream: false`, and `temperature` and `reasoning_effort` only when given.

**Structured output** (S§5.7's ladder, as far as a flag selects it; `--structured`):

| Rung | Request | Reading |
|---|---|---|
| `json_schema` (default) | `response_format: {type: "json_schema", json_schema: {name: "judge_batch", strict: true, schema}}` | content must be the JSON object (after any `<think>` block) |
| `json_object` | `response_format: {type: "json_object"}` (the prompt asks for JSON) | the same |
| `text` | no `response_format` | the first balanced JSON object is extracted from the text |

The forced-tool rung of S§5.7 is not built (a spike runner; see open questions). There is no automatic fall-back between rungs: a run uses the rung it was given, so its figures belong to that rung.

### The native Anthropic Messages path (`--api anthropic`)

Added in part 2 for Claude Haiku 5.5, which the owner reaches on the native Anthropic API (2026-11-23). `lib/anthropic.ts` sends one non-streaming `messages.create` through the official SDK (`@anthropic-ai/sdk` 1.12.0, API version `2026-10-21`), not through Anthropic's OpenAI-compatibility endpoint. Everything around the call is shared with the chat path: the batches, the prompt, the four budgets checked before every call, the one repair retry, validation with `JudgeBatch` and against the batch, the records and the leak check.

| | Chat Completions (`--api chat`, default) | Messages (`--api anthropic`) |
|---|---|---|
| Endpoint | `<base-url>/chat/completions` over `fetch` | `<base-url>/messages` through the SDK; `--base-url https://api.anthropic.com/v1` (the SDK is given the host and appends `/v1/messages`) |
| Rules | system message | top-level `system` |
| Structured output | `response_format` (`json_schema`, `json_object`) | `output_config.format: {type: "json_schema", schema}` on the `json_schema` rung; no `json_object` mode exists (refused); `text` sends none |
| Reasoning | `reasoning_effort` when given | `thinking: {type: "adaptive"}` always (Haiku 5.5's default, sent so the record says so) and `output_config.effort` from `--reasoning-effort` (`low` … `max`; Haiku 5.5's default is `medium`). `budget_tokens` is never sent |
| Sampling | `temperature` when given | refused: Haiku 5.5 rejects non-default sampling, and API version `2026-10-21` rejects `temperature`, `top_p` and `top_k` on every model |
| Output cap | `max_completion_tokens` or `max_tokens` | `max_tokens` (`--max-tokens-field` is refused) |
| Repair retry | reply as assistant turn, then the repair | the same; the reply's text only (no thinking blocks), and the conversation always ends on the user's repair turn (Haiku 5.5 has no assistant prefill) |
| Reading the reply | `finish_reason`, `refusal` | `stop_reason` first: `refusal` (with `stop_details.category`, kept as `invalidDetail` `refusal:<category>`) and `max_tokens` / `model_context_window_exceeded` (truncated) are refused before any content is read; then the text blocks, thinking blocks skipped |
| Usage | `prompt_tokens`, `completion_tokens`, details | input = `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens` (Anthropic's `input_tokens` is the uncached part only); output = `output_tokens` (thinking included); reasoning = `output_tokens_details.thinking_tokens` |
| Cost | provider figure, else settings prices | settings prices only (the API reports no cost; `--provider-cost-currency` is refused) |
| Retries | none | none: the client is built with `maxRetries: 0`, so an HTTP error or a timeout is one call, as on the chat path |
| Credentials | `Authorization: Bearer` from `--api-key-env` | the key from `--api-key-env` passed to the client in code, so no `ANTHROPIC_*` variable is read; the SDK sends it as `Authorization: Bearer`. The record keeps the headers the SDK actually sent, with `authorization` and `x-api-key` written `[REDACTED]`. SDK logging and telemetry are off |

**Validation and the one repair retry.** A reply is refused when it is a refusal, truncated (`finish_reason: "length"`), empty, not JSON, not a valid `JudgeBatch` (strict keys, a known relation, distinct attribute names with no price word, empty `differingAttrs` for `exact`, 1-15 verdicts, each id once), or when its count or ids do not match the batch. A refused reply gets **one** repair retry in the same conversation (the reply as the assistant message, then a fixed repair message naming the problem in fixed words; no model text is echoed). The retry is checked against every budget like any call. If it is refused too, or the budget does not allow it, the batch is invalid and all its items are `unknown`. An HTTP error, a timeout or a transport error is not retried; three in a row stop the run (`consecutive_failures`).

## Budgets (S§2.6), checked in code before every call, the repair included

All four are required arguments. `lib/budget.ts`; tests in `test/budget.test.ts` (the ledger) and `test/runner.test.ts` (each cap stops the run before the call that would pass it, counted by the scripted fetch).

| Cap | Before each call | After it | Guarantee |
|---|---|---|---|
| `--max-calls` | refused if one more call would pass the cap | counted | exact |
| `--max-input-tokens` | refused if tokens so far + this call's estimated input would pass the cap | charged with the server's `prompt_tokens`, or the estimate when none is reported | an estimate below the real count can overshoot within one call |
| `--deadline-ms` | refused at or past the deadline; the call's timeout is cut to the time left | | no call starts late; a running call is aborted at the deadline |
| `--max-spend-nanos` (in `--currency`) | with prices: the worst case of this call (estimated input + full `--max-output-tokens`, at the given prices) is reserved and refused if it would pass the cap | settled with the known cost; a call whose cost stays unknown is charged its reserve | guaranteed with prices |

**Without prices the spend cap cannot be guaranteed**: a call's cost is known only after it returns, and only if the provider reports it. The runner says so and refuses to start unless `--accept-unknown-cost` is given; it then runs on the call, token and time caps, and stops on spend only once known spend has reached the cap.

**It refuses to run without `--owner-approved`**, and without a budget, before any call. Arguments are validated before the first request, and no message quotes an argument value.

## Cost (S§5.7)

Per call, with its source: `provider` when the provider reported a cost (`usage.cost` in the body, read from its decimal text, never through a float, or LiteLLM's `x-litellm-response-cost`) **and** `--provider-cost-currency` names its currency (it must equal `--currency`; OpenRouter documents `usage.cost` as "credits", so the owner confirms what a credit is before using this); else `settings`, the given prices applied to the reported usage (every input token at the input price, so an upper bound where a cache discount applies); else `none`, which has no amount and is **never zero**. The provider's figure is always kept as text in the call record (`providerCostText`). The report shows a cost per batch only when every call of those batches has one; otherwise it says "unknown (k of n calls without a cost; known part …)".

## Records and the key

Results go to `evals/out/judge-spike/<label>-<start time>/` (git-ignored): `run.json` (settings, budgets, prompt version and sha256, dataset fingerprint, plan), `calls.jsonl` (per call: the request with the authorization header shown as `Bearer [REDACTED]`, the raw reply text, the kept response headers, parsed verdicts, validity and why not, usage normalised as `packages/shared/src/run.ts` does with null for "not reported", cost and source, latency, prompt version), `items.jsonl` (per item per judged batch: relation, batch, position, composition, validity), `summary.json` (how the run ended and what it was charged).

The key is read from the environment variable named by `--api-key-env` (validated as a name; never accepted as a value; `--api-key` is refused). Every line written to a file and every line printed is checked first with `evals/wire/leak-check.ts` (any 8-character run of the key, its base64 forms, a masked echo, after JSON-unescaping and URL-decoding). On a hit the run directory is deleted, nothing is kept, and the run exits 1: it fails closed. The check errs towards refusing: a key that shares any 8 characters with the label, the model id, the output path or a reply also stops the run.

## Running it

Part 2's runs (2026-11-23), with `CLAUDE_API_KEY` and `CLAUDE_API_URL` (`https://api.anthropic.com/v1`) loaded from the gitignored `.env`, once with `--reasoning-effort low` and once with `medium`:

```sh
node evals/judge-spike/run.ts --api anthropic \
  --base-url "$CLAUDE_API_URL" --model claude-haiku-5-5 --label haiku55-medium \
  --api-key-env CLAUDE_API_KEY --reasoning-effort medium --max-output-tokens 4096 \
  --price-input-nanos-per-mtok 100000000 --price-output-nanos-per-mtok 500000000 --currency USD \
  --max-calls 1746 --max-input-tokens 2500000 --deadline-ms 7200000 \
  --max-spend-nanos 2400000000 --owner-approved
```

First look at the plan (no key, no call):

```sh
node evals/judge-spike/run.ts --plan
```

An OpenAI-compatible endpoint, with your values in place of the `<…>`:

```sh
export JUDGE_KEY_A=...        # in your shell, never on the command line
node evals/judge-spike/run.ts \
  --base-url <https://…/v1> --model <model id> --label <hosted-a> \
  --api-key-env JUDGE_KEY_A \
  --reasoning-effort <minimal> --temperature <0> \
  --price-input-nanos-per-mtok <N> --price-output-nanos-per-mtok <N> --currency <USD> \
  --max-calls <1746> --max-input-tokens <1400000> --deadline-ms <3600000> \
  --max-spend-nanos <your ceiling for this endpoint, in nano-units> \
  --owner-approved
```

- Second hosted model: the same with its own label, key variable and prices.
- Local model: add `--local` (batch sizes default to 1, 5, 10; 15 is refused), leave out `--api-key-env` if the server needs no key, and either give prices of `0` (money cost zero, known) or `--accept-unknown-cost`.
- A sensible `--max-calls` is the plan's "at most" figure; `--max-input-tokens` about twice the plan's input estimate leaves room for repairs. A budget stop is not a failure: the run exits 3, keeps everything it judged, and the report shows planned versus judged.
- Exit codes: 0 completed; 3 stopped by a budget or by three failures in a row (results kept); 2 refused before any call; 1 refused on a leak (nothing kept) or failed.

Then the tables:

```sh
node evals/judge-spike/report.ts evals/out/judge-spike/<run dir> [<run dir> ...]
node evals/judge-spike/report.ts <run dirs> --draft <new file>   # real runs only
```

`--draft` writes a draft section for `docs/spikes/d-model-judge.md` to a new file (never over an existing one). It is refused for a synthetic run and for a run without a summary.

## The default plan, as the code computes it

`planEstimate` renders every planned batch and estimates its input as the budget check does (a test keeps this table equal to the code's output):

Plan: batch sizes 1, 5, 10, 15; 3 trials; seed 1; 158 items.

| Nominal batch size | Batches per trial | Of them full | Mean listings per batch | Estimated input tokens, 3 trials |
|--:|--:|--:|--:|--:|
| 1 | 158 | 158 | 1.00 | 330,348 |
| 5 | 54 | 20 | 2.93 | 120,893 |
| 10 | 41 | 4 | 3.85 | 94,695 |
| 15 | 38 | 1 | 4.16 | 88,663 |

- Calls: **873** (batches per trial, summed over sizes, times 3 trials); at most **1,746** if every batch needs its one repair retry.
- Estimated input tokens, first attempts only: **634,599**. Each call carries the fixed part (537 estimated tokens) and, on the `json_schema` rung, the schema (118) once; a listing line averages 27 estimated tokens. A repair retry resends the whole conversation, so it adds at least its batch's input again.
- Output is capped at 2,048 tokens a call (`--max-output-tokens`), so first attempts can produce at most **1,787,904** output tokens (reasoning included). The real figure is what the run records.

For a local model (sizes 1, 5, 10) `--plan --local` prints the same: 759 calls, at most 1,518.

Money is not estimated here: it is these token counts at the owner's prices, and the run records what it actually cost.

## What the owner must supply

1. **Two hosted mini-class endpoints and one local one**: base URL, model id, and for the hosted ones a key in an environment variable of your choosing.
2. **Their prices** per million input and output tokens (in nano-units: $0.15 per million is `150000000`), and for a provider that reports `usage.cost`, which currency that figure is in.
3. **A spending ceiling**, per endpoint or in total, for `--max-spend-nanos`; and the time you allow (`--deadline-ms`).
4. **Reasoning and temperature settings** to use (S§5.7: the judge defaults to a small hosted model at minimum reasoning effort).
5. **Approval** to run, given as `--owner-approved` by the person who starts it.
6. Answers to the open questions below that change the run (batch filling; the gold `unknown` scoring; whether `judge.v1` is the prompt to measure).

## Checklist before any result is quoted

1. The runs are not synthetic (`run.json` `synthetic: false`), were made with `judge.v1` at the sha256 above, and on this dataset (the report refuses another fingerprint).
2. Each `summary.json` says how the run ended; a run stopped by a budget is reported as planned versus judged, never as complete.
3. The reported input tokens of one-listing calls (in the report) are compared with the code's estimate; the fixed part's real size is under 800 for that model's tokenizer.
4. Invalid batches are looked at: a high invalid rate on a rung means the rung, not the judge, is being measured.
5. Read the raw replies of a sample of false accepts per class and of every invalid batch.
6. Cost: every call's cost source is known; "unknown" is reported as unknown, never as zero.
7. Every figure is quoted with numerator, denominator and n, per batch size, and labelled "on the matcher corpus (158 pairs, hard-weighted, no held-out split)", never as the S§6 gate.
8. The lift over rules is stated as not measured in Phase 0.
9. No key appears in any file kept (the runner checks; search again by hand before committing a draft).

## Tests (`pnpm test`; no network beyond 127.0.0.1, no model)

- `dataset.test.ts`: one item per corpus case, by identity; 121 single, 37 sets; error classes; the variant split quotes; this README's composition table.
- `score.test.ts`: every scoring rule and the veto-only view on hand-built golds.
- `prompt.test.ts`: the token estimate on hand-counted strings; the pinned sha256; the fixed part under 800 and this README's size table; byte stability; delimiters that a hostile title cannot close; no URL shown; no dataset product, title or brand in the prompt.
- `batches.test.ts`: determinism from the seed; each item once per size per trial; one asked product per batch; this README's plan table.
- `budget.test.ts`: each cap in the ledger; the spend reserve; unknown cost without prices.
- `chat.test.ts`: the request on each rung; id and count validation; truncation, refusal and empty replies; think blocks; extraction only on the text rung; usage normalisation; provider cost from decimal text, rounding up; cost source, never zero when unknown.
- `runner.test.ts`: refusals (no approval, no prices without the flag, each missing budget, a key-like or unset variable name, `--api-key`, user-info in the URL, batch 15 for a local model) with no call and no echoed value; each cap stopping the run before the call; the repair retry in the conversation and against the budget; invalid batches; HTTP failures; records without credentials; fail-closed on a key in a reply.
- `e2e.test.ts`: `node evals/judge-spike/run.ts` as a child process with a scrubbed environment (`PATH` and a made-up key in a made-up variable) against a scripted server on 127.0.0.1, then `node evals/judge-spike/report.ts` on its output: the key reaches the server, appears in no file and no output, the report labels the run synthetic, and a draft from it is refused. The same once more with `--api anthropic` against a scripted Messages server: every call goes to `/v1/messages` through the SDK with the key as a bearer token, the repair happens once, no file holds the key.
- `anthropic.test.ts`: the Messages request (rules in `system`, structured output, adaptive thinking, effort only when given, no sampling, no `budget_tokens`, the repair conversation ending on a user turn), the SDK base URL, one call per request with no retry on an HTTP error, a transport error by class name only, `stop_reason` read before content (refusal, truncation, thinking only), usage normalisation with null for "not reported".
- `runner.test.ts`, Messages path: refusals before any call (`--temperature`, `json_object`, `--max-tokens-field`, `--provider-cost-currency`, an effort the API lacks, no key, `--local`, an unknown `--api`); a run through the SDK; usage, cost from prices and records without the key; the repair after a refusal and after a truncation; the spend reserve; three HTTP failures in a row; fail-closed on a key in a reply.

## Open questions for the owner

1. **Batch filling.** With one asked product per batch, nominal sizes 10 and 15 are mostly short (4 and 1 full batches per trial). Measure degradation by actual length (as now), fill batches with other products' listings as labelled distractors, or wait for the gold set's 15-25 snapshots per product?
2. **Gold `unknown`.** Four single-label items (six since 2026-11-24) expect `unknown` because the listing gives no positive evidence; one of them is truly the product. An `exact` there is scored as a false accept (rule 4). Confirm, or score those items apart.
3. **Condition in the prompt.** `judge.v1` holds only the four S§5.4 rules. Two `exact` golds are open-box listings; the prompt does not say that condition is not identity. Adding it would be a `judge.v2` from the spec (condition is its own SearchIntent field), not from the data.
4. **Forced-tool rung.** S§5.7's ladder has strict json_schema → json_object → forced tool → text. The spike builds the first, second and fourth. Add the tool rung if an endpoint chosen for the run has neither json_schema nor json_object.
5. **OpenRouter's `usage.cost`** is documented in credits. Is a credit one US dollar for the purpose of the spend figures (`--provider-cost-currency USD`)?
6. **Local cost.** Report a local model's money cost as a known zero (prices of 0) or as unknown?
