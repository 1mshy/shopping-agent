# Shopping agent: implementation plan

Version 0.1 · 2026-11-16 · Companion to `2026-11-16-shopping-agent-spec.md` (cited as *S§n*). Copy both into the new repository as `docs/spec.md` and `docs/plan.md`.

## How the phases are cut

- **Each phase ends with something that runs.** `docker compose up` on a clean machine, with the work so far usable from the UI. Nothing waits for a big-bang integration.
- **Deterministic before model.** The engine (fetch, read, match, watch, alert, deliver) works with no LLM configured before any model-driven feature depends on it. This is the predecessor's strongest lesson (S§2 invariant 4).
- **Risk first.** Load-bearing claims the research could not check get a spike in Phase 0, before code depends on them. These are the Shopify Catalog keyless access, the Node TLS client's pass rate, and the model judge's precision.
- **Port with fixtures, not by translation.** Every predecessor behaviour that is ported arrives with its tests rewritten as TypeScript golden fixtures first (S§7). Code is then written to pass them.
- **Gates are measured.** Every exit criterion is a number from the eval runner or a scripted check, recorded in `docs/progress.md` with sample sizes. A phase is not done until its gate holds on the held-out set, not just the dev set.
- **Sizes** (S, M, L) are relative effort, not calendar time.

```
P0 Foundations & spikes ─► P1 Deterministic core ─► P2 Fast search + harness ─► P3 Feed, PWA, delivery
                                                                   │
                                                                   ├─► P4 Personalisation
                                                                   ├─► P5 Marketplaces & used
                                                                   └─► P6 Dig deeper (browser add-on, learning)
                                                                                    ▼
                                                                         P7 Release hardening
```

P4, P5 and P6 depend on P2 (and on P3 for their UI surfaces) but not on each other, so they can run in parallel or be reordered. The order shown follows the owner's goals: search and recommendations first, then breadth.

---

## Phase 0: Foundations, contracts and spikes (M)

**Goal.** A repository where the domain types, the fixture corpus and the evaluation tooling exist before features do, and where the four riskiest assumptions have been tested.

### Workstreams

1. **Repository scaffold**
   - pnpm workspace with `apps/server`, `apps/web`, `packages/shared`, `packages/core` and `packages/db` (S§3.2).
   - TypeScript strict on 7.x. Confirm Hono and Drizzle inference compile on day one, and fall back to 6.x if they don't.
   - Biome, Vitest, tsdown.
   - CI with lint, typecheck, unit tests, a multi-arch image build, and image size and RSS budgets as failing checks (S§5.14).
   - Licence file and contributor docs. A `docs/progress.md` log.
2. **Domain contracts** (`packages/shared`, `packages/core`)
   - Zod schemas for SearchIntent, Listing, PriceObservation (all fields of S§4.1), MatchVerdict, FetchOutcome, MarketplaceOutcome, the coverage record, the SSE block types, RunRecord and NotificationEvent.
   - Money: a minor-unit table per ISO 4217 currency, parsing, and an explicit `unknown`.
   - Initial Drizzle migration with every table from S§4 that phases 1-3 need, with `profile_id` on every user-owned table.
3. **Fixture corpus port**
   - Turn the predecessor tests named in S§7 into TS golden fixtures. Write them before the implementation.
   - Areas: currency detection and refusal; regional URL rewrite; wall classification, using the saved real pages; the matcher's owner rulings and accessory cases; alert semantics (cooldown, delivery gating, restock watermark, stale reads); scheduler catch-up; notify retry policy.
   - Also reproduce the known failures: wrong variant, financing price, coupon missed, converted currency, stale-as-current.
4. **Gold sets v1** (`evals/`)
   - Grow the predecessor's 20-product list to about 60 products: six categories, three countries (CA, US, and one EU country, e.g. DE), and ≥40% hard negatives.
   - Split 40 dev and 20 held-out.
   - Freeze listing snapshots for the matcher set; this continues into P2.
   - Port the hand-review JSON format and the offline rescoring from `scripts/web-discovery-eval.py`.
