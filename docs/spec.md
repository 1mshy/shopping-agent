# Agentic Dasher: product and technical specification

Version 0.1 · 2026-11-16 · Status: draft for owner review

Companion plan: `docs/plan.md`. Every requirement traces to the research record `reports/2026-11-16-shopping-agent-research.md` in hermes-shopping (cited as *R§n*). Predecessor code paths are relative to the hermes-shopping repository.

The research record's adversarial check never ran. Claims marked **[verify]** are load-bearing and get confirmed by a Phase 0 spike before code depends on them.

---

## 1. What we are building

A self-hosted shopping agent. It searches as many online shops and marketplaces as it can reach to find a good deal on a product, keeps watching prices, and learns the user so it can suggest things to search for. It ends at a link to the merchant: no carts, checkout or logins on the user's behalf.

### 1.1 Goals

1. **Deal search.** Given a product name, a URL, or a vague need, return verified offers from many shops, ranked by code, with an honest coverage record. Fast by default (under a minute, about one US cent of model spend); an opt-in "dig deeper" run goes further.
2. **Watches and alerts.** Watch a product or a saved query; alert on price drops and restocks reliably, with or without the LLM.
3. **Used and marketplace listings.** Saved searches on marketplaces, valued against new prices and asking-price distributions, with scam flags.
4. **Learn the user.** A readable, editable profile built from an interview, in-app behaviour and imported purchases. A finite "For you" feed of recommended searches, watch drops and new deals.
5. **Self-hostable by anyone.** One `docker compose up`, everything configured in the UI, any country and currency, nothing paid required.

### 1.2 Non-goals

