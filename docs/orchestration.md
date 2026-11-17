# Orchestration ledger

The orchestrator's record of work units. It is the memory across context compaction: after one, re-read this file and `docs/progress.md` before doing anything else. Measured results live in `docs/progress.md`; this file tracks who is doing what.

Status values: `planned | running | review | merged | blocked-owner | blocked-dep`. Gate values: `holds | open | pending-owner | pending-time`.

Last updated: 2026-11-17.

## Authority settings in force

- Merging: the orchestrator may squash-merge a PR once CI is green and its own review passes.
- Concurrency: at most 4 implementation subagents.
- Phase checkpoints: stop and report to the owner at each phase exit.
- Spend: no paid services or keys unless the owner provides them in the session.

## Phase 0: Foundations, contracts and spikes

### Units

| Id | Workstream | Unit | Owner | Branch | PR | Status | Depends on | Note |
|---|---|---|---|---|---|---|---|---|
| P0-1 | ws1 scaffold | Repository scaffold | (earlier session) | `phase0/scaffold` | #1 | merged | — | Budgets measured, see progress log |
| P0-0 | cross-cutting | Ledger; `evals/` and `lab/` workspace skeletons | orchestrator | `phase0/orchestration-prep` | #2 | merged | — | Shared root-config change done once, so later units do not collide on `pnpm-workspace.yaml`, `vitest.config.ts` or the lockfile |
| P0-2a | ws2 contracts | Money, Currency (ISO 4217 minor-unit table, explicit `unknown`), S§4 vocabularies | subagent | `phase0/contracts-money` | #3 | merged | — | Independent review found no money-correctness defect; hardening fixes, `ListingCurrency`, the committed table generator and three spec edits went in before merge. Page-text price parsing stays out of scope (arrives with ws3 fixtures) |
| P0-2b | ws2 contracts | Zod domain schemas, in two PRs. A: vocabulary gaps and persisted records (Listing, PriceObservation, MatchVerdict, SearchIntent, NotificationEvent, RunRecord). B: FetchOutcome, MarketplaceOutcome, coverage record, SSE blocks | subagent | `phase0/contracts-schemas-a`, then `-b` | #9 (part A) | review | P0-2a | Owns `packages/shared`. PR A is what the migration needs; B starts after A merges. Independent reviewer confirmed that money and currency rules hold, and built valid records that break the spec: `landed` with tax unknown, a derived price above the sticker, an `exact` verdict with differing attributes, a spend hit with unknown cost, timestamps of mixed precision that mis-sort in SQLite, and a planner that could write an MPN. 20 items and the orchestrator's decisions sent back to the same subagent |
| P0-2c | ws2 contracts | Initial Drizzle migration: S§4 tables needed by P1–P3, `profile_id` on user-owned tables | — | `phase0/contracts-db` | — | blocked-dep | P0-2b (PR A) | Owns `packages/db`. Sequenced after 2b's PR A so columns and JSON shapes mirror the schemas; can run alongside 2b's PR B |
| P0-3h | ws3 fixtures | Corpus harness: `NotImplementedError` and an expected-failure helper that passes only when a case fails for that reason | — | `phase0/corpus-harness` | — | blocked-dep | P0-2a | Keeps `main` green while the corpus "fails for the right reason" (plan P0 exit). Small; may be done by the orchestrator |
| P0-3a | ws3 fixtures | Port: money parsing, currency detection and refusal, bare-$, regional URL, converted-price refusal; known failures (financing price, coupon missed, converted currency) | — | — | — | blocked-owner | hermes-shopping path, P0-2b, P0-3h | Never guess predecessor behaviour |
| P0-3b | ws3 fixtures | Port: wall classification with the saved real pages; URL guard cases | — | — | — | blocked-owner | hermes-shopping path, P0-2b, P0-3h | High-risk areas (wall classifier, SSRF guard) |
| P0-3c | ws3 fixtures | Port: matcher owner rulings, accessory and part cases; wrong-variant failures | — | — | — | blocked-owner | hermes-shopping path, P0-2b, P0-3h | High-risk (matcher) |
| P0-3d | ws3 fixtures | Port: alert semantics (cooldown, delivery gating, restock watermark, stale reads), scheduler catch-up, notify retry policy; stale-as-current failure | — | — | — | blocked-owner | hermes-shopping path, P0-2b, P0-3h | High-risk (alerts, scheduler, outbox) |
| P0-4a | ws4 gold sets | Gold-set formats, validators (six categories, ≥40% hard negatives), seeded 40/20 split, double-label agreement tooling | subagent | `phase0/gold-formats` | #8 | merged | P0-2a | `evals/gold`: formats, strict and progress validation, a split that never moves an assigned product, leakage guard (GTIN or brand+MPN), held-out rotation by retiring, a blind second-label worklist, Cohen's kappa with hand-derived test values. No products, snapshots or labels. Proposed hard-negative definition (variant, bundle, accessory_or_part, other_model) awaits the owner |
| P0-4b | ws4 gold sets | Port the hand-review JSON format and offline rescoring from `scripts/web-discovery-eval.py` | — | — | — | blocked-owner | hermes-shopping path, P0-4a | |
| P0-4c | ws4 gold sets | Grow the 20-product list to ~60, freeze listing snapshots, label, double-label 10% | owner + subagent | — | — | blocked-owner | hermes-shopping path, P0-4a, owner labels | Product candidates and snapshots can be prepared; relation labels and the second labeller come from the owner |
| P0-5A | ws5 spikes | Spike A: HTTP transport lab (`impit`, `impers`, `wreq-js`) on the predecessor's 42 lab stores + ~30 playbook hosts; JA4/HTTP2 check | — | `phase0/spike-a-transport` | — | blocked-owner | hermes-shopping path (host lists), P0-0 | Owns `lab/transport`. Real requests: plan host count only, paced. Ends with a decision on the default `HttpTransport` |
| P0-5B | ws5 spikes | Spike B: Shopify Global Catalog keyless `search_catalog` with a hosted agent profile | subagent | `phase0/spike-b-catalog` | #5 (part 1) | blocked-owner | Owner: approve hosting, accept Shopify's API terms, and decide what may be measured | Part 1 merged: `lab/catalog/SOURCES.md` checks every S§5.3 claim against Shopify's and UCP's documentation (orchestrator re-fetched the three load-bearing quotes), plus a draft profile and a tested probe client. One request was sent to the endpoint (`tools/list`, no profile). Findings that change the spike: the 10-minute cache term is confirmed; keyless access exists but Shopify says not to use it for production traffic; the API terms forbid benchmarking the API, so the planned 60-query latency measurement needs the owner's decision. Part 2 (publish, measure, report, spec edit) has not started |
| P0-5C | ws5 spikes | Spike C: platform route reachability (~200 domains per platform) | subagent (part 2 is a new one; part 1's worktree was cleaned up) | `phase0/spike-c-routes`, then `phase0/spike-c-run` | #7 (part 1) | running | P0-0 | Part 1 merged: harness, guard, pacing, robots report mode, summariser, four lists of 200 hosts from Common Crawl CC-MAIN-2026-43 (no requests to shops to build them), pilot of 40 hosts (90 requests; a shake-out, not a rate). Part 2 running: Magento probe changed to a search query, one full run on the 800 hosts at the merged limits (≤5 requests per host, 2.5–3.25 s per host, GET only), classification review from stored evidence, report with a proposed decision in `docs/spikes/c-platform-routes.md` |
| P0-5D | ws5 spikes | Spike D: rule-guided batched judge on the predecessor's reviewed pairs, two hosted mini models + one local | — | `phase0/spike-d-judge` | — | blocked-owner | owner LLM endpoints and keys; hermes-shopping path (reviewed pairs) | No paid call without owner-provided endpoints |
| P0-6a | ws6 wire fixtures | Fixture format, recorder with credential redaction, replay helper, scenario matrix (23 scenarios) | subagent | `phase0/wire-recorder` | #4 | merged | P0-0 | `evals/wire`. First review round found confirmed key leaks; all 19 items fixed with tests first (61 new tests failed against the old code). Orchestrator replayed ten echo forms of a made-up key (verbatim, case-changed, prefix, escaped slash, base64 at any alignment, URL-encoded, split, in a header) and three CLI mistakes against a local server: no key in any file or output. The leak check is now a separate net from the redaction; sessions are all-or-nothing through a staging directory. No real endpoint contacted, no recording committed |
| P0-6b | ws6 wire fixtures | Recordings: OpenRouter, OpenAI, vLLM, Ollama, llama.cpp | — | `phase0/wire-recordings` | — | blocked-owner | P0-6a; owner endpoints and keys (OpenRouter, OpenAI, vLLM); owner's OK to run local Ollama and llama.cpp | Ollama is installed on this machine; llama.cpp and vLLM are not |

### Exit gates

| Gate (plan P0 exit criteria) | Value | Status | What closes it |
|---|---|---|---|
| CI green on an empty app; multi-arch image within S§5.14 budgets | 88.0 MB pull, 278.7 MB unpacked, 26.2 MB idle, 234 ms start (n=1 local run; CI check green on PR #1) | holds | — |
| Fixture corpus exists and fails for the right reason | — | open | P0-3h, P0-3a–d merged; count of cases, all failing with `NotImplementedError` |
| Gold set v1 labelled, 40/20 split, 10% double-labelled with agreement reported | — | pending-owner | Owner labels and a second labeller (P0-4c) |
| Spike reports A–D written, each with a decision and any spec edit | 0 of 4 | open | P0-5A–D |
| Owner decisions 1, 2 and 4 recorded | 1 and 2 recorded | pending-owner | Decision 4 (robots.txt public default) |

### Waiting on the owner

| Need | Blocks | Asked |
|---|---|---|
| Confirm the predecessor location. Found: `~/Documents/GitHub/hermes-shopping`, branch `browser-agent` at `51db126`, holding every path S§7 cites (some uncommitted). `hermes-shopping-overnight-b` lacks most of them | P0-3a–d, P0-4b, P0-4c, P0-5A, P0-5D | 2026-11-17 |
| Spike B: approval to publish the agent-profile JSON on a static HTTPS host (it must serve `Cache-Control: public, max-age>=60` with no redirect; not yet checked for GitHub Pages); acceptance of the Shopify API License and Terms of Use, which using the API implies; and a decision on what may be measured given the terms' benchmarking clause | P0-5B part 2 | 2026-11-17 |
| LLM endpoints and keys: two hosted mini-class models; OpenRouter and OpenAI for recordings; a vLLM endpoint if one exists | P0-5D, P0-6b | 2026-11-17 |
| Note: the shell has an `OPENROUTER_API_KEY` set. It is not used: the owner has not provided it in this session. Say so if it may be used, and with what spending ceiling | P0-5D, P0-6b | 2026-11-17 |
| OK to run local model servers for recordings and the spike's local model (Ollama is installed; llama.cpp would run from its container image) | P0-5D, P0-6b | 2026-11-17 |
| Decision 4: robots.txt public default (`ignore` or `respect`) | P1 start, P0 exit | 2026-11-17 |
| Gold set: the six category ids; the EU country; opaque labeller handles and who the second labeller is; confirmation of the hard-negative definition (proposed: variant, bundle, accessory_or_part, other_model; alternative: everything that is neither exact nor unknown); whether 40/20/~60 are minimums or exact; then the labels themselves | P0-4c, P0 exit gate | 2026-11-17 |

## Later phases

Not cut into units yet. Open owner decisions by phase: #4 (P1), #3, #5, #6, #10 (P2), #9, #11 (P4), #7 (P5), #8 (P6), #12, #13 (P7).