5. **Spikes.** Each spike is time-boxed and writes a short report in `docs/spikes/`.
   - **A. HTTP transport lab cell.** Read the predecessor's 42 lab stores plus about 30 hosts from the playbook over HTTP only, with `impit` (chrome151), `impers` and `wreq-js`. The result picks the default `HttpTransport`. Also assert each client's JA4 and HTTP/2 fingerprint against a capture of the Chrome version it claims (R§4.4 open questions 1-2).
   - **B. Shopify Global Catalog.** Host a profile JSON on a static HTTPS host (the project's GitHub Pages) and confirm `search_catalog` accepts it keyless. Measure latency and hit counts for 20 gold products in CA, US and DE. Note whether rate limiting is keyed by IP or by profile. Re-read the 10- vs 15-minute caching term at the source.
   - **C. Platform route reachability.** Probe a sample of about 200 domains per platform (Woo Store API, Shopify `products/<handle>.js` and `suggest.json`, Magento GraphQL, SearchAction templates) to size the reader and directory routes.
   - **D. Model judge on the predecessor's reviewed pairs.** Run the rule-guided batched judge prompt (S§5.4) against the predecessor's hand-reviewed title pairs on two hosted mini-class models and one local model. Measure precision per error class (other line, wrong capacity), batch-size degradation, and tokens and cost per batch.
6. **Wire fixtures.** Recorded request/SSE fixtures for Chat Completions from at least OpenRouter, OpenAI, vLLM, Ollama and llama.cpp. These are the base for the P2 client and probe tests.

### Exit criteria

- CI is green on an empty app that builds the multi-arch image within the S§5.14 budgets.
- The fixture corpus exists and fails for the right reason: there is no implementation yet, and the cases are not wrong.
- Gold set v1 is labelled with its 40/20 split. 10% is double-labelled, with agreement reported.
- Spike reports A-D are written. Each has a decision, and any change to the spec is made in `docs/spec.md`.
- Owner decisions 1, 2 and 4 (S§9) are recorded.

---

## Phase 1: Deterministic core (L)

**Goal.** A useful app with **no LLM at all**. Paste a product URL or a name and get it watched, with reliable drop and restock alerts. Get a verified multi-store comparison for products in the store directory.

### Workstreams

1. **Fetch** (`packages/fetch`, S§5.1)
   - Pieces: the guard, with DNS pinning and per-hop redirect checks; the `HttpTransport` chosen in spike A; the `api` and `http` rungs; the typed `FetchOutcome`; the wall classifier, passing the ported fixtures; per-host pacing persisted in SQLite; the `host_access` playbook keyed by host and page kind; cookie jars.
   - robots setting (`ignore | report | respect`).
2. **Readers** (`packages/sources`, S§5.2)
   - Platform JSON (Shopify, Woo, Magento) → JSON-LD (ProductGroup/hasVariant) → microdata → OpenGraph.
   - Stored price candidates with the `multiple_prices` outcome, variant coupling, the currency resolution order, and refusal of converted or unknown currency.
3. **Store directory**
   - `store` table, model-free host fingerprint (≤6 requests), intake from successful reads and pasted links, and `is_shop` triage.
   - In-store search routes: per-store UCP, Shopify `suggest.json`, Woo search, Magento, SearchAction/OpenSearch.
   - Seed country packs built offline from WDC (a script in `lab/`, its output downloadable).
   - A handful of hand-written adapters for giants with keyless APIs (Best Buy CA, Amazon regional).
4. **Matcher tiers 1-2** (`packages/core`, S§5.4)
   - GTIN and brand+MPN identity; title rules ported as relation labels; must-have attribute checks; the `match_verdict` cache with person overrides.
5. **Prices and verdicts** (S§5.5)
   - PriceObservation fields; effective and landed derivation with missing components; deal verdict tiers; outlier rule with second-read confirmation.
   - Store trust v1: RDAP, Tranco, look-alike check, on-page signals.
6. **Watches and scheduler** (S§5.8)
   - Save-first intake with URL normalisation and the regional rewrite; reference price rules.
   - Per-listing `next_check_at` with host back-off and incremental writes.
   - Alert rules: MAD-based drop, target, restock watermark, delivery-gated cooldown, serialised evaluation.
   - Own scheduler: overlap locks, coalesced catch-up, DNS gate, joined runs.
   - `/api/health` and `POST /api/refresh`.
7. **Delivery v1** (S§5.11)
   - Outbox with `notification_event` and `delivery`; in-app, ntfy and generic webhook channels; the ported retry policy; Test buttons.
8. **Minimal UI**
   - Owner password and session.
   - Locale wizard step: country, currency, language.
   - Watches page: paste box, list, per-listing status, rules, "wrong match" and exclude.
   - Listing view with uPlot history and verdict.
   - Settings for channels and robots mode; Diagnostics for jobs and fetch rungs.
9. **Ops**
   - Backup via `VACUUM INTO` and a restore doc; migrations at start-up; build version and available rungs in health.

### Exit criteria

- The ported fixtures (currency, walls, matcher rulings, alert semantics, scheduler, notify) all pass.
- **Freeze test:** pause the container across several due slots. Resume gives exactly one catch-up per job, no duplicate in-app events, and the outbox retries a channel that 503s and then succeeds.
- **Restart test:** watches, history and pending outbox items survive `docker compose down && up`.
- **Live check:** 20 watched listings across ≥10 hosts are read for 48 h on the HTTP rungs. Report the error rate per outcome kind; no failed read alerts.
- **Directory comparison** on the 40 dev products: verified stores per product and identity precision (tiers 1-2 only) reported against the held-out set. This is the baseline P2 must beat.
- Core image and RSS are within budget.

---

## Phase 2: Fast search and the harness (L)

**Goal.** The headline feature. Type a product or need and get a ranked, verified, multi-store result in under a minute for about a cent, with an honest coverage record. Model-assisted, model-optional.

### Workstreams

1. **LLM client** (`packages/llm`, S§5.7)
   - Chat Completions wire adapter over raw `fetch`, with an SSE parser, reasoning-field handling, `<think>` stripping, and bare-`[]` and truncation detection.
   - Usage normalisation and cost source.
   - The seven-step capability probe (S§5.7) and the `EndpointCapabilities` record editable in the UI.
   - The structured-output degrade ladder with zod and one repair retry.
   - Per-role endpoints (planner, judge, chat); circuit breaker; scheduled model health probe as a system notification.
   - Responses adapter: start here only if spike D or the probe shows the chosen default models need it. Otherwise defer to P7.
2. **Harness core** (`packages/agent`)
   - Run loop with required budgets, forced finish, deterministic finisher, repeat and invalid-call detectors, AbortSignal, typed events.
   - RunRecord and RunStep with OTel GenAI names and 14-day payload retention.
   - Versioned prompt files.
   - Test layers: scripted fake LLM, wire fixtures from P0, stored-run replay.
3. **Search providers and discovery** (S§5.3)
   - Provider interface: SearXNG add-on (compose profile, pinned image, `addons/searxng/settings.yml`), external URL, Tavily and Exa keys.
   - Per-engine token buckets, 24 h query cache, engine reporting.
   - Candidate URL filter and listing key.
4. **Shopify Global Catalog adapter**, following the outcome of spike B
   - JSON-RPC client; the terms enforced in code (TTL cache, no persistence, attribution kept, never called from jobs); re-read at the shop before anything is shown as verified.
   - Profile URL setting. Owner decision 3.
5. **Search pipeline** (S§5.6)
   - Interpret (model call 1, skipped for exact input) → parallel fan-out under a shared deadline → HTTP reads → tiers 1-2 → batched judge (model call 2, tier 3, results written to the verdict cache) → code ranking with profile constraints → optional summary with placeholders.
   - Coverage record. Clarifying chip rule in code. Cancellation.
6. **Search UI**
   - Results board fed by SSE (JSON-patch blocks, reconnect route): groups, trust labels, verdicts, coverage strip, clarifying chip.
   - "Watch this" from any result. "Dig deeper" shown but disabled until P6.
   - LLM endpoint step in the first-run wizard: the probe must pass, or the user chooses "no model yet". The fast path then runs rules-only, with listings shown as unconfirmed.
7. **Chat (minimal)**
   - Chat run type with its seven tools (S§5.7). No fetch or browse tool. Watch changes go through the same service functions as the UI.
8. **Evaluation**
   - Live search eval runner over the gold search set (3 countries, 3 trials).
   - In-app review queue (50 listings per run, stratified by tier) feeding hand-review JSON.

### Exit criteria

These are measured on the **held-out** products; revise the gate values in the spec only with written reasons.

- Zero critical regressions (currency, variant, stale, fabricated) on the frozen corpus.
- Identity precision ≥90% on hard goods. Clothing and furniture are reported separately.
- Price correctness ≥98%. Median verified stores per product ≥6. Best-offer recall ≥70%.
- Fast mode p50 ≤30 s and p95 ≤60 s. Median spend ≤$0.01 and hard cap $0.03 on the chosen default judge and planner models. Tokens per search are reported.
- The tier-3 judge's lift over the P1 rules-only baseline is reported. If it adds less than its cost, the judge stays on for the ambiguous band only and the spec is updated.
- **Model outage drill:** endpoint unreachable. Search still returns rules-only results labelled unconfirmed; watches and alerts are unaffected; the health notification fires once.
- **Probe matrix:** the capability probe gives correct records for OpenRouter, OpenAI, vLLM, Ollama and llama.cpp (wire fixtures plus at least two live endpoints).
- Cancelling a run returns partial evidence, and no further model call is logged after the cancel.

---

## Phase 3: Feed, PWA and delivery (M)

**Goal.** The feed-first product the owner asked for: a "For you" home that already has useful content from watches, searches and deals before personalisation exists, plus push and chat-app delivery.

### Workstreams

1. **Feed v1** (S§5.10, the code generators only)
   - Watch drops and restocks, new verified offers on watched products, "watch this?" from repeated searches, and searches awaiting a clarification.
   - Deal feeds ingested by code (Slickdeals, RedFlagDeals, Pepper, OzBargain per country) as leads. They are confirmed by a live read before they show a price. Shopify `compare_at_price` markdown scan on stores in the directory.
   - Feed assembly each morning plus on-demand refresh, catch-up after sleep, the finite card count, and evidence on every card.
   - Feedback buttons write `event` rows.
2. **PWA**
   - vite-plugin-pwa (`injectManifest`), installable, offline shell, bottom tab bar (S§5.12).
   - SPA first-load budget checked in CI.
3. **Channels**
   - Web Push (VAPID): subscription management, plus a UI explanation of the HTTPS requirement with a fallback suggestion.
   - Telegram (bot token, chat id). Discord webhook.
   - Quiet hours, per-kind channel routing, recommendation push limits (1 a day, 3 a week). Configured watch alerts are exempt.
4. **Settings polish**
   - Self-describing provider, channel and add-on definitions that generate forms.
   - The environment-versus-DB source shown per setting. Secrets encrypted at rest. Trusted-header auth option.
5. **i18n**
   - Catalogues extracted; French as the first translation.

### Exit criteria

- The feed shows grounded cards for an install with ≥5 watches and deal feeds on, and no model is configured.
- Push, Telegram and Discord each deliver a real alert. A forced 429 and then a 200 gives exactly one message. Quiet hours hold an alert and release it afterwards.
- **Freeze test** across the morning assembly slot: one feed per day, no duplicate push.
- PWA installs on Android Chrome and iOS Safari (home-screen push where the platform allows); Lighthouse PWA checks pass.

---

## Phase 4: Personalisation (M)

**Goal.** The app learns the user and suggests what to search for, with a profile the user can read and correct.

### Workstreams

1. **Profile store**
   - `profile_fact` and `profile_constraint`; rendering to a ≤6,000-character document; edit, retire and reject in the UI; provenance shown.
   - Constraints (dislikes, budgets, sizes, never-show) enforced in search ranking and feed filtering.
2. **Interview**
   - Six skippable steps ending in thumbs on ten real deal cards (S§5.10); runs in the wizard and from Settings.
   - Afterwards, at most one weekly inferred-fact confirmation card.
3. **Implicit signals**
   - Event weights with 14- and 180-day half-lives, topic Beta counts, and "gift / for someone else" scoping on searches.
4. **Purchase import**
   - Amazon "Request my data" zip; generic CSV with a model-proposed mapping applied by code; `.eml`/`.mbox`; read-only IMAP on one folder.
   - Preview before commit, per-source consent, and a "what was sent" log. Manual "I own / I bought".
5. **Model generators** under the daily token cap
   - Deal-to-profile judge (FTS5 prefilter, batches of 5, ≤8 calls a day).
   - Lifecycle class and complements per owned item.
   - Replenishment computed in code.
   - Weekly reflection (≤5 proposed fact operations) and weekly exploration ideas.
   - Code filters on everything the model returns.
6. **Recommended searches**
   - Feed cards that open a pre-filled search.
   - An optional setting to pre-run them under a separate recurring budget, off by default.
7. **Recommendation evaluation**
   - Impression logging; per-generator acceptance, dismiss and push-open rates; automatic slot halving under 5% acceptance; weekly offline replay.
   - A frozen set of synthetic profiles and deal snapshots per model class.
   - Optional local embeddings, switched on only if keyword recall on that set is under about 70%.

### Exit criteria

- Profile edits and deletions propagate to the next feed and search: a constraint added excludes matching cards the same day, and a deleted fact never reappears in a prompt (checked through run records).
- Gift-search and already-owned cases behave correctly in scripted scenarios.
- Daily model spend for recommendations stays under the cap over a 7-day soak. When the model is down, code-only cards still ship and judged deals are held.
- Acceptance and dismiss rates per generator are visible in Diagnostics after two weeks of the owner's own use. Owner sign-off that the feed is useful is recorded.

---

## Phase 5: Marketplaces and used goods (M)

**Goal.** Saved searches on local marketplaces and eBay, valued honestly, with scam flags. Used listings also appear as their own group in normal search results.

### Workstreams

1. **Adapter framework**
   - `MarketplaceAdapter` and its typed Outcome; health that counts only `parse_error`; daily request caps per site; "broken since" in the UI.
2. **Wave 1 adapters (core)**
   - Kijiji first (owner's region), then Craigslist, OfferUp, Marktplaats/2dehands, Kleinanzeigen, Gumtree, Subito, and Best Buy CA open-box.
   - Refurb stores through the generic reader with a condition field.
   - Fixtures shaped like the real payloads. Read flipwatch (MIT) for parser approaches; read ai-marketplace-monitor (AGPL) for ideas only.
3. **eBay Browse** (BYO keyset)
   - Settings flow with the deletion-exemption explanation (owner decision 7), 30-minute poll, auctions off, no seller username stored.
4. **Saved-search pipeline** (S§5.9)
   - Silent first run; diff on external id; gone after three clean polls; cross-post clustering (title, price, place, photo hash).
   - Code filters, then the batched model judge under a daily cap; alerts labelled "unchecked" when there is no model.
5. **Valuation and scam flags**
   - Percentile and new-price thresholds (S§5.9) and named flags. Facebook deep link in the core.
6. **UI**
   - Saved searches tab within Watches, listing cards with condition, distance, flags and valuation basis, and a used group in search results.

### Exit criteria

- **Sustained polling soak:** each wave 1 adapter runs one saved search at its default interval for 7 days. Report success rate per outcome kind. Any adapter under 90% `ok` is demoted to "experimental" in the UI.
- Cross-post clustering and gone detection pass fixture scenarios. No alert fires for a re-seen listing after a restart.
- Valuation thresholds are reviewed against 7 days of real saved-search data and tuned with written reasons.
- Condition, seller and locality checks pass on the gold set's used and refurbished products. A missing marketplace access stays explicit in the coverage record.

---

## Phase 6: Dig deeper (L)

**Goal.** The opt-in deep run: a real browser for stores HTTP cannot read, model-driven browsing of hard stores under strict caps, and durable learning so the next search does not need the model.

### Workstreams

1. **Browser add-on** (`addons/browser`, S§5.1)
   - Chrome headed on Xvfb under an init process, one pinned and cached package for amd64 + arm64, profile on a named volume, noVNC, a token-gated CDP forwarder, idle stop, and egress through the core's filtering proxy.
2. **Browser rung**
   - `connectOverCDP` via `patchright-core`; self-clearing challenge wait; site-only session drop; separate browser pool; results stream in after HTTP results.
   - The `person` rung as a UI task with the noVNC view.
   - Re-run the access lab with the CDP attach against the predecessor's setup (R§4.4 risk 2).
3. **Browse run type**
   - Five page tools on `ariaSnapshot({mode:'ai'})` and `getByRef`; `page_read` runs the code extractor; at most one snapshot in context; ~2,000-token extracts.
   - 15 turns / 180 s / 150K tokens per store and one fresh context per store. The run ends on a wall or captcha. It sees the product spec only, never the profile.
4. **Deep job orchestration**
   - Query expansion, more hosts, browser reads, and the wider judge. The cost and time cap is shown before start (default 10 min / $0.50), and the plan is streamed as the first event.
5. **Product-quality read**
   - On demand: aggregate ratings unaveraged; expert and community sources from a user-editable list; quoted-span verification in code; 30-day cache.
6. **Learning from runs** (rework of the predecessor's recipes)
   - When a browse run reports a listing, code derives a declarative recipe (search URL template, product-link pattern, and a read route, with a price XPath only if structured data lacks the price).
   - The recipe must replay independently on a second query before activation. Health counts only recipe-owned failures, and three in a row marks it broken and requeues it.
   - The exploration queue applies triage first, then lease, attempt cap and back-off. Queue doors are REST only.
   - Intake prioritised by demand from active searches and watches.
7. **Optional `remote` rung**
   - One interface for an external CDP endpoint or proxy, documented, untested credentials labelled as such.
8. **Browser-only marketplaces** (optional, owner decision 8)
   - Vinted, Mercari and Depop adapters; a Facebook adapter only if the owner approves.

### Exit criteria

- **Access lab:** the add-on reads ≥ the predecessor's 31 of 42 lab stores (E4 cell), or the gap is explained per store.
- **Containment tests:** from a page in the add-on, the app API, the LAN, the LLM endpoint and `file:` are unreachable. Injected page text cannot trigger any privileged action (scripted adversarial pages).
- **Deep run on the gold set:** incremental verified stores over fast mode are reported per product, with time and cost. Runs never exceed their caps; runaway detection is exercised.
- **Recipes:** replay passes on an unseen query before activation. A recipe that reads another variant's price is withdrawn automatically (fixture). The 7-day recipe success rate is reported.
- Peak memory with scripted reads and a browse session sharing one Chrome is measured and documented.

---

## Phase 7: Release hardening (M)

**Goal.** A v1.0 that a stranger can install and run.

### Workstreams

1. **Packaging**
   - Final image budgets enforced; compose profiles documented.
   - Upgrade path tested from every previous migration; backup and restore drill.
   - Optional update check (owner decision 12).
2. **Provider breadth**
   - Responses adapter if not already done. Native Anthropic Messages adapter (owner decision 5). Probe-matrix CI against recorded fixtures for every supported server family.
3. **Auth**
   - Generic OIDC (`openid-client`) and API tokens for automation.
4. **Outward MCP server** (optional add-on, off by default)
   - About 5 tools, token-protected, using the same service functions.
5. **Documentation**
   - Install, add-ons, LLM setup per provider, privacy (what leaves the host, to whom), marketplace terms and risks per site, contributor guide for store and marketplace adapters.
6. **Evaluation at release**
   - Full gold-set run on all gates (S§6) with the held-out set rotated (10 products replaced).
   - Repeat-query agreement and a WebMall regression run.
   - Gold-set labelling policy after launch (owner decision 13).
7. **Accessibility and i18n pass** on the main flows.

### Exit criteria

- Every acceptance gate in S§6 holds on the rotated held-out set, with sample sizes published in the release notes.
- A clean install on amd64 Linux and on arm64 macOS (Docker Desktop) reaches a first verified search in under 10 minutes following only the README.
- Upgrade from the previous tagged build preserves all data. A restore from backup passes its drill.

---

## Cross-cutting tracks (every phase)

| Track | What runs continuously |
|---|---|
| Fixtures first | Each ported behaviour lands as a failing golden test before its implementation. Each new bug becomes a fixture. |
| Evals | Matcher gold set on every PR touching `core/matching`; live search eval on demand and before each phase exit; review queue labels flow back into `evals/`. |
| Budgets | Image size, RSS, SPA size and fast-mode token and cost budgets are CI checks once their subsystem exists. |
| Run records | Every model call and scheduled job writes a record from the first day it exists; Diagnostics reads them. |
| Progress log | `docs/progress.md`: per phase, what shipped, measured numbers with sample sizes, deviations from the spec and why. The spec is updated in the same PR as any deviation. |
| Owner decisions | Open items in S§9 are asked before the phase that needs them, not during it. |

## Spike and risk register

| Risk | Retired by | If it goes wrong |
|---|---|---|
| Node TLS client reads far fewer stores than curl_cffi did | Spike A (P0) | Switch the default to `impers` or `wreq-js`. If none is close, move more hosts to the browser rung and widen the P6 scope. |
| Shopify Catalog refuses a static-host profile or throttles it | Spike B (P0) | Ship it as off by default with the user's own Shopify client credentials. Fast-path coverage then relies on SearXNG and the directory. |
| Model judge adds little over rules | Spike D (P0), P2 gate | Judge only on outlier and cheapest listings. Precision work goes into rules and identifiers. |
| SearXNG engines throttle at real use | P2 live eval | Lower the per-engine budget, lean on the directory and the Catalog, and document free keyed providers. |
| Marketplace endpoints change or wall | P5 soak, adapter health | Mark adapters experimental or broken in the UI. Never fail silently. |
| Fast-mode targets not met on frontier models | P2 gate | Shrink the judge batch, skip the summary, and use a smaller judge model. A run stops at its deterministic result under its cap. |
| Web Push unreachable for HTTP-only installs | P3 | Telegram, ntfy and Discord carry delivery; the feed's unread state is primary. |
| eBay keyset unavailable to ordinary users | P5 | eBay becomes a deep link only, and the UI says so. |