- Assisted checkout, carts, account linking, ACP/AP2/UCP checkout (R§3.1).
- Used-car research (the predecessor's swarm is not ported).
- Wishlist or bookmark import as a learning signal.
- A general-purpose agent, plugin marketplace, model-loaded skills or an internal MCP tool bus (R§3.2).
- Multi-tenant hosted service. One owner per install; household profiles later.
- Converting prices to another currency for display.

### 1.3 Owner decisions (fixed requirements, R§1)

| Area | Decision |
|---|---|
| Harness | Lightweight, custom, built from the ground up; no third-party agent product underneath |
| Stack | TypeScript full stack |
| Predecessor | Port the proven parts of pricewatch (not vendor it, not a clean rewrite) |
| LLM | Any OpenAI-compatible endpoint, and Claude through the native Anthropic Messages API (§5.7, §9 #5); designed and tested against frontier cloud models first |
| Audience | Source-available for self-hosters (PolyForm Noncommercial, see §9 #2); one `docker compose up`; everything configurable in the UI; any country and currency |
| Paid dependencies | None required |
| Packaging | Slim core container works alone; real browser and SearXNG are optional add-on services |
| Scope | Search, recommendations, price watches and alerts, used and marketplace listings |
| Learning signals | In-app behaviour; interview and editable profile; imported purchase history |
| UI | Feed-first home ("For you"), search one tap away, chat secondary |
| Delivery | In-app feed, browser push (PWA), chat apps |
| Search budget | Fast default (under a minute, about one cent) plus opt-in "dig deeper" |

---

## 2. Invariants

These are rules the code enforces. Each one exists because the predecessor broke it and paid for it (R§2).

1. **Numbers never come from the model.** Every price, total, minimum, date, interval, percentage and statistic shown to the user is computed by code from observations the engine read itself. The model may use a figure it saw to locate an element; that figure is never stored. Model prose uses placeholders that code fills.
2. **Currency belongs to the listing.** Every price is stored in the currency the store bills in, as integer minor units with an explicit ISO 4217 code (or the explicit value `unknown`). There is no default currency. A price whose currency is `unknown` has no minor-unit amount: its amount fields are null, and what was read stays as text in the observation's raw candidates. Prices are never converted for display. FX is used only for cross-currency sort keys and a labelled "≈ in your currency (source, date)" hint.
3. **The user's market steers the search.** The configured country, currency and language go on every request that accepts them (Shopify market prefix, UCP `context`, regional storefront, hreflang alternate). A figure a store converted for a foreign visitor is refused.
4. **The LLM is never on the sweep or alert path.** Watches, sweeps, alert evaluation and delivery run without a model and keep working through a model outage. Model-assisted steps (identity judge, deal judge) degrade to rules, and their output is labelled "unconfirmed" or "unchecked". They never block an alert.
5. **Ranking is deterministic code.** The model never picks or orders offers (R§3.1: first-offer bias, position bias, 13.5% precision).
6. **Budgets are enforced in code before each model call.** Turns, wall clock, tokens and money are required arguments of every run. A prompt never carries a budget the code does not also enforce.
7. **Page text is data.** No text read from the web can change settings, credentials, notification targets, profile facts, budgets or the queue. Privileged actions are human-only doors with no tool. A run that reads pages holds no profile and no privileged tool (Rule of Two, R§3.2).
8. **Partial results with a coverage record.** Every search returns what it verified plus, per source: enabled, attempted, completed, walled, timed out, found without a verified price, verified. "Lowest verified among checked offers", never "cheapest on the internet".
9. **Save first, research after.** A watch or search request is written to the database before any retailer is contacted. Slow or failed lookups become durable work that is retried.
10. **Unknown is a value.** Stock is tri-state. A shipping cost is `known | estimated | conditional | unknown`. A failed read never refreshes a price, never alerts, and never overwrites the last known state.
11. **Delivery-gated state.** A cooldown or "notified" stamp is set only when a channel confirms acceptance. Every alert and agent message is written to one audit trail, delivered or not.
12. **Survive sleep.** The host freezes, restarts and loses DNS. Missed schedule slots run once on resume, work waits for the network, and nothing is silently dropped.

---

## 3. Architecture

### 3.1 Processes and containers

```
┌──────────────────────────── core (required) ────────────────────────────┐
│ Node 26 process, one port                                               │
│  Hono HTTP: JSON API · SSE run streams · static SPA · health             │
│  Scheduler + job queue (own, SQLite-backed)                             │
│  Search pipeline · Harness (LLM client, runs, budgets)                  │
│  Fetch ladder (api → http) · readers · matcher · deal verdicts          │
│  Watches · marketplace polls · feed assembly · notification outbox      │
│  SQLite (WAL) on one named volume                                       │
└───────┬───────────────────────────┬─────────────────────────┬───────────┘
        │ CDP + token (compose net) │ HTTP (compose net)      │ HTTPS out
┌───────▼─────────┐        ┌────────▼────────┐        ┌───────▼──────────┐
│ browser add-on  │        │ searxng add-on  │        │ LLM endpoint(s), │
│ Chrome headed,  │        │ upstream image, │        │ shops, feeds,    │
│ Xvfb, noVNC,    │        │ pinned tag      │        │ push services    │
│ egress via core │        └─────────────────┘        └──────────────────┘
│ filtering proxy │
└─────────────────┘
```

- **Core** works alone: platform JSON and structured-data readers over the impersonating HTTP client, the Shopify Global Catalog as a lead source, deal feeds, keyless marketplace adapters, watches, feed and delivery.
- **Browser add-on** (compose profile `browser`): real Google Chrome, headed on Xvfb, one persistent profile on a named volume, noVNC for a one-time human login or challenge. The core drives it over CDP. It is started on first use and stopped after about 10 idle minutes (R§4.4).
- **SearXNG add-on** (compose profile `searxng`): open-web discovery. An external SearXNG URL or a user-supplied free search key are alternatives.
- The core never gets the Docker socket. The UI shows each add-on's state and gives copyable instructions to enable it.

### 3.2 Modules (pnpm workspace)

```
apps/
  server/     Hono app, scheduler, jobs, notify, auth, settings, run API
  web/        Vite + React SPA, service worker, locales
packages/
  shared/     Zod schemas, API and SSE event types, Money and Currency types
  core/       Pure domain code: money, matching, deal verdicts, alert rules, valuation
  db/         Drizzle schema, SQL migrations, query helpers
  fetch/      Transport interface, guard, pacing, playbook, wall classifier, browser client
  sources/    Readers, platform routes, store directory, search providers, Shopify Catalog,
              deal feeds, marketplace adapters
  llm/        Wire adapters, capability probe, structured output, usage and cost
  agent/      Run loop, budgets, context rules, tool sets, prompts, run records
addons/
  browser/    Dockerfile and launcher for the Chrome add-on
  searxng/    settings.yml
docker/       Dockerfile, compose.yaml, compose.dev.yaml
evals/        Gold sets, eval runners, hand-review files
lab/          Model-free access lab (dev tool, not shipped in the image)
docs/
```

Start with `apps/server`, `apps/web`, `packages/shared`, `packages/core` and `packages/db`; split the rest out when the boundary is real (R§4.8). `packages/core` has no I/O and no LLM dependency. It must be runnable and tested in isolation.

### 3.3 Technology choices

| Layer | Choice | Fallback / exit |
|---|---|---|
| Runtime | Node.js 26 LTS, `engines >= 24.12` | Bun, revisit mid-2027 |
| Language and tools | TypeScript strict (7.x; 6.x if inference breaks), pnpm workspaces, Vitest, Biome, tsdown | — |
| HTTP server | Hono + `@hono/node-server` | Fastify |
| API types | Zod 4 + Hono RPC client | oRPC / tRPC on Hono |
| UI | React 19, Vite, TanStack Router + Query | SvelteKit (same server) |
| Components | shadcn/ui on Base UI, Tailwind 4; uPlot + SVG sparklines | — |
| PWA | vite-plugin-pwa (`injectManifest`) | hand-written service worker |
| Database | SQLite via better-sqlite3 (WAL, FTS5 trigram) | `node:sqlite` |
| ORM and migrations | Drizzle, SQL migrations applied at start-up, pinned | Kysely |
| Jobs | Own scheduler and queue (~400 lines) + `croner` for next-run times | — |
| HTTP fingerprint | `impit` (`chrome151` profile) behind `HttpTransport`; chosen by the Phase 0 lab (spike A, 2026-11-18) | `wreq-js`, swapped in behind the seam, not tried per request. `impers` (curl-impersonate) only if the owner allows its install script and its native library is vendored and checksummed |
| Browser driver | `patchright-core` `connectOverCDP`, imported in one module | `playwright-core` |
| LLM client | Own, over `fetch`; `zod`, `eventsource-parser`, `ipaddr.js`. The native Anthropic adapter uses `@anthropic-ai/sdk` as its transport only (pinned, imported in one module, retries off, no SDK tool runner) | `openai` SDK as transport; AI SDK as last resort. For the Anthropic adapter: raw `fetch` against the same recorded fixtures, if the SDK does not fit the image budget |
| Web Push | `web-push` (pinned, behind one module) | `@block65/webcrypto-web-push` |
| Mail import | `imapflow`, `postal-mime` | `mailparser` |
| Embeddings (optional) | transformers.js + multilingual-e5-small, vectors as BLOBs, JS cosine | none |
| Trust signals | `tldts`, `fastest-levenshtein`, RDAP, Tranco list | — |
| robots.txt | `robots-parser` | — |
| i18n | i18next with JSON catalogues | Paraglide |
| Base image | `node:26-trixie-slim`, non-root, amd64 + arm64 | — |

Rejected, with reasons in R§3.2, R§3.9 and R§4.4: Vercel AI SDK, Mastra, LangGraph.js, OpenAI Agents SDK, pi-ai as a dependency, Crawlee, Stagehand, Camoufox, captcha solvers, Mem0/Zep/Letta, sqlite-vec, Postgres, SSR frameworks, Next.js.

Every new-major dependency (better-sqlite3 13, web-push 4, Drizzle 1.0-rc, TypeScript 7) sits behind one module so it can be swapped out.

---

## 4. Data model

SQLite, one file on one named volume. Integer minor units for money, except model spend, which is in integer nano-units (§4.4). All timestamps are UTC ISO strings with exactly three fractional digits (`2026-11-17T09:30:00.000Z`), so text order is time order. Every user-owned table carries `profile_id` from the first migration, even though v1 has one profile. Migrations are versioned SQL files, and backup and restore are tested.

### 4.1 Catalogue and observations

| Table | Purpose | Key fields |
|---|---|---|
| `store` | One storefront (host + market prefix). The self-growing directory. | host, market_prefix, platform (shopify, woo, magento, wix, bigcommerce, other, unknown), platform_evidence, country, base_currency, markets_json, ships_to_json, search_route (shopify_ucp, shopify_suggest, woo_store_api, magento_graphql, search_action, opensearch, web_site_search, adapter, none), read_route (a reader method of §5.2: platform_json, json_ld, microdata, opengraph, adapter), identifiers_offered (gtin, mpn, sku), is_shop (yes, no, unknown), trust_tier (known, unverified, caution, blocked), trust_reasons_json, source (read, pasted, import, deal_feed, country_pack), fingerprinted_at, health fields (consecutive_errors, last_ok_at, last_error_at, last_error: why the last read failed) |
| `host_access` | Fetch playbook, keyed by host and page kind (product, search, api). Replaces the predecessor's side-file. | host, page_kind, rung, last_outcome (ok, wall, empty: the outcomes that may change the playbook, §5.1), wall_vendor (the classifier's name for the vendor, free text), expires_at, backoff_until, attempts |
| `product` | The real-world thing at barcode level. | family_id (groups variants), brand, model, mpn, gtin14 (check-digit validated), title, category, attributes_json |
| `listing` | One purchasable thing at one place: a retail offer or a marketplace listing. | product_id (nullable until matched), store_id, channel (retail, marketplace), url_canonical, external_id, sku, seller_id, seller_kind (first_party, marketplace_seller, private), condition (new, open_box, refurbished, used_like_new, used_good, used_fair, for_parts, unknown), currency (an ISO 4217 code that has a minor unit, or `unknown`), title, variant_json (option names as the store writes them), trackable, first_seen_at, last_seen_at, gone_at, consecutive_errors. There is no status column: a listing's state is derived from gone_at, trackable and consecutive_errors. |
| `price_observation` | Append-only. A price is a record, not a number. | listing_id, observed_at, currency (required: an ISO 4217 code that has a minor unit, or `unknown`; when it is `unknown`, sticker and every other amount field are null and the figures read stay as text in raw_candidates_json), sticker, reference_claimed, coupon (an amount off; a percentage coupon becomes an amount only when the reader knows its base, otherwise it stays as text in raw_candidates_json), member_price, shipping + shipping_status (an amount only when known or estimated), tax + tax_included, duty_estimate, unit_price + unit (both or neither), effective (code-derived; needs sticker, at most sticker), landed (code-derived; needs effective, known shipping and no missing component; at least effective), missing_components_json (sticker, shipping, tax, duty_estimate: sticker listed exactly when it is null; shipping listed when conditional or unknown, not when known; tax listed when tax_included is unknown, not when tax is included or its amount is known; duty_estimate not listed when set; otherwise the derivation's policy decides), availability (in, out, unknown), read_path (the reader method, as `store.read_route`), rung, raw_candidates_json (method as read_path, confidence 0-1 set by code, value as text). A sticker needs at least one raw candidate. A row has a sticker, or is out of stock, or has currency `unknown` with raw candidates; a read with none of these (including `multiple_prices`) is a failed read and writes no row. |
| `match_verdict` | Cached identity decision. | spec_fp, listing_fp (store, SKU or clean URL, title hash, variant), relation (exact, variant, bundle, accessory_or_part, other_model, other_line, unknown), differing_attrs_json, decided_by (identifier, rules, model, person), matcher_version, prompt_version, model_id; person overrides take precedence |
| `fx_rate` | Ranking and hint only. | base, quote, rate, source (the rate provider's name, free text), as_of |
| `listing_check` | Per-listing scheduling (§5.8) and what a failed read leaves behind, since it writes no observation (§2.10). One row per listing, shared by the watches that follow it. | listing_id, next_check_at (null while no active watch tracks the listing), last_read_at, first_error_at and last_error (the current run of failed reads, beside listing.consecutive_errors) |
| `domain_registration` | RDAP registration dates for store trust (§5.5), cached forever. | domain (registrable), registered_at (null: RDAP gave no date), fetched_at |

### 4.2 User intent

| Table | Purpose | Key fields |
|---|---|---|
| `watch` | A standing request. Kept apart from `product` (the predecessor mixed them). | kind (product, query, saved_search), input, spec_json (SearchIntent), market, currency, rules_json (target_price, drop_pct, restock, marketplace filters), reference_price + reference_kind (median_verified, user_confirmed), cooldown_s, created_at, status (derived, as a listing's: archived when archived_at is set, else paused when paused_at is set, else active; a watch that alerted is archived, never deleted), dedupe_key (`url:` or `query:`, unique per profile among watches not archived), restock_enabled_at (null while the restock rule is off), and the save-first lookup (§2.9): lookup_state (queued, done, failed), lookup_queued_at, lookup_due_at, lookup_attempts, lookup_error |
| `watch_listing` | Listings a watch follows. | watch_id, listing_id, role (tracked, candidate, excluded), added_by (user, discovery) |
| `search_run` | One user search (fast or deep). | intent_json (null until the request is interpreted, so a search is saved before any call, §2.9), mode (fast, deep), budget_json, status (queued, running, completed, cancelled, failed), coverage_json (the coverage record: one entry per source, where a source is the Catalog, one web-search engine, one store by host, or one marketplace adapter; each with the §2.8 flags and two counts, found without a verified price and verified), result_json, run_id |

### 4.3 Personalisation (R§3.7)

| Table | Purpose |
|---|---|
| `profile_fact` | id, kind, key, text, value_json, source (user, interview, import, inferred), confidence, status (active, proposed, rejected, retired), valid_from, valid_to, evidence_json. Rendered by code into one document of at most 6,000 characters, the only description of the user any prompt may contain. |
| `profile_constraint` | Structured dislikes, budgets, sizes and "never show" rules, enforced in code. |
| `topic` | Interest with short-term (14-day half-life) and long-term (180-day) weights and Beta counts for exploration. |
| `owned_item`, `purchase`, `import_batch` | Ownership and history with provenance; imports preview before commit. |
| `event` | Append-only in-app behaviour (never updated or replaced; the user may delete it), by kind: view, click, dismiss, not_interested, already_own, wrong_match, less_like_this, search, watch (the feedback kinds are the buttons of §5.10 and §5.12). |
| `candidate`, `feed_card` | Generator output and the assembled feed; each card stores its evidence for "because you…". |
| `deal_feed_item` | Ingested community deals (merchant, price, URL, votes, expiry as read). The price stays text as the feed wrote it: a lead is never an amount until a live read confirms one (§5.3). |

### 4.4 Operations

| Table | Purpose |
|---|---|
| `job`, `job_run` | Scheduler definitions (a unique name, cron (croner syntax) or next_run_at, the pending one-off retry_at, deadline, network gate) and run history (status: running, completed, failed, skipped, timed_out; reason: slot, boot, caller, retry; the slots it coalesced; a detail for Diagnostics). The overlap lock is the job's open run: a run has no end exactly while it is running, and a job has at most one such run. |
| `run`, `run_step` | Harness RunRecord. OpenTelemetry GenAI attribute names; usage normalised to {input incl. cached, cache_read, cache_write, output, reasoning}; cost_source (provider, settings, none). A run has one type from the §5.7 table (fast_search, chat, store_run, deep_job, recommendation_job); each model-call step carries its endpoint role, prompt version, provider and model, and the run holds usage and cost totals. Status (running, completed, cancelled, failed), the four budgets of §2.6, the turns taken (never above the cap) and the budgets hit (turns, deadline, input_tokens, spend; no spend hit where cost is unknown). Cost and the spend cap are integer nano-units (10⁻⁹ of the major unit) with an explicit currency; a provider-reported cost is read from its decimal text exactly, and a digit beyond the ninth decimal rounds it up, so a cap is never under-counted. With cost_source `none` the cost is null, never zero. Full payloads kept 14 days, then trimmed to usage. |
| `notification_event`, `delivery` | Outbox: stable event key and kind (price_drop, restock, new_listing, recommendation, agent, system), and the records the event rests on (an alert names its watch, listing and an observation of that listing); per-channel state (pending, accepted, failed), attempts, next_attempt_at, outcome of the last attempt (accepted, retry, failed), accepted_at. Only `accepted` (the channel confirmed acceptance) may stamp a cooldown or "notified"; a watch's last accepted alert is read from its events and their deliveries, never stored on the watch. The event is the audit trail of §2.11: never updated, replaced or deleted. A delivery changes state but is never deleted or replaced, so a channel with deliveries cannot be deleted. |
| `channel` | Configured delivery channels (type: in_app, web_push, ntfy, telegram, discord, webhook; an optional channel of §5.11 adds its type when it is built) and push subscriptions; a name, created_at, disabled_at (switched off) and removed_at (a channel with deliveries is removed, never deleted). |
| `host_pacing` | Per-host pacing (§5.1): the earliest instant the next request to a host may start, kept across restarts. |
| `owner_password`, `session` | Owner auth (§5.13): the argon2 password hash (PHC string), outside `setting`; login sessions, storing only the SHA-256 of the cookie token, with created, expiry and last-seen times. |
| `llm_endpoint` | Base URL, auth (encrypted at rest), wire (chat_completions, responses, anthropic_messages: which adapter of §5.7 speaks to it), model id, role (planner, judge, chat, browse), capabilities_json, prices (per million tokens for input, output, cache read and cache write, with an optional second rate card above a prompt-length threshold), circuit-breaker state. |
| `setting` | DB-held settings with environment defaults; the UI shows where each effective value came from (db, env, default). |
| `recipe`, `exploration_task` | Phase 6: declarative learned search and read routes, and the per-host learning queue. |

---

## 5. Subsystems

### 5.1 Fetch and access (`packages/fetch`, R§2.1, R§4.4)

**Guard first.** Every URL, from any source, passes `guard()` before any transport: http/https only; a URL not acceptable as written (user-info, no host) refused; DNS resolved and every IANA special-purpose address range refused (private, loopback, link-local, CGNAT and metadata among them), except that a NAT64 address (64:ff9b::/96) is judged by the IPv4 address it embeds, because on an IPv6-only network every IPv4-only shop resolves to one; connection pinned to the validated IP; every redirect re-checked; body size cap; robots setting; per-host limiter; budget. The browser's egress goes through a filtering proxy in the core with the same rules, so pages cannot reach the LAN or the app's own API.

**Ladder.**
1. `api`: known platform or public endpoints (Shopify `/products/<handle>.js`, WooCommerce Store API, Magento GraphQL, Best Buy CA JSON, marketplace endpoints).
2. `http`: impersonating client. User-Agent and client hints come from the TLS profile and are never set by hand. Optional same-site Referer. The client's JA4 and HTTP/2 fingerprint are compared in the lab with a real capture of the Chrome version its profile claims at every client upgrade, and a mismatch is recorded (spike A found one for `impit` `chrome151`).
3. `browser` (add-on): headed Chrome. Wait up to 20 s for a self-clearing challenge; never click; report a captcha or "Access Denied" at once.
4. `remote` (optional, one interface): any other CDP endpoint or proxy URL.
5. `person`: a UI task to open the noVNC view and solve or log in once.

**Typed outcome.** Every fetch returns a `FetchOutcome`: `ok | not_found | wall{vendor, mode} | rate_limited | payment_required | login_required | empty | server_error | network_error{code} | refused_by_policy{reason}`, each naming the rung that produced it. A wall's mode is `challenge` (did not clear), `captcha` or `access_denied`, and its vendor may be unknown; a site's own wall names the site as its vendor (`ebay`, `amazon`), a bare 403 with no wall marker is a wall whose vendor is unknown, and a 401 is `login_required`; `rate_limited` carries the Retry-After delay when one was given; a policy refusal's reason is one guard clause (`scheme`, `url_form`, `private_address`, `body_size`, `robots`, `host_limit`, `budget`). Only `ok`, `wall` and `empty` may change the playbook. A 404 never moves a rung. Success hints expire after 24 h; negative verdicts back off on a growing schedule.

**Wall classifier.** Decides from status, final URL, title, visible text and document size against saved real pages. It does not match bare substrings. The predecessor's cases are ported as fixtures: an Amazon 404 with a marker in it is not a wall, eBay's wall shows only in the final URL, and a "Just a moment" loading text is not a challenge.

**Pacing.** One request in flight per host and 2.5 s between starts with 0.85-1.3 jitter, shared by every rung and persisted across restarts. Separate pools: about 12 concurrent HTTP hosts and 1-2 browser tabs. HTTP results return first and browser results stream in later.

**Sessions.** One cookie jar per host session for HTTP. One persistent Chrome profile. A walled render clears only that site's cookies (including parent-domain bot-manager cookies) and origin storage.

**robots.txt.** A setting: `ignore | report | respect`, parsed with `robots-parser` and cached for a day. A challenge page served in place of robots.txt gives no verdict, whatever its status. The default is `ignore`, following the owner's decision of 2026-10-23, confirmed as the public default on 2026-11-23 (§9 #4).

**Browser add-on image.** `debian:bookworm-slim` + pinned Google Chrome stable (package cached in the build, amd64 + arm64), an init process supervising Xvfb, the launcher and x11vnc/noVNC; `--user-data-dir` on a named volume; timezone and language set to the user's; no automation flags; stale `SingletonLock` cleared; a forwarder exposing CDP and noVNC only on the compose network with a shared token. One Dockerfile, one pin.

### 5.2 Readers and the store directory (`packages/sources`, R§3.3)

**Reader ladder** for any product URL: platform JSON → JSON-LD (including ProductGroup/hasVariant) → microdata → OpenGraph price tags → browser (add-on). Each read stores its candidate list (method, confidence, value); a failed read writes no observation, so its candidates go into the failed read's log record. A platform JSON read, or its refusal of the variant (`variant_not_found`, `multiple_prices`, converted currency), ends the ladder before the page is fetched; otherwise the page is fetched once and JSON-LD, microdata and OpenGraph all read it. JSON-LD outranks platform values, which outrank generic tags (microdata, OpenGraph): the highest-ranked method that read a price or refused the variant decides, and a lower-ranked one never overrules it. If methods of that rank disagree, or the page has more than one distinct price for the selected variant, the outcome is `multiple_prices`, not a guess. When a page is rendered, the structured price is compared with the displayed buy-box price, and any disagreement is flagged on the observation. There is no general displayed-price classifier: the predecessor spent six rounds on one and dropped it.

**Variant coupling.** A price is attached only to the selected variant: the one the request's variant selector names or, without one, the one the URL names (`?variant=`, a sku parameter, a variant whose own URL is the page). A ProductGroup range, an AggregateOffer range or the cheapest dropdown option is never attached to a requested higher-capacity variant; with several variants and none selected the outcome is `variant_not_found`.

**Currency resolution order:** an explicit mark on the figure (an ISO code, a qualified dollar sign, €, £) → platform answer → `priceCurrency` → hreflang/og:locale → ccTLD. A bare "$" (like any sign several currencies share: "¥", "kr") takes the store's country, and is refused when that country's currency is not one it writes. Unknown currency or a converted-looking figure is refused: a mark that names another currency than the declared one, and a site's "approx." figure. A Shopify Markets presentment price (the price a market prefix bills) is the shop's own price for that market, not a converted one. A lone dot followed by exactly three digits ("1.299 €") is a thousands separator on a shop whose locale writes it so, and the price is refused when the locale is unclear. A lone comma followed by exactly three digits ("1,299") is a thousands separator, except on a shop whose locale writes a decimal comma, where it is the decimal point, and in a three-decimal currency (KWD, TND), where the price is refused unless the locale settles it. On Shopify, whose `/products/<handle>.js` states no currency, the platform answer is the `cart_currency` cookie set on that response, else the `price_currency` of the product's `.json` view under the same market prefix (its price must agree with the `.js` figure), else `/cart.js`, which is a fallback only, because Shopify's robots now disallows it for agents.

**Host fingerprint** (model-free, at most six requests, cached with a long expiry): platform probe (including the Magento generation and Shopify's predictive-search flag), `/.well-known/ucp`, SearchAction/OpenSearch on the home page, product sitemap, `/llms.txt`. Hosts with no Product markup, platform or product sitemap are marked `is_shop = no`. No model run is ever spent on a host before triage. `llms.txt`, `agents.md` and robots comments are data only and never reach a prompt.

**Directory intake (no model):** every host that yields a price, pasted links, merchants in imported orders, deal-feed merchant URLs, and an optional downloadable country pack built offline from Web Data Commons domain stats (ccTLD match, ≥10 products, offers density ≥0.5). Shopify Catalog results do not add stores; a store is added only after a direct read.

**Search inside a known shop**, in order: per-store UCP `search_catalog` (explicit country and currency) → platform JSON search (Shopify `suggest.json` under the market prefix, which answers only for its supported buyer languages and returns 417 otherwise, moving the search to the next route; Woo Store API `?search=`; Magento 2 GraphQL `products(search:)` sent as GET, skipped on Magento 1) → SearchAction/OpenSearch template → web search `site:<host>` → browser (deep mode only). Results from a store's own search get the strictest matcher floor, because store search pads results with accessories and other models.

**Hand-written adapters** only for giants with real keyless or BYO-key APIs (Best Buy CA JSON search, Amazon regional storefronts over HTTP, and similar). They are rows-as-data plus a small class. There is no hand-curated catalogue as a growth strategy.

### 5.3 Discovery sources (R§3.1, R§3.3)

**Search-provider interface.** Ordered providers: bundled SearXNG (DuckDuckGo + Brave on, Google off, JSON format, 600 s `TooManyRequests` back-off) → external SearXNG URL → user-supplied free key (Tavily, Exa; then Brave, Serper, Jina). Token bucket per engine starting at 20 queries/hour, 24 h cache per normalised query, and a record of which engines answered. Watch sweeps never call web search; watch re-discovery runs at most daily.

**URL candidate filter** (ported from `web_discovery.pick_candidates`): product-shaped paths, deny list, ≤2 links per host, ≤25 hosts, the user's country first. A snippet's price is never used. Web hits are deduplicated with a listing key (store + SKU, else clean URL).

**Shopify Global Catalog (UCP)** [verify: request shape and terms checked against Shopify's documentation on 2026-11-17, see `lab/catalog/SOURCES.md`; on 2026-11-23 a GitHub raw profile was refused (`text/plain`) and a jsDelivr one accepted; 6 keyless searches returned priced, linked offers with attribution parameters, 108 of 120 in the requested currency (`docs/spikes/b-shopify-catalog.md`); result relevance not yet judged]. Plain JSON-RPC 2.0 over HTTPS to `catalog.shopify.com/api/ucp/mcp`: the tool `search_catalog` is called with the method `tools/call` (no MCP SDK, no handshake), with `catalog.context.address_country` and `catalog.context.currency` always sent explicitly, because the currency is only a hint and the business decides the presentment currency; offers in another currency are dropped. It is a switchable **lead source for user-initiated searches only**, and its terms are enforced in code:
- price/availability held ≤10 minutes and metadata ≤24 hours;
- no Catalog payload written to the product database;
- attribution parameters, checkout URLs and merchant attribution kept intact on outbound links;
- never called from watches, sweeps or scheduled recommendation jobs;
- every hit re-read at the shop before it is shown as verified or stored.

The request needs a public agent-profile URL. The project publishes one static profile JSON at a project-owned HTTPS URL, overridable in settings. The host must serve it over HTTPS with no redirect, as `Content-Type: application/json` (Shopify fetches and validates the profile, and refused one served as `text/plain` with HTTP 422, MCP error `-32001`, `profile_malformed`, "Invalid content type", seen 2026-11-23), and with `Cache-Control: public` and a `max-age` of at least 60 seconds (UCP's hosting rule; whether Shopify enforces it is not known). A profile rejection (MCP `-32001` or a `profile_*` code) refuses every request alike, so it switches the Catalog source off with a settings error naming the code, instead of failing each search. Keyless access is the lowest tier: it is limited per IP address, shares one pool with all other anonymous traffic, and Shopify advises against it for production traffic. The user's own Shopify client credentials are a separate setting (a client id and secret exchanged for a short-lived bearer token sent as a header, never placed in the profile) and are the recommended path once configured. The keyless Catalog is on by default for a single-user install (decided 2026-11-23); 6 of 6 keyless searches returned results with the jsDelivr-hosted profile on 2026-11-23 (§9 #3).

**Deal feeds** (code-polled, conditional GET, 30 min): Slickdeals, RedFlagDeals, Pepper network (HotUKDeals, mydealz, Dealabs) `/rss/hot`, OzBargain, chosen per country. Parsed without a model: Pepper attributes carry merchant and price; OzBargain carries merchant URL, votes and expiry. A feed item is a **lead** that must be confirmed by a live read before it shows as a price. Reddit RSS is optional, with its own pacing; it returns 429 under bursts and the JSON API is never used.

**Optional keyed adapters** (user brings the key): Best Buy US Products API, eBay Browse (see §5.9), Rakuten Ichiba, Open Food Facts, UPCitemdb (naming a barcode or an import line). They are not in the default path.

### 5.4 Product identity (`packages/core/matching`, R§3.6)

**SearchIntent.** A typed spec: exact item or needs-based search, identity fields (brand, model, MPN, GTIN), must-have attributes, acceptable substitutes, condition, pack quantity, location, currency, delivery or pickup, budget. Kind is `exact` or `needs`; fulfilment is `delivery`, `pickup` or both. The planner's output has no budget, currency, location, GTIN or MPN field: code sets them from the user's input and settings, and a budget is Money in the user's currency. The planner's text is search input, matched against listings as text and never parsed into a figure. An exact URL or a clear product name takes a deterministic path with no planning call.

**Three tiers:**
1. **Identifiers:** GTIN equality (check digit validated, normalised to 14 digits), or normalised brand + MPN equality. A model number in the listing's URL path is supporting evidence, never identity on its own. Identifiers and title rules must not contradict each other: an identifier match whose title the rules reject is `unknown`, and a title match on a page that states another valid GTIN or another part number than the asked one is `unknown`.
2. **Title rules:** ported from `pricewatch/matching.py` and `reports/2026-10-23-matching.md`: accessory and part rejects, model-token conflicts, variant words, and the owner's rulings as fixed test cases (combo counts both ways; a name suffix that changes the line or the material makes a different product, `other_model` or `variant`, never `exact`, and a material-grade Plus or a version number on one side only is such a suffix; an edition (For Mac, for Business) or a heatsink the asked name does not mention makes a `variant`; a size in place of a model is not a clash). These rules output a **relation label**, not a numeric score. Code then checks the label against the must-have attributes.
3. **Model judge,** for the ambiguous band only: at most 3 calls of at most 15 listings each (local models: 10), cheapest and outlier listings first. The prompt is rule-guided (exact means the two would share a barcode; variants in size, colour, capacity, configuration or pack count are not matches; a missing attribute is not a conflict; a match needs positive evidence). Output is JSON-schema'd to `{id, relation, differingAttrs, reason}` (wire keys in camelCase, as every contract) with id and count validated; no other field is accepted, differingAttrs holds distinct attribute names only and is empty for `exact`, and the non-empty reason stays in the run record. Invalid output means `unknown`. A small local model may only veto, never accept.

**Verdict cache** keyed on spec fingerprint, listing fingerprint, matcher version, prompt version and model id. Sweeps and watches make no model calls. When no model is available, rules decide and undecided listings are "unconfirmed". Alerts fire only for listings confirmed by identifier, rules, cached verdict or a person.

**Clarify in code.** After the first retrieval, if candidates split on an open attribute and the groups' median prices differ by about 15% or more, the UI shows one chip question with a non-blocking default. Models almost never ask on their own.

**Exact matches, substitutes and used items** are separate result groups. A cheaper substitute is never shown as an exact match.

### 5.5 Prices, deal verdicts and store trust (R§3.6)

**Effective and landed prices** are derived in code from the observation fields, with a list of missing components. The effective price takes off automatic discounts only; a coupon the buyer must clip or enter as a code is shown beside it and never lowers it, and a percentage coupon's amount is rounded half up to the minor unit. An unknown delivery cost cannot establish the cheapest delivered offer. The UI ranks by item price by default and shows a delivered total only where its components are known. Tax-inclusive defaults come per country, and US and Canadian prices carry a "before tax" label.

**Deal verdict** (code only, per listing and per product, within one currency, condition and market):
- **Lowest seen**: at or under the lowest recorded price, with ≥35 days of history.
- **Good price**: within 5% of the lowest recorded, or ≥10% under the 90-day time-weighted median.
- **Typical** / **High**.
- **Cheapest of N stores, X% under the median**: used when history is under 14 days or has fewer than three price levels.
- Always shown: the share of the last 90 days at or below today's price.
- A store's struck-through or "was" price is stored as a claim and never used as a baseline.

**Outlier rule.** With ≥4 exact listings in one currency, condition and market, a price under 60% of their median (50% with 2-3 listings) is never ranked first. It triggers a stricter identity re-check and a trust check, and it is shown separately with the reason. It needs a second read within 1% before it can alert.

**Store trust,** four tiers with visible reasons: known, unverified, caution, blocked. Signals: RDAP registration date (rdap.org, ≤10 req/10 s, cached forever), Tranco top-1M, an optional CERT Polska list, an optional Google Safe Browsing key, a look-alike domain check, and on-page return policy, address, imprint and prepayment-only signals. A "caution" store never headlines a deal and never alerts without its label. The owner decides whether a dubious store stays.

**Product-quality read** (on demand or in deep mode, cached 30 days): per-store aggregateRating shown unaveraged; one model call over 3-6 fetched expert or community pages returns a verdict line and up to three strengths and weaknesses, each with a source URL and a quoted span. Code drops any point whose quote is not in the fetched text.

### 5.6 The search pipeline (R§3.1, R§3.3, R§3.9)

**Fast mode** is a fixed pipeline, not a tool-calling loop. It has a shared deadline object (40 s for reads) and at most two planning turns enforced in code.

1. **Interpret** (model call 1, structured output, no tools): SearchIntent plus 3-5 query variants. Skipped for exact URLs and clear names.
2. **Fan out in parallel:** Shopify Global Catalog (user's country, limit 20); two web searches (name; name + country) through the provider interface; directory fan-out to ≤15 shops in the user's country through their search routes; known marketplace adapters if the intent allows used.
3. **Filter candidates:** product-shaped URLs, ≤2 per host, ≤25 hosts, country first.
4. **Read** with the HTTP-only reader ladder under the deadline (the browser is never on the fast path).
5. **Match:** tiers 1-2, then model call 2 (batched judge) on the ambiguous shortlist of ≤10-15.
6. **Rank and verdict** in code; apply profile constraints; group exact, substitutes and used.
7. **Summarise:** optional short model wording from the final table, using placeholders. Skipped when the budget is spent.

**Targets** (to be confirmed by measurement in Phase 2): ≤30K total tokens on a mini-class model; p50 30 s, p95 60 s; median model spend ≈$0.01; hard cap $0.03. A run that hits its cap returns its deterministic result.

**Progress stream.** SSE with typed blocks and JSON-patch updates, plus a reconnect route. Block types: plan, store_read (reading, priced, no_price, walled), candidate, verdict, summary, coverage. Unresponsive search engines are surfaced. Events are `block`, `patch` and `end`, numbered by a sequence that starts at 1, rises by 1 and is the SSE id; the reconnect route replays every event after the client's last id. Patches use only `add` and `replace` and never change a block's type; a patched block must still validate. `end` is last and carries the final status (completed, cancelled or failed) and the coverage record, so a cancelled run ends with its partial evidence. A price in a block is integer minor units with its currency next to the observation id it came from; percentages are integer basis points; the verdict block carries the §5.5 label (cheapest of N with N and X) and the share of 90 days. The summary is a list of segments: model text, and values code fills (money, count, store), which the UI joins.

**Dig deeper** (opt-in per search, cost and time cap shown before start, never silently extends a fast run): query expansion (breadth halved per level, depth −1), more hosts, browser reads, the model judge on more listings, and model-driven browsing of hard stores (§5.7). Defaults: whole job 10 min and $0.50 money cap, user-adjustable.

### 5.7 LLM client and harness (`packages/llm`, `packages/agent`, R§3.2)

**Wire adapters** behind a `WireAdapter` seam. The harness speaks one neutral request and reply (system text, messages, tool definitions, tool calls and results, a structured-output schema, a reasoning-effort level, usage, a typed stop outcome); each adapter maps it to one wire and nothing above the seam names a provider. Each endpoint row names its wire (§4.4).

1. **Chat Completions** (baseline), for any OpenAI-compatible server.
2. **Native Anthropic Messages** (Phase 2, §9 #5), the route for Claude and the one the default hosted setup is tested on.
3. **Stateless Responses** (`store:false`, replayed items), because OpenAI's newest models require it for tool calls with reasoning. Built in Phase 2 only if a chosen default model needs it, otherwise Phase 7.

On the Chat Completions wire, usage is read from three reasoning field names (`reasoning`, `reasoning_content`, thinking blocks); `<think>` blocks are stripped; bare `[]` and truncated batches are detected.

**The native Anthropic adapter** talks to `POST /v1/messages` with the key as `x-api-key` and a pinned `anthropic-version` (`2026-10-21`, the version the fixtures in `evals/wire` were recorded on). It exists because Anthropic's own OpenAI-compatibility endpoint lost what the fast path's budget depends on: in the recordings of 2026-11-24 it showed no prompt cache, no reasoning token count, refused `json_object` and returned errors without a request id, while the native API answered all seven probe steps. Its rules:

- **Transport.** `@anthropic-ai/sdk`, used for the request, the SSE stream and the typed errors only. Retries are off in the SDK (the harness owns retries, deadlines and the circuit breaker), the run's deadline is the timeout and its AbortSignal is passed through. No SDK tool runner, no server-side tools, no Managed Agents: the run loop stays the project's own, so budgets are enforced in code before every call (§2.6).
- **Thinking.** Adaptive only, never a token budget. Depth is `output_config.effort`, always sent explicitly per role, because the default differs by model. Thinking blocks are opaque: they stay in the transcript and go back unchanged, signature included, and are never parsed, shown or summarised. No sampling parameter and no assistant prefill is ever sent (a sampling parameter was refused with a 400 in the recordings).
- **Stop outcome first.** `stop_reason` is read before any content: `end_turn`, `tool_use`, `max_tokens` (a truncation, handled like a truncated batch), `refusal` (a typed outcome with its category, never retried with the same input and never counted against the circuit breaker). A reply can begin with thinking blocks, so content is read by block type, never by position.
- **Structured output.** The ladder on this wire is `output_config.format` with the JSON schema → a strict tool (`strict: true`), forced where the model accepts a forced `tool_choice` and otherwise `auto` with a check that the call was made → text extractor. There is no `json_object` rung. Forcing is a capability flag, not an assumption: Claude Haiku 5.5 accepts it (recorded, `messages-tool-choice-any-parallel`); Anthropic's documentation says the current Opus, Sonnet and Fable models refuse it with a 400, which is not recorded here yet.
- **Prompt cache.** Explicit `cache_control` breakpoints on the tool list and the last system block, 5-minute TTL. The recorded pair wrote and then read 3,628 tokens. Anthropic documents a model-dependent minimum prefix below which nothing is cached and no error is raised, so short single-call prompts may gain nothing and the multi-turn run types (chat, store runs) gain most; the probe's step 7 measures it.
- **Append-only transcripts.** Anthropic documents that on current Claude models a thinking block stays valid only while everything sent before it is unchanged, and that editing an earlier turn makes the next request fail or drops the block (not recorded here yet: the fixtures hold one tool-result follow-up and no edited history). A transcript sent through this adapter is therefore never rewritten in place. The snapshot pruning of the context rules below is such an edit: Phase 6 settles how it is done on this wire (server-side context editing, or dropping the thinking blocks from the edited turn on) and pins it with a recording before a browse run uses a Claude model.
- **Usage.** `input_tokens` excludes cached tokens here, so the normalised input is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; cache read and cache write are those two fields; output is `output_tokens`, which includes thinking; reasoning is `output_tokens_details.thinking_tokens`. In a stream the count in `message_start` is provisional (it equalled the final count in 3 of 11 recorded streams); the last `message_delta` is the one stored.
- **Errors.** Anthropic's error body (`type`, `message`) and the `request-id` header go into the run step. 429 and 529 are retried inside the run's deadline and honour `retry-after`; 400, 401, 403 and 404 fail at once.

Anthropic's OpenAI-compatibility endpoint is not a supported route for Claude: saving an endpoint whose base URL is `api.anthropic.com` on the Chat Completions wire is refused with a pointer to this one. Claude through OpenRouter or LiteLLM stays possible on the Chat Completions wire and is untested (neither was recorded).

**Capability probe,** run on save and on demand, editable in the UI. It fills one `EndpointCapabilities` record using pi-ai's flag vocabulary (maxTokensField, supportsDeveloperRole, supportsUsageInStreaming, supportsStrictMode, supportsTools, supportsJsonSchema, thinkingFormat, requiresToolResultName, …):
1. `/models` plus native side doors (`/props`, `/api/show`, OpenRouter model record) for context length;
2. streamed completion (max-tokens field, usage, reasoning field, tok/s);
3. tool call (auto);
4. tool_choice required and parallel;
5. json_schema strict and json_object, separately;
6. reasoning-off switch;
7. cached_tokens on a repeated prefix.

On the Anthropic wire the same seven steps fill the same record. Step 1 reads `/v1/models/{id}` (`max_input_tokens`, `max_tokens`, and the capability tree: structured outputs, the thinking types the model accepts, its effort levels), and what the Models API states is recorded, not probed again. Step 4 records whether a forced `tool_choice` is accepted; a refusal there is a flag, not a failed probe. Step 5 tests `output_config.format` and marks `json_object` unsupported. Step 6 records whether thinking can be switched off (`disabled`, or `between_tools` on the models that have it) and otherwise the lowest effort level as the floor. Step 7 repeats a prefix long enough to cache, with a `cache_control` breakpoint, and looks for `cache_read_input_tokens`.

Dig deeper is blocked under 16K context. There is no prompt-injected tool-calling fallback.

**Structured output** degrades by capability flag: strict json_schema → json_object → forced tool → text extractor (on the Anthropic wire: `output_config.format` → strict tool → text extractor, above). All of these use zod validation and one repair retry. A pattern in an exported schema is never relied on: the model's reply is validated by zod afterwards.

**Roles.** Endpoints are assigned per role (planner, judge, chat, browse), so a cheap small model can judge while a larger one plans. The judge defaults to a small hosted model at a measured reasoning effort: on spike D's set, Claude Haiku 5.5 at `medium` kept precision of `exact` (0.951 against 0.940) and raised recall (0.770 against 0.569) over `low`, at about 1.5× the cost (`docs/spikes/d-model-judge.md`). That comparison was scored before five of its golds stopped being `exact` (2026-11-24), so `medium` is provisional until Phase 2 measures the judge on the gold set.

**Run loop** (~1,000 lines, shaped like pi-agent-core but with caps): `transformContext` (snapshot pruning), `beforeToolCall` (allow-list, refusal counting), `finishTurn`, parallel tools with a per-tool sequential flag, AbortSignal throughout, typed events. Required arguments: maxTurns, deadline, maxInputTokens, maxSpend. A forced finish is a tool-less final call (`tool_choice: none` where accepted), then a deterministic finisher built from run state. An accepted `tool_choice: none` may still return nothing: Claude Haiku 5.5 answered with an empty reply on both Anthropic wire shapes (2 of 2 recordings, `evals/wire`, 2026-11-24), so an empty final call goes to the deterministic finisher like a refused one. A repeat detector trips at 3 identical calls, and the invalid-call cap is 3.

| Run type | Budget | Tools | Sees profile | Sees page text |
|---|---|---|---|---|
| Fast search (plan, judge, summary) | 1 turn / 20 s per call | none | constraints only (planner) | judge: listing titles/attrs only |
| Chat | 8 turns / 90 s | search_products, get_listing, list_watches, create_watch, update_watch, dig_deeper, suggest_profile_note | yes | no |
| Dig-deeper store run | 15 turns / 180 s / 150K input tokens | page_open, page_snapshot, page_find, page_act, page_read, report_listing, finish | no (product spec only) | yes |
| Deep job (whole) | 10 min + money cap | — (code orchestrates store runs) | — | — |
| Recommendation jobs | daily token cap (§5.10) | none | rendered profile | deal titles only |

**Context rules** for page work: at most one page snapshot in the transcript (older ones become stubs); page tools return extracts capped at about 2,000 tokens with a narrowing hint; system prompt and tool list are byte-stable so prefix caches hit; one fresh context per store.

**Browser tools** are built on Playwright's `ariaSnapshot({ mode: 'ai' })` and `getByRef`. `page_read` runs the code extractor on the current page; the model reports where the listing is, and code reads the price. The harness ends the task itself on a wall or captcha title.

**Prompts.** One prompt file per task type, under 800 tokens, chosen by code and versioned (the version goes into the run record and the verdict cache). No model-loaded skills.

**Refusals** returned to the model are structured: `{code, what_the_engine_saw, hint}`. A hint never contains a figure to try.

**Reliability.** A per-endpoint circuit breaker (3 consecutive failures, 300 s) and a scheduled deterministic probe that raises a normal system notification when the model is down.

**Cost.** Taken from the provider when reported (OpenRouter `usage.cost`, LiteLLM header), else from settings prices, else `unknown` (never zero). Anthropic reports usage and no cost, so on that wire cost always comes from settings prices: input, output, cache read and cache write are priced apart, and a model with a second rate card above a prompt length (Claude Haiku 5.5 above 100K prompt tokens) is priced by the card its prompt selects. Money caps reserve before concurrent calls and settle after. Where cost is unknown, token, turn and time caps still hold, and the UI says a money cap cannot be guaranteed.

**Outward MCP server** (optional add-on, off by default, token-protected, about 5 tools). It is not used internally.

### 5.8 Watches, sweeps and alerts (R§2.3)

**Intake.** Save first (Invariant 9). URL normalisation strips tracking parameters and keeps variant parameters. A pasted foreign-store link is re-registered on the user's regional storefront. The baseline and currency are adopted only from the first real read. The default rule is a 5% drop.

**Reference price** is the user-confirmed price when there is one, until the user changes it; otherwise the median of the verified exact listings' recent prices, recomputed as reads arrive (with an even count, the mean of the two middle values rounded half up to the minor unit); never the first match. A refurb, open-box or marketplace listing never becomes the baseline when a new first-party one exists. A listing whose condition is `unknown` is shown with a flag, left out of the reference and never triggers a new-item alert. One URL belongs to one product's history.

**Per-listing scheduling.** Each tracked listing has `next_check_at` (default 30 min; floor 5 min), per-host back-off, and incremental writes. This replaces the predecessor's single sweep that waited for the slowest store. After 3+ consecutive errors over a day, re-discovery is queued (at most daily).

**Alert rules.** The compared price is the effective price after automatic discounts, shown beside the sticker; a coupon that needs a clip or a code never fires an alert on its own. A drop fires when the price is below the baseline by more than 3 MAD (floor 1%) and by at least the user's threshold (inclusive), confirmed by a second read on the same read path and rung that itself meets the rule; a smaller drop on the second read sends nothing and the watch keeps watching. A target price fires when it is reached (at or below it). A restock fires only on an out→in transition (first sighting is not one), with a watermark rather than a cooldown. Only fresh, in-stock, same-currency, same-read-path observations are compared. The 12 h cooldown is per watch and is bypassed only by a further drop; after expiry a repeat needs a moved price. The cooldown is stamped only when a push channel confirms delivery, or the in-app channel where no push channel is configured (§5.11). Evaluation is serialised.

**Scheduler** (own, SQLite-backed):
- every job has an overlap lock, a deadline and a run row; a run that reaches its deadline ends as timed out and keeps its partial results;
- missed slots coalesce into one catch-up on resume, and boot schedules a catch-up;
- network-dependent jobs wait on a DNS gate (delays of 0/3/5/10/20/30 s between probes, so probes at 0, 3, 8, 18, 38 and 68 s), then retry in 60 s without moving the cadence;
- a second caller of a running job joins it.

`/api/health` (open, counts and times only) reports last and next runs, skipped runs, the build version, the available fetch rungs, add-on state and LLM circuit state. `POST /api/refresh` is idempotent.

### 5.9 Used goods and marketplaces (R§3.5)

**`MarketplaceAdapter` interface:** id, countries, `requires {browser, userKey, session}`, minIntervalSec, dailyRequestCap, supports flags, status, buildSearchUrl, search, optional detail. Returns an Outcome: `ok | blocked | rate_limited | needs_person | not_configured | parse_error` (`rate_limited` carries the Retry-After delay when given; `not_configured` names the unmet requirements). Only `parse_error` counts against adapter health; three in a row marks the adapter "broken since …" in the UI.

**Wave 1 (core, keyless)** [verify sustained polling]:
- Kijiji: `__NEXT_DATA__`/Apollo state with card and JSON-LD fallbacks.
- Craigslist: HTML list joined with JSON-LD. The RSS feed is dead.
- OfferUp: `POST /api/graphql`.
- Marktplaats/2dehands: `/lrp/api/search`.
- Kleinanzeigen: HTML JSON-LD.
- Gumtree and Subito: HTML.
- Best Buy Canada `/api/v2/json/search` for open box.
- Refurb stores (Reebelo, makers) through the generic reader, with a condition field.

**eBay:** the Browse API only, with the user's own free Production keyset; the UI explains the account-deletion exemption. Default poll is 30 minutes, auctions are off by default, and no seller username is stored. eBay HTML is never scraped. **Facebook Marketplace:** deep link only in the core. **Later, in the browser add-on:** Vinted, Mercari, Depop, Wallapop and an opt-in Facebook adapter (≤60 req/h, stop on first login redirect).

**Politeness.** A per-install daily request cap per marketplace (default about 300 per site per day) on top of host pacing.

**Saved-search pipeline:**
- one job per (search, marketplace), default 15 min local and 30 min eBay;
- silent first run;
- diff on external id; "new" means first seen by us;
- a listing is "gone" after three clean polls;
- cross-posts are clustered by title overlap, price, place and photo hash;
- code filters run first, then a model judge in batches of 5 with fixed JSON (match, variant, condition, flags, reason) under a code-enforced daily cap;
- push only for match = yes and verdict great or good;
- without a model the same alerts go out labelled "unchecked".

**Valuation** (code only, same currency and condition band, ≥8 de-duplicated comparables):
- **great**: ≤20th percentile and ≥35% under new;
- **good**: under the median and ≥20% under new;
- **high**: over the 75th percentile or within 15% of new;
- otherwise **unknown**.

The inputs are asking-price distributions, the cheapest verified new price for the same variant, and our own disappearance record. No sold-price scraping. The thresholds are starting values, tuned in Phase 5.

**Scam flags** are named and each is tied to a rule or a quoted phrase: under about half the comparables' median; new seller; wire, gift-card or crypto payment; off-platform contact; stock photos only; the same photo hash or text under other sellers. Flagged listings are shown with their flags, not hidden. Vision is an optional second stage (≤3 images, off by default).

### 5.10 Personalisation and the feed (R§3.7)

**Profile.** Facts with provenance (§4.3), rendered by code into a ≤6,000-character document the user reads and edits. User-typed facts are never overwritten. Explicit corrections beat inferences. A gift or research search does not rewrite enduring interests.

**Interview** (six skippable steps, mostly taps): locale; category chips; brands and budget for the top three categories; owned things; sizes and household if relevant; thumbs on ten real deal cards. Afterwards, at most one inferred-fact confirmation card per week. Rejected proposals are never re-proposed.

**Implicit signals.** Views and clicks are weak evidence. Dismiss, "not interested", "already own", "wrong match" and "less like this" each have their own meaning. Each topic has two weights (14-day and 180-day half-lives).

**Purchase import,** in order:
1. the Amazon "Request my data" zip, detected by CSV header;
2. generic CSV, where the model proposes a column mapping and code applies it;
3. `.eml`/`.mbox` upload;
4. read-only IMAP on one folder.

The parse ladder is schema.org Order markup → platform templates → model extraction from an allow-listed field set. There is a per-source consent screen and a "what was sent to the model" log, and every import shows a preview before commit. Manual "I own this" / "I bought this" is enough on its own.

**Generators.** Code: watch drops and restocks, "watch this?", replenishment (model picks a lifecycle class from a fixed list; code computes the interval with shrinkage and never shows a card before 90% of it), sale calendar, community deal feeds matched to interests, Shopify `compare_at_price` markdown scan. Model: deal-to-profile judge (FTS5 prefilter to ≤40 candidates/day, batches of 5, ≤8 calls/day), lifecycle class and complements per new owned item (≤10/day), weekly profile reflection (≤5 proposed fact operations), weekly exploration ideas. The model proposes search ideas and explains their link to profile facts. Code filters duplicates, recent purchases, dismissed topics, constraint violations and unsupported claims, and never takes a price from the model.

**Budget.** About 20K input and 2.5K output tokens per day for all recommendation jobs, under a hard cap in code. Code-only cards still ship when the model is down; model-judged deals are held.

**Feed.** Finite: about 10 cards a day, ≤3 per topic, ≤4 per generator, and 2 labelled exploration slots (Thompson sampling over per-topic Beta counts). Assembled each morning with catch-up after sleep, plus an hourly on-demand refresh. Every card shows why it appears, its evidence and freshness, and one next action. Recommendation pushes default to 1 a day and 3 a week, within quiet hours; configured watch alerts are exempt. Running suggested searches automatically is an explicit setting with its own recurring budget, off by default.

**Optional local embeddings** (multilingual-e5-small via transformers.js) become the default only if keyword recall on the regression set is under about 70%.

**Evaluation.** Every impression is logged with rank, generator, score parts and model and prompt version. The app tracks per-generator acceptance, dismiss and push-open rates. A generator under 5% acceptance after 30 impressions has its slots halved automatically. Weekly offline replay runs against the next 14 days of activity. LLM-simulated users are not used as evidence.

### 5.11 Delivery (R§2.3, R§4.8)

The **feed is the durable record**. Every alert, recommendation, agent message and system notice is a `notification_event`. Each channel is a delivery of that event through an **outbox** with stable (event, channel) keys, per-channel retry state, quiet hours and cooldowns.

**Channels in the core:** in-app (always on), Web Push (VAPID; needs HTTPS, so it is never the only channel and the UI says why), ntfy, Telegram, Discord webhook, generic webhook. **Optional:** Matrix, Signal (signal-cli-rest-api), Apprise. "Chat apps" in v1 means Telegram and Discord.

**Retry policy** (ported from `pricewatch/notify`): transport errors and 408/425/429/5xx retry at 2/5/15 s and honour Retry-After; a delay over 30 s defers to the next outbox pass; auth and payload errors fail at once. Each channel returns a per-channel outcome, which gates the cooldown: acceptance by the in-app channel alone does not stamp it; push is retried until a push channel accepts, and the cooldown starts then. Where no push channel is configured, the in-app acceptance is the delivery. Every channel has a Test button.

### 5.12 UI (`apps/web`)

**Navigation.** Mobile-first PWA with a bottom tab bar: **For you** (home feed) · **Search** · **Watches** · **Chat** · **Settings**. Search is always one tap away and is also reachable from the feed header.

**Search results board,** fed by the SSE stream:
- groups for exact, substitutes and used/marketplace;
- per-row store, trust label, condition, item price with tax label, delivered total where known, deal verdict, freshness and read path;
- a coverage strip showing checked, walled, no price and unverified;
- one clarifying chip when needed;
- the "Dig deeper" button with its cost and time cap shown.

**Listing and product view:** price history chart (uPlot), verdict with its basis, other stores, and watch controls.

**Watches:** paste-box intake (a URL or a name, no model needed), status per listing, alert rules, and per-listing "wrong match" and exclude.

**Feed cards:** "because you…", evidence, one action, and feedback buttons (not interested, already own, wrong match, less like this).

**Profile:** the rendered document, editable facts, proposed facts to accept or reject, import with preview, and "what was sent" logs.

**Settings:** generated from self-describing provider, add-on and channel definitions; environment defaults with the source shown; a Test button everywhere. Diagnostics (runs, costs, fetch rungs, adapter health, job history) live under Settings → Diagnostics.

**First-run wizard:**
1. owner password;
2. locale (country, currency, language);
3. LLM endpoint, ending only when the probe passes or the user picks "no model yet";
4. optional add-ons and channels;
5. the interview (skippable).

**Budgets:** the SPA's first load is at most 200 KB of gzipped JavaScript. The UI is i18n-ready from day one: English first, with French as the first translation.

### 5.13 Settings and auth

- Settings live in the DB with environment defaults; the UI shows each value's source. Config is never rendered to files at boot.
- Secrets (API keys, channel tokens) are encrypted at rest with a key from the volume or the environment, redacted in logs, and never put in prompts.
- Auth: one owner password (`crypto.argon2`) set in the wizard, with session cookies. Trusted-header auth is optional. Generic OIDC (`openid-client`) comes later.
- Every API route except `/api/health` and static assets needs a session or an API token. A page in the browser add-on cannot send that token.

### 5.14 Packaging and operations

- **Images:** `core` (amd64 + arm64, non-root, `node:26-trixie-slim`); `browser` add-on; SearXNG upstream at a pinned tag. The HTTP client's native addon ships as one package per platform, so the multi-arch build installs the target platform's package.
- **Compose:** one file with profiles `browser` and `searxng`; one named data volume and one browser-profile volume; healthchecks; `init: true`; `shm_size: 1gb` for the browser.
- **Release budgets (CI-enforced):**

  | Metric | Target |
  |---|---|
  | Core pull | ≤110 MB |
  | Core unpacked | ≤320 MB |
  | Idle RSS | ≤150 MB |
  | RSS during a 30-50-page search | ≤400 MB |
  | Start to healthy | <3 s |
  | Browser add-on, Chrome stopped | ~20 MB |
  | Browser add-on, page open | 0.7-1.2 GB |

- **Backup and restore:** online SQLite backup (`VACUUM INTO`) on a schedule, plus documented restore. A host-side `sqlite3` must never open the live DB; the docs say so.
- **Upgrades:** migrations run at start-up. The build version and migration level are in health. An update check is optional and off by default (§9).
- **Retention:** bounded evidence excerpts, run payloads for 14 days, and price observations kept forever (they are small).

### 5.15 Security

- SSRF guard on every fetch and every browser request (§5.1).
- Containment by run type, so no run holds all three of: page text, the profile and privileged tools (§5.7).
- Human-only doors (REST and UI with a session, no tool): settings, credentials, channels, budgets, deletion, queue control, robots mode, store trust overrides.
- The browser add-on has no logged-in sessions by default. Logins are an explicit per-site user action through noVNC; passwords are never stored.
- Prices, URLs and store names shown to the user come from engine records. Model prose is rendered as plain text.
- Third-party text (agents.md, llms.txt, page text, feed items, emails) is data, quoted inside delimiters when passed to a model, and never placed in a system prompt.

### 5.16 Observability and evaluation

- One `run` record per harness run and one `job_run` per scheduled job, with status, usage, cost, budget hits, the tool-call list and refusals. Diagnostics pages read these.
- **Gold sets** in `evals/`:
  - the matcher set: ~60 products with 15-25 frozen listing snapshots each (1,000-1,500 relation labels), six categories, ≥40% hard negatives, 40 dev and 20 held-out products, 10% double-labelled, seeded from the predecessor's 20-product list and hand-review files;
  - the search set: the same products across three countries, run live on demand;
  - WebMall as an offline regression suite for the agent path.
- **Eval runner:** Vitest, with layers for the scripted fake LLM, recorded wire fixtures per server family, stored-run replay (all free in CI) and a paid live suite (3 trials, code graders first, budget assertions). Hand-review JSON plus offline rescoring is ported from `scripts/web-discovery-eval.py`.
- **In-app review queue:** 50 listings per run, stratified by decision tier, with one-tap labels that feed the gold set.
- **Access lab** (`lab/`, a dev tool): each transport or browser setup is run model-free against a fixed store list, classified by wall vendor, with fingerprints recorded.

---

## 6. Acceptance gates

These are measured on the gold and search sets. The gate values are proposals from the research (R§3.1, R§3.6), confirmed or revised after the Phase 2 prototype.

| Gate | Target |
|---|---|
| Critical regressions (currency, wrong variant, stale shown as current, fabricated price) | **zero** on the frozen corpus; blocks release |
| Identity precision (listings shown as exact), held-out | ≥90% to ship, 95% target (hard goods); report clothing/furniture separately |
| Price correctness of shown offers | ≥98% |
| Verified stores per product (median) | ≥6 |
| Best-offer recall on the reviewed set | ≥70% |
| Shown price age on search | ≤10 min |
| Repeat-query agreement | ≥95% |
| Unchecked or walled sources | always listed |
| Fast mode | p50 ≤30 s, p95 ≤60 s, median ≤$0.01, hard cap $0.03 |
| Cancellation | partial evidence returned, no further calls after cancel |
| Sleep/restart | queued work recovered, no duplicate in-app events, overdue jobs run once |
| Model outage | watches, sweeps, alerts and code-only feed cards keep working; labels show "unconfirmed" |

Results are always reported with sample sizes. Raw store counts are never reported as success.

---

## 7. Port map from hermes-shopping

| Port (behaviour + tests → TS fixtures) | Source |
|---|---|
| Money parsing, currency detection, bare-$ rule, regional URLs, converted-price refusal | `pricewatch/src/pricewatch/money.py`, `preferences.py`, `web_discovery.py` (`regional_url`, `converted`), `stores/learned.py` (`bare_dollar`) |
| Wall classification cases | `fetch.py` (`Page.looks_blocked`, `CHALLENGE_MARKERS`), `tests/test_fetch.py`, `tests/test_retail_reliability.py`, `tests/test_browser_mode.py` |
| Pacing, challenge wait, site-only session drop | `fetch.py` (`_HostThrottle`, `_settled`, `_SharedProfile.forget`) |
| URL guard | `fetch.web_url_problem`, `netguard.py`, `tests/test_fetch_private.py`, `tests/test_netguard.py` |
| Platform readers, structured-data readers, reader ladder | `stores/shopify.py`, `stores/woocommerce.py`, `stores/structured.py`, `stores/registry.py` |
| Web discovery candidate filter, listing key | `web_discovery.py` (`pick_candidates`, `product_signal`, `DENY_HOSTS`, `listing_key`) |
| Title matcher rules and owner rulings | `matching.py`, `reports/2026-10-23-matching.md`, review files in `scripts/eval/` |
| Alert semantics, restock, baseline hygiene, save-first intake | `service.py` (`_reasons`, `_should_notify`, `_upsert_offer`, `add_watch`), `tests/test_service.py`, `test_restock.py`, `test_watch_intake.py` |
| Scheduler catch-up and network gate | `scheduler.py`, `tests/test_scheduler.py` |
| Notification retry policy | `notify/__init__.py`, `tests/test_notify.py` |
| Recipe replay, health and queue lifecycle (Phase 6) | `recipes.py`, `stores/learned.py`, `web_discovery.py` queue functions |
| Coverage eval and hand review | `scripts/web-discovery-eval.py`, `scripts/eval/*.json` |
| Browser lab method | `scripts/browser-lab/`, `reports/2026-10-16-browser-access.md` |

**Left behind:** Hermes image, skills, dashboard, cron wrappers, profiles, tool bridge, s6 hooks; the 32-tool MCP surface; four browser modes; the hand-curated catalogue as a growth strategy; the displayed-price arbiter; the launchd wake agent (its contract moves in-process); Signal/WhatsApp channels as defaults; the used-car swarm; the Sunlu-specific community job.

---

## 8. Glossary

- **Listing:** one purchasable item at one store or marketplace URL, in one condition, from one seller.
- **Observation:** one read of a listing's price and availability.
- **Verified:** the engine read the price from the store itself in the user's market, and identity is confirmed (identifier, rules, cached verdict or a person).
- **Lead:** a candidate from search, the Catalog or a deal feed that has not been read and verified yet.
- **Coverage record:** per-source accounting of what was attempted, walled, unpriced and verified in one run.
- **Rung:** a level of the fetch ladder (api, http, browser, remote, person).

---

## 9. Open decisions for the owner

The project can start on the defaults shown. Each item names the phase that needs the answer.

| # | Decision | Default in this spec | Needed by |
|---|---|---|---|
| 1 | Project name and repository | **Decided 2026-11-17:** Agentic Dasher (`agentic-dasher`, `@agentic-dasher/*`); repository still `1mshy/shopping-agent` | Phase 0 |
| 2 | Licence | **Decided 2026-11-17:** PolyForm Noncommercial 1.0.0. Free to use, modify and distribute for non-commercial purposes; no commercial use. Source-available, not OSI open source | Phase 0 |
| 3 | Where the public UCP agent-profile JSON is hosted (e.g. GitHub Pages of the project) | **Decided 2026-11-23** (owner left the choice to the orchestrator): GitHub raw from the public repository, `https://raw.githubusercontent.com/1mshy/shopping-agent/main/lab/catalog/agent-profile.json`, which Shopify's guide names as a static host. It sends `max-age=300` without `public` and as `text/plain`. **Shopify refused it on 2026-11-23** (`profile_malformed`, "Invalid content type", spike B). **Re-chosen the same day:** the jsDelivr mirror of this repository pinned to the tag `agent-profile-v1`, `https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@agent-profile-v1/lab/catalog/agent-profile.json` (`application/json`, `Cache-Control: public, max-age=604800`, ETag); Shopify accepted it. A profile change means a new tag. The app itself runs in Docker on the user's own machine; only the profile is public | Phase 2 |
| 4 | robots.txt public default: keep `ignore` (owner's 2026-10-23 decision), or `respect` for unattended discovery of hosts the user never named | **Decided 2026-11-23:** `ignore`, setting exposed | Phase 1 |
| 5 | Native Anthropic Messages adapter in v1, or OpenRouter/LiteLLM for Claude until later | **Decided 2026-11-24** (the owner left the choice to the orchestrator and asked for the native adapter in the Phase 2 documents): the native adapter is built in Phase 2, not Phase 7, and is the tested route for Claude (§5.7). The evidence, from the 2026-11-24 recordings of Claude Haiku 5.5 (`evals/wire`, one session per endpoint): the native Messages API answered all seven probe steps; Anthropic's OpenAI-compatibility endpoint answered steps 2 to 5 but showed no prompt cache (3,645 and 3,644 uncached prompt tokens on the repeated prefix), no reasoning text or token count, refused `json_object` (400) and refused `/models` without the `anthropic-version` header (400). OpenRouter and LiteLLM were not recorded and stay untested | Phase 2 |
| 6 | May the capability probe call models.dev / OpenRouter's model list to prefill context sizes and prices? | yes, opt-out | Phase 2 |
| 7 | eBay: accept the BYO-key flow and the honesty question of the "not persisting eBay data" exemption | BYO key, deletion-webhook option documented | Phase 5 |
| 8 | Facebook Marketplace beyond a deep link (logged-in adapter in the browser add-on) | deep link only | Phase 6 |
| 9 | Household members: separate sub-profiles or tagged facts | single profile, `profile_id` everywhere | Phase 4 |
| 10 | Tax and duty estimates shown in landed price | tax label only; no duty estimate | Phase 2 |
| 11 | Reading a retailer account through the add-on browser to import orders | no | Phase 4 |
| 12 | Update check on by default | off | Phase 7 |
| 13 | Who labels the gold set after launch (owner only, or opt-in user exports) | owner only | Phase 7 |
