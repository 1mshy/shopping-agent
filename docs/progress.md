# Progress log

Per phase: what shipped, measured numbers with sample sizes, and deviations from the spec with reasons (plan, cross-cutting tracks). The newest entry goes at the top of its phase.

## Owner decisions (S§9)

| # | Decision | Status | Value |
|---|---|---|---|
| 1 | Project name and repository | **decided 2026-11-17** | Agentic Dasher: `agentic-dasher` (root package, image, compose project), `@agentic-dasher/*` (workspace packages). GitHub repo not renamed yet (`1mshy/shopping-agent`) |
| 2 | Licence | **decided 2026-11-17** | PolyForm Noncommercial 1.0.0 (SPDX `PolyForm-Noncommercial-1.0.0`): anyone may use, modify and distribute for non-commercial purposes; no commercial use. Source-available, not OSI open source |
| 4 | robots.txt default | open, needed by Phase 1 | spec default `ignore` |

Owner asked for "open source for anyone to use, distribute and modify, but no commercial use". A non-commercial restriction cannot be OSI open source, so the project is described as source-available. PolyForm Noncommercial was chosen over CC BY-NC because it is written for software (patent grant, cure period for violations) and Creative Commons advises against using its licences for software.

---

## Phase 0: Foundations, contracts and spikes

### 2026-11-18: Workstream 4, gold-set and review tooling (labels still to come)

**Shipped.** `evals/gold/` (PR #8): formats for products, listing snapshots, relation labels and the split manifest; validators with a progress and a strict mode; a seeded, stratified 40/20 split that never moves an assigned product and guards against the same product on both sides; held-out rotation by retiring; a blind second-label worklist and an agreement report (raw agreement, Cohen's kappa over the seven relations and over exact versus not exact, the confusion matrix). `evals/review/`: the predecessor's hand-review format described field by field, this project's version of it, a converter, and offline rescoring. Neither holds gold data: there are no gold products, snapshots or labels yet.

**Rescoring parity (measured).** Rescoring the two converted predecessor review files gives exactly the figures the predecessor's own `--rescore` gives, compared as fractions: 28 of its 30 summary figures per file and every product row (the other two are request timings, not ported). Checked stores before / after web discovery / with learned stores: 64 / 108 / 124 of 119 / 163 / 201 (n = 20 products, phase 5 review) and 70 / 110 / 123 of 84 / 124 / 140 (n = 20 products, matching review). The orchestrator re-ran the rescoring and compared its output with the summaries in the predecessor's published report files: the 18 integer figures per file match by name, and the medians match in value. The predecessor's script was run offline, with the network denied.

**These are the predecessor's metrics, not the S§6 gates.** Its "checked" figure counts stores, not listings; its denominator is every store with a verified row, not listings shown as exact; an unreviewed store counts as accepted; colour variants and open-box rows count as hits; and its 20 products are not a held-out set. From this data, identity precision, price correctness and best-offer recall cannot be computed. A median of checked stores per product is reported under its own name (3, 5.5 and 6.5 for the three setups in both files, n = 20) and is not the "verified stores per product ≥6" gate.

**The predecessor's reviews cannot seed gold labels as they stand.** Verdicts are per store, not per listing; neither verdict fixes a relation; and no reviewer is recorded (the commit that added the first review file calls it "not independently verified"). The 20-product list is carried in the converted files.

**Gate.** "Gold set v1 is labelled with its 40/20 split, 10% double-labelled, agreement reported": **pending-owner**. Needed from the owner: the six category ids, the EU country, labeller handles and a second labeller, the hard-negative definition (proposed: `variant`, `bundle`, `accessory_or_part`, `other_model`), whether 40/20/~60 are minimums, who made the predecessor's reviews, and then the labels.

### 2026-11-18: Workstream 3, fixture corpus

**Shipped.** `evals/corpus/`: a harness and 26 areas ported from the predecessor before any implementation exists (plan P0 workstream 3, CONTRIBUTING rule 2). Each area has a typed contract for the function Phase 1 will write, its cases, and a test.

**Gate: "the fixture corpus exists and fails for the right reason".** 568 cases, 568 pending, 0 implemented, with `pnpm test` exit 0. A pending case is counted only when its subject throws `NotImplementedError`; any other error fails the test, and so does a subject that answers while its area is still marked pending. Each porting unit confirmed this by making one case throw a `TypeError` and seeing `pnpm test` exit 1. Output of `node evals/corpus/count.ts`:

| Area | Cases | Status |
|---|--:|---|
| alert-delivery-gating | 7 | pending |
| alert-price-rules | 31 | pending |
| alert-restock | 15 | pending |
| challenge-wait | 22 | pending |
| converted-price-refusal | 6 | pending |
| currency-resolution | 37 | pending |
| known-failure-converted-currency | 5 | pending |
| known-failure-coupon-missed | 14 | pending |
| known-failure-financing-price | 8 | pending |
| known-failure-wrong-variant | 7 | pending |
| match-identifiers | 16 | pending |
| match-owner-rulings | 48 | pending |
| match-title-rules | 87 | pending |
| notify-retry | 33 | pending |
| price-text-parsing | 35 | pending |
| reference-price | 13 | pending |
| regional-url | 13 | pending |
| scheduler-catch-up | 10 | pending |
| scheduler-network-gate | 11 | pending |
| shopify-market-prefix | 14 | pending |
| stale-read | 10 | pending |
| url-guard-address | 52 | pending |
| url-guard-transport | 11 | pending |
| wall-classification | 31 | pending |
| walled-session-drop | 9 | pending |
| watch-intake | 23 | pending |
| **Total** | **568** | 568 pending, 0 implemented |

**Source.** The predecessor was read at `~/Documents/GitHub/hermes-shopping`, branch `browser-agent`, commit `51db126` plus its uncommitted files. **The owner has not confirmed that this is the reference copy**; the port started on 2026-11-18 on the orchestrator's judgement, because the copy holds every path S§7 cites. Expected values come from the predecessor's test assertions, from reading its functions, or from running its pure functions offline; each case says which. Its pytest suite was not run.

**How it was checked.** Lint, typecheck, test and build exit 0 on local `main` after each merge (no CI: nothing has been pushed since 2026-11-18). The orchestrator compared samples with the predecessor: money cases against `test_money.py`; every URL-guard expectation read one by one; every matcher query and 153 of 158 listing titles found verbatim in the predecessor's tests, review files or reports; retry delays and statuses against `notify/__init__.py`. No independent reviewer was run on the corpus.

**Where the cases follow the spec against the predecessor** (each is marked `divergence` in its case):

- Money: no default currency (the predecessor fell back to USD, or read `.com` as USD); a digit beyond the currency's exponent is refused, not trimmed; a range, a "from" price, a per-unit price or an instalment is not a price; a converted figure is refused at currency resolution instead of being flagged; the sticker is kept and the coupon stored as an amount off.
- Walls and guard: no bare-substring matching (a 410 with a marker, a product titled "Just a moment", a URL with "captcha" in its path are not walls); the HTTP rung pins to the checked address; every redirect hop is checked before it is followed; a session is not dropped on a 5xx or 429; a URL with user-info is refused (the orchestrator's change; the predecessor passed it).
- Matcher: a "for Business" or Bluetooth-only edition is a `variant`; a product sold with a filter pack is a `bundle`; an air fryer named only by its size is `unknown`, not a match.
- Alerts and scheduling: a drop needs a second read on the same read path; unknown stock is not compared; nothing is stamped when no channel accepted; every non-failed read writes an observation; a watch with no rule gets the 5% default instead of a refusal; the reference is the median, not the cheapest; a retry that fires mid-run joins the run; every 5xx retries.

**What the predecessor did not have.** No GTIN or brand + MPN matching (tier 1 of S§5.4 is new work, with no ported case). No saved wall pages (wall cases rest on its synthetic test bodies and its lab classifier). No test of pacing.

**Not ported here, and where it belongs.** Readers (Shopify, Woo, structured data, the variant-coupling failures: AliExpress multi-capacity prices, the cheapest-variant default, ProductGroup ranges), the web-discovery candidate filter and listing key, FX sort keys and the hint, the playbook, per-listing scheduling and re-discovery after errors, channel adapters, recipes. Each arrives with fixtures first in the unit that implements it. Left behind per S§7: the displayed-price arbiter, the wake agent, the user-set sweep cron.

**For the owner before Phase 1.** The porting units raised 44 questions; the ones that change what Phase 1 builds:

1. *Alert rule (S§5.8).* Over which reads is the MAD taken, raw or scaled, and is the 1% floor 1% of the baseline? Must the confirming read itself meet the rule, and may a failed read come between the two? Does "same read path" include the rung? Is the compared price the sticker or the effective price? Is the user's threshold inclusive (ported) or strict?
2. *Cooldown and delivery (S§5.11).* Is the cooldown per watch (any channel accepted; ported) or per channel? Does acceptance by the always-on in-app channel stamp it? If it does, a failed push no longer keeps the watch armed.
3. *Reference price.* User-confirmed price or median when both exist; even-count median rounding; recomputed or fixed once set; does `unknown` condition count as new?
4. *Scheduler.* Are "probes at 0/3/5/10/20/30 s" delays between probes (ported: 0, 3, 8, 18, 38, 68 s) or offsets from the start? What does reaching a job's deadline do?
5. *Currency.* Is a Shopify Markets presentment price a converted figure (the cases accept a platform-declared currency)? Where does an explicit mark on the figure rank against the ccTLD and the locale? Should "1.299 €" read as 1,299 euros (refused for now)? Half-up rounding of percentage coupons is assumed.
6. *Walls and guard.* Is a bare 403 a wall, and a 401 `login_required`? Should in-house walls name their vendor (`ebay`, `amazon`)? Which address ranges beyond S§5.1's five are refused, and under which reason? `POLICY_REFUSAL_REASONS` has no value for a URL that is unacceptable as written (user-info, no host); `scheme` is used. Where is the threshold for `empty`?
7. *Matcher.* 35 cases expect a set of relations because the evidence does not fix one: they need the owner's label. Does "Plus counts the query's way" cover model names (Instant Pot Duo Plus) or only material grades? Is a model number in the listing's URL path identity evidence? Matte and silk: a finish (accepted by the review rule) or another line (rejected in the SUNLU review)?
8. *Contract alignment.* The gold-set product identity (`evals/gold`) and the matcher corpus's asked side (`SearchIntent`) differ in shape (nullable versus optional fields, `mustHave` as an array versus a record); one shape should be chosen before labelling starts.

The vocabularies the areas define for themselves (alert silence reasons, restock silence reasons, intake refusals, retry actions, price-text refusal codes) are proposals for `packages/shared`, to be settled by the Phase 1 units that implement them.

### 2026-11-18: Workstream 2c, database schema and first migration

**Shipped**

- `packages/db/migrations/0001_initial.sql`: 24 tables (all `STRICT`), 17 named indexes, 11 triggers, 138 CHECKs (32 named). Revised after the review of PR #12 (2026-11-18): every rule below that was added or changed then is marked *(review)*. `migrations/README.md`: hand-written, never generated from Drizzle, a released file never changes, LF line endings. `src/migrations.ts` embeds the SQL files as a module (generated by `scripts/embed-migrations.ts`, `pnpm --filter @agentic-dasher/db migrations:embed`); a test fails when module and files differ.
- `src/migrate.ts`: `migrate(db)` applies the pending migrations in order in one `BEGIN IMMEDIATE` transaction, records each in `schema_migration` (version, name, SHA-256 of the SQL, applied_at) and returns `{level, applied}`; a second run applies nothing. It refuses a database that records a migration this build does not know (`ahead`), a recorded migration whose name or SQL changed (`changed`), and a pending migration below the level (`out_of_order`). Foreign keys are off while migrations run (SQLite's procedure for table rebuilds) and `foreign_key_check` must be empty before the commit. `migrationLevel(db)` reads the level for health. Wiring both into start-up and `/api/health` is Phase 1's.
- `src/schema/`: Drizzle definitions of every table. TypeScript keys follow the contract casing, so `Listing`, `PriceObservation` and `Delivery` rows parse as they are read; `RunRecord`, `RunStep`, `NotificationEvent` and `MatchVerdict` need a small mapping (nested budget and cost, OpenTelemetry names, union by kind, no id). `Database.exec` added; `open.ts` is still the only importer of better-sqlite3. It now sets `busy_timeout` before switching to WAL (several processes opening one new file hit `SQLITE_BUSY` otherwise) and turns `recursive_triggers` on *(review)*.
- 245 new test cases (tests first, in two rounds; 72 are per-table drift checks): runner behaviour, schema drift, ownership and money by introspection, round trips through the Zod contracts, one refusal per SQL rule, ON DELETE behaviour, timestamp order; and *(review)* unparseable timestamps, JSON5, every REPLACE, upsert and IGNORE route around the guarded tables with `recursive_triggers` off, 2^53 amounts, structural checks that every timestamp uses `IS`, every JSON column `json_valid`, every amount and token count the 2^53 bound, every foreign-key child column an index, and that the migrated database still has every named CHECK, every trigger and the CHECK count (what the drift test cannot see). Spot-checked by mutation in round one: removing one CHECK from the SQL and changing one Drizzle column's nullability each failed exactly the expected test.
- New dependency of `packages/db`: `@agentic-dasher/shared` (workspace), for the vocabulary types and the contract tests.

**Tables.** Phases 1-3 need: S§4.1 all seven (`store`, `host_access`, `product`, `listing`, `price_observation`, `match_verdict`, `fx_rate`); S§4.2 all three (`watch`, `watch_listing`, `search_run`); S§4.3 `event`, `candidate`, `feed_card`, `deal_feed_item` (feed v1, Phase 3); S§4.4 `job`, `job_run`, `run`, `run_step`, `notification_event`, `delivery`, `channel`, `llm_endpoint`, `setting`; and `profile` (id only) for `profile_id` to reference. Left for their phases: `profile_fact`, `profile_constraint`, `topic`, `owned_item`, `purchase`, `import_batch` (Phase 4); `recipe`, `exploration_task` (Phase 6).

**Ownership.** User-owned (NOT NULL `profile_id`, RESTRICT): `watch`, `watch_listing`, `search_run`, `event`, `candidate`, `feed_card`, `run`, `run_step`, `notification_event`, `delivery`, `channel`. Catalogue (shared by every profile): `store`, `host_access`, `product`, `listing`, `price_observation`, `match_verdict`, `fx_rate`, `deal_feed_item`. Operational (install-wide): `job`, `job_run`, `llm_endpoint`, `setting`. A child carrying `profile_id` references its parent through `(id, profile_id)`, so a step, delivery, watch link or alert cannot point at another profile's row. The test keeps an explicit classification of every table, so a new one cannot land unclassified.

**Columns left out, for the owning phase.** The rule they rely on: a later nullable column is an `ALTER TABLE … ADD COLUMN`; a NOT NULL column without a default, or a new or changed CHECK, is a table rebuild. So each owning phase decides nullability with that in mind.

- `watch.status` (Phase 1 watches). Under RESTRICT a watch that has alerted cannot be deleted; that lifecycle can add a nullable `archived_at` without a rebuild.
- `next_check_at`: S§5.8 gives each tracked listing one, but S§4 puts it on no table (Phase 1 watches). Likewise the restock watermark and the cooldown stamp (Phase 1 alert rules).
- The job overlap lock and job status (Phase 1 scheduler); the `store` health fields; per-host pacing state, which S§5.1 says is persisted (Phase 1 fetch).
- The buy-box disagreement flag of S§5.2 (Phase 6 browser reads).
- `llm_endpoint` prices and circuit-breaker state (Phase 2: S§4.4 does not give the price components or unit; they must be integer nano-units beside a currency).
- A dedupe key on `deal_feed_item` (Phase 3 deal feeds).
- `search_run` created time and raw input (S§4.2 lists neither; Phase 2).
- What an `event` is about, `candidate` and `feed_card` content beyond the generator and the evidence, `channel` quiet hours (Phase 3).

**Decisions**

- **STRICT tables**, so an INTEGER column refuses `449.99` and non-numeric text; with that, "no REAL money" holds at the storage layer, not only in the schema text.
- **No column default anywhere.** No default currency, and no default can turn an unknown into a value. Writers state every value; a test checks every column.
- **A CHECK that evaluates to NULL passes** *(review)*. Every CHECK is written to be TRUE or FALSE for every input: a nullable column is accepted as NULL by an explicit `x IS NULL OR …`, and a function that returns NULL on bad input is compared with `IS`.
- **Timestamps** are checked with `strftime('%Y-%m-%dT%H:%M:%fZ', x) IS x` *(review; was `=`, which passed every text strftime cannot parse, such as `'yesterday'`, `''` or `String(new Date())`)*: exactly three fractional digits, `Z`, and a real date, or NULL in a nullable column. One timestamp without milliseconds would sort after later ones (`Z` > `.`), so this is checked in SQL. The ledger's `applied_at` too.
- **JSON** *(review)*: every JSON column must pass `json_valid` (RFC 8259), and its top-level type is checked where a contract fixes it. `json_type` alone accepts JSON5 (`[1,2,]`), which `JSON.parse` then refuses on every read of the row.
- **CHECK versus boundary.** A vocabulary is a SQL CHECK only when S§2 fixes the set or another column's presence depends on the value, because changing a CHECK rebuilds the table. Checked in SQL: availability and shipping status (S§2.10), delivery state and outcome, cost source, run status, run-step operation, notification kind, verdict `decided_by`. Every other vocabulary (platforms, routes, read methods, rungs, channel types, run types, event kinds, conditions, …) is TEXT validated by `vocab.ts` at the boundary. Plain column logic that is a stable invariant is CHECKed: money with currency `unknown` is null; amounts are between 0 and 2^53 − 1 *(review: the upper bound, so JavaScript reads every amount back exactly; token counts too)*; shipping amount only with `known` or `estimated`; unit price and unit together; effective needs the sticker and is at most it; landed needs effective (≤ landed), known shipping and an empty missing-components list *(review)*; a sticker needs at least one raw candidate *(review)*; a row with no sticker is out of stock or has currency `unknown` with at least one raw candidate (the failed-read rule; *review*: the candidate term); store and host_access hosts are non-empty and lower-case, event keys and texts non-empty, FX rates positive and finite, a setting's JSON value not JSON `null` *(review)*; cost null exactly when the source is `none`, and in the spend currency; turns ≤ max_turns; cached ≤ input and reasoning ≤ output tokens; ended ≥ started, and set exactly when not running; each run-step kind's columns set exactly for that kind; each notification kind names exactly the records it rests on; `accepted_at` exactly when accepted, `next_attempt_at` exactly when pending, outcome consistent with state and attempts; verdict prompt version and model id exactly for model verdicts; currencies are three capitals (or `unknown` where the contract allows it); booleans 0/1. Left to Zod because they read JSON contents beyond its length: `missing_components` against the fields, `exact` has no differing attribute, no spend hit with unknown cost, array distinctness. Not mirrored in SQL by decision: Zod's currency list, the GTIN check digit.
- **Append-only and audit tables, guarded whatever the connection** *(review)*. A REPLACE deletes the conflicting row without firing DELETE triggers unless `recursive_triggers` is on, so `INSERT OR REPLACE` and `REPLACE INTO` used to rewrite an observation silently. Each guarded table now also has a `BEFORE INSERT` trigger that refuses an insert onto an existing id (and onto an existing other unique key: the event key, the delivery's `(event, channel)`); that also turns `INSERT OR IGNORE` and upserts on an existing row into errors. `recursive_triggers` is on in `open.ts` as a second line.
  - `price_observation`: UPDATE, DELETE and REPLACE refused (S§4.1; S§5.14 keeps observations forever), so a listing and its store cannot be deleted either.
  - `event`: UPDATE and REPLACE refused, DELETE allowed (it is the user's own behaviour data, deletion is a human-only door, S§5.15, and no retention rule keeps it).
  - `notification_event`: UPDATE, DELETE and REPLACE refused *(review, coordinator's decision)*. It is the audit trail of S§2.11; loosening a trigger later is cheap, un-losing an audit row is not.
  - `delivery`: state changes by UPDATE; DELETE refused while its event exists, REPLACE refused, and a change of its id, profile, event or channel refused (an `UPDATE OR REPLACE` onto another `(event, channel)` would delete that delivery) *(review)*.
- **ON DELETE.** CASCADE only for rows that are parts of their parent: run steps (run), watch links (watch), job runs (job). RESTRICT everywhere else: catalogue history, every `profile_id`, the records an alert rests on, and *(review, coordinator's decision)* `delivery` → `channel` and `delivery` → `notification_event`, because `accepted_at` is the only durable proof that an alert was accepted (S§2.11). Deleting a channel that has deliveries is therefore refused; how a user removes one is the Phase 1 delivery unit's (a nullable column added later is cheap). Deleting a watch that alerted is refused until the watch lifecycle decides. No SET NULL: every contract reference that could be nulled is required.
- **An alert's observation is of its listing** *(review)*: composite foreign key `(observation_id, listing_id)` → `price_observation (id, listing_id)`, with `UNIQUE (id, listing_id)` on `price_observation` as its parent key. No foreign key from an event to `watch_listing`: a watch may stop following a listing after it alerted.
- **`search_run.intent_json` is nullable** *(review, coordinator's decision)*: S§2.9 writes a search before any call, and interpretation is a model call that may not have happened. No input column yet (S§4.2 lists none; a nullable column later is cheap).
- **Money.** Every amount is INTEGER beside a currency on the same row; run cost and spend are nano-units. The run budget is flattened (`max_turns`, `deadline_ms`, `max_input_tokens`, `max_spend_nanos`, `spend_currency`) so the spend cap obeys the same rule and `turns <= max_turns` is a CHECK. `watch.currency` is null until the first real read (S§5.8) and a reference price needs it. The only REAL column is `fx_rate.rate`, a ratio. `deal_feed_item.price_text` is the feed's text: a lead's figure is not an amount until a live read confirms one (S§5.3).
- **Keys and indexes**, each for an access path the spec states: `(store_id, url_canonical)` unique (S§5.8 one URL, one listing); listings by product; observations by `(listing_id, observed_at)`; products by GTIN (tier 1), unique; the verdict cache key of S§5.4 plus `decided_by`, so a person's override sits beside the verdict it overrides (NULL prompt and model compared through `coalesce`); watches of a listing; `(watch_id, listing_id)` unique; `(event_id, channel_id)` unique (the outbox key); `(profile_id, key)` unique (the stable event key); pending deliveries by `next_attempt_at` (partial); run steps by `(run_id, step_index)`; payloads to trim by `started_at` (partial); due jobs; a job's runs by time; FX by pair and date, and `(base, quote, source, as_of)` unique *(review)*; host access by `(host, page_kind)`; store by `(host, market_prefix)`, with `''` for no prefix. *(review)* Every foreign-key child column except `profile_id` leads an index (a test checks it), which added `delivery.channel_id`, `notification_event`'s `watch_id`, `listing_id`, `observation_id`, `feed_card_id`, `run_id`, and `search_run.run_id`; not every `profile_id` (one profile in v1).
- **How migrations reach the runtime.** The SQL files are the versioned source (S§4) and are embedded in `src/migrations.ts`, so the tsdown bundle carries them and nothing outside `packages/db` changes (no copy step, no path resolution from `dist/`). Checked by bundling `packages/db` with the server's tsdown config shape (better-sqlite3 external) and running `migrate` from the bundle, and by running it from source under Node type stripping.
- **Drizzle** declares columns, types, nullability, keys, foreign keys with ON DELETE, unique constraints and indexes; CHECKs, triggers and STRICT live only in the SQL. The drift test compares Drizzle's metadata with `PRAGMA table_xinfo`, `foreign_key_list`, `index_list` and `index_xinfo` of a migrated database (drizzle-kit is not used); the CHECKs and triggers are tested by behaviour, and *(review)* a structural test pins the named CHECKs, the triggers, the CHECK count and STRICT, so a migration regenerated from Drizzle cannot pass. Migrations are never generated from the Drizzle definitions (`migrations/README.md`, `src/schema/index.ts`).
- `profile` holds only `id` and the migration does not insert profile 1: creating it at start-up or in the wizard is Phase 1's.

**Spec edits**

- §4.3 `event`, **a rule change, not a description**: "append-only" now means never updated or replaced, and the user may delete an event. Reason: it is the user's own behaviour data, deletion is a human-only door (S§5.15), and no retention rule keeps it forever.
- §4.3 `deal_feed_item`: the price stays text until a live read confirms one.
- §4.4 `job`: a job definition has a unique name (S§4.4 lists no identifier, but S§5.8 health reports runs per job and a second caller joins a running job).
- §4.2 `search_run` *(review)*: `intent_json` is null until the request is interpreted, so a search is saved before any call (S§2.9).
- §4.4 `notification_event`, `delivery` *(review)*: an alert's observation is an observation of its listing; the event is the audit trail of S§2.11, never updated, replaced or deleted; a delivery changes state but is never deleted or replaced, so a channel with deliveries cannot be deleted.

**Open items**

- The columns listed above under "Columns left out", each for its owning phase.
- Money inside JSON (`watch.rules_json` target price, `search_run.budget_json` caps) must carry its currency; the schemas arrive with Phases 1 and 2.
- `product.family_id` has no foreign key until the Phase 1 matcher says what a family points at.
- How a user removes a channel that has deliveries, and a watch that has alerted (Phase 1 delivery and watches units).
- Not enforced in SQL: that a watch link's listing matches the watch, ids > 0. An upsert (`ON CONFLICT DO UPDATE`) on `delivery` is refused by the no-replace guard; the outbox updates a delivery with a plain UPDATE.
- `lower()` is ASCII-only in SQLite: hosts are expected in their punycode (ASCII) form, which the Phase 1 URL normalisation produces.

### 2026-11-18: Spike decisions recorded (B part 1, C)

**Spike C (platform route reachability): decision.** Report: `docs/spikes/c-platform-routes.md`. On its samples (200 hosts per list from Common Crawl, one run, one IP address, a plain client), the route answered on 184 of 200 Shopify hosts for `suggest.json`, 190 of 200 for `/products/<handle>.js`, 157 of 200 for the Woo Store API search, 72 of 200 for Magento GraphQL search, a SearchAction template on 63 of 200 home pages and an OpenSearch description on 1 of 200. Walls on 6 of 800 hosts; no rate limiting. The orchestrator recounted these from the raw result files (800 hosts, 1,840 requests, at most 5 per host).

- Platform JSON stays the first keyless in-store search route after UCP, in the order Shopify, WooCommerce, Magento. All three are built in Phase 1 workstream 3.
- Shopify `suggest.json` returns 417 for buyer languages it does not support (10 of 200); a 417 moves the search to the next route and the fingerprint records the predictive-search flag.
- Magento GraphQL search is treated as a Magento 2 route and skipped on Magento 1. The Magento sample is nearly the whole pool it was drawn from and is weak evidence on its own.
- SearchAction and OpenSearch are read from the home page already fetched and get no work of their own.
- The `api` rung can start on a plain client for these routes. This says nothing about product pages; spike A still decides the default `HttpTransport`.
- Not settled by this spike: the Shopify market prefix (not probed), UCP `search_catalog` per store, search relevance.
- Spec edits: S§5.2 (in-store search order wording, host fingerprint), S§5.1 (a challenge served as robots.txt gives no verdict).
- For owner decision #4: a `respect` setting would have refused 83 of 1,200 probes (47 by a rule, 36 because robots.txt was unreachable); 32 of those had answered. The sample comes from a crawler that obeys robots.txt, so this is a lower bound. No recommendation is derived from it here.
- Raw results are kept, uncommitted, in `lab/out/routes/` on the owner's machine.

**Spike B (Shopify Global Catalog), part 1: sources.** `lab/catalog/SOURCES.md` checks each S§5.3 claim against Shopify's and UCP's documentation as read on 2026-11-17. One request was sent to the endpoint (a profile-less `tools/list`, HTTP 200); no search was made and nothing was published.

- Confirmed: the endpoint; price and availability may be cached up to 10 minutes and metadata up to 24 hours (no 15-minute figure exists); no standing product database; attribution kept intact; a public agent profile is required and may be a static file.
- Corrected in the spec: `search_catalog` is a tool called with `tools/call`; the context sits under `catalog.context`; the profile host must not redirect and must send `Cache-Control: public` with `max-age` of at least 60.
- New, and not yet decided: Shopify says "Don't use unauthenticated requests for production traffic"; anonymous calls are limited per IP address and share one pool. Shopify's API terms forbid using the API "to monitor the availability, performance, or functionality" of it "or for any similar benchmarking purposes", which the plan's latency measurement comes close to. Using the API implies accepting those terms.
- Open, with the owner: accept the terms or not; where the profile is hosted; whether part 2 is a small functional check instead of the planned 60-query measurement; whether the keyless Catalog is on by default. Until then S§5.3 keeps its [verify] mark for the live behaviour.

### 2026-11-17: Workstream 2b (part B), domain contracts

**Shipped**

- `packages/shared`: `FetchOutcome` with `PlaybookOutcome` and the guard `changesPlaybook` (S§5.1); `MarketplaceOutcome` with `countsAgainstHealth` (S§5.9); `CoverageSource` and `CoverageRecord` (S§2.8); `StreamBlock`, `PatchOp`, `StreamEvent`, `applyBlockPatch` and `foldStream` (S§5.6). Tests first: 31 new run-time cases plus `test/transport.types.ts`.
- Nine vocabularies in `vocab.ts` (wall modes, policy refusal reasons, marketplace outcome kinds, adapter requirements, coverage source kinds, block types, store-read states, deal verdicts, result groups) and two validated ids (`SourceId`, `Host`). Nothing from part A was renamed or reshaped.

**Decisions**

- `FetchOutcome` is a union on `kind`. Every variant names its `rung`, because the playbook is kept per host, page kind and rung (S§4.1 host_access). `wall.mode` is enumerated from the browser-rung sentence of S§5.1 ("wait up to 20 s for a self-clearing challenge…; report a captcha or 'Access Denied' at once"): `challenge`, `captcha`, `access_denied`; the vendor may be null. `refused_by_policy.reason` has one value per refusing clause of the guard sentence; the five address ranges share `private_address`, and a failed redirect re-check reports the clause it failed. `rate_limited` carries `retryAfterMs` (null when no Retry-After was given), what a caller needs to honour the limit. Bodies are not part of the contract. Only `ok`, `wall` and `empty` narrow to `PlaybookOutcome`.
- `MarketplaceOutcome` is a union on `kind`; `not_configured` names the unmet requirements of `requires {browser, userKey, session}`; only `parse_error` passes `countsAgainstHealth`.
- Coverage source: what S§5.6 step 2 fans out to, each identified: the Catalog (one), a web-search engine (`engine`, so an unresponsive engine is its own entry: attempted, not completed, timed out), a store (`host`, with `storeId` null for a host not yet in the directory, since S§5.2 adds a store only after a read), a marketplace adapter (`adapterId`). Fields follow S§2.8 as booleans plus two counts. The schema refuses: attempted while disabled; completed, walled, timed out or any count without an attempt; completed and timed out together; a source listed twice. Totals are derived, never stored. Booleans rather than one state value, because S§2.8 lists them as separate facts (a store can be walled on one URL and still complete) and they patch naturally in the stream.
- Stream envelope: `block`, `patch`, `end`, each with `seq` (1, 2, 3…), which is the SSE id; the reconnect route replays after `Last-Event-ID`. `end` carries the final status and the coverage record, so a cancelled run (S§6) ends with its partial evidence; `foldStream` shows it. Patches allow `add` and `replace` only: blocks only settle or grow, so a replay is a left fold, and `applyBlockPatch` re-validates the block after each patch, so a patch cannot leave a float price or a price without its observation. A patch never touches `/type`.
- Prices in blocks are `Money` next to the observation id they were copied from (`store_read` when priced, a candidate's shown observation, summary money segments; a money segment's id is null only for a figure code computed over several observations). Percentages are integer basis points. A delivered total is in the item price's currency and not below it. A `verdict` with group `exact` must have relation `exact` (S§5.4 "A cheaper substitute is never shown as an exact match").
- Summary: a list of segments. The model writes `text` only (with the part A second-line refusals); `money`, `count` and `store` segments are filled by code from engine records (S§2.1, S§5.15). The UI joins them; nothing is pre-joined.

**Spec edits**

- §4.2 search_run `coverage_json`: what a source is and the fields per source.
- §5.1 typed outcome: rung on every outcome, wall modes and unknown vendor, Retry-After on `rate_limited`, the policy refusal reasons.
- §5.6 progress stream: the envelope, sequence and reconnect, the patch subset, `end` with status and coverage, Money with observation ids, basis points, the verdict payload, summary segments.
- §5.9 Outcome payloads for `rate_limited` and `not_configured`.

**Open items**

- Summary value kinds are `money`, `count` and `store` only; Phase 2's placeholder contract may need a date or a percentage segment.
- The outlier rule's "shown separately with the reason" (S§5.5) and the "unconfirmed"/"unchecked" labels (S§2.4) have no field in the verdict block yet; they are derivable from `decidedBy` and `relation` for now.
- Cross-block consistency (a candidate's observation matches its store_read; coverage counts match the candidates) is not checked by the schemas.

### 2026-11-17: Spike C: platform route reachability

One full run of `lab/routes/` (17:57:51Z to 18:03:44Z): 800 hosts, 1,840 requests, at most 5 to one host, no interruption. "Answers" are payloads of the documented shape (`ok + empty`). After the offline re-classification from stored evidence described in the report (12 records changed, all Magento or robots.txt).

| List | Route | n | Answers | Answers, confirmed platform hosts | Wrong platform | Walls |
|---|---|--:|---|---|---|---|
| shopify | `suggest.json` | 200 | 184 (92.0%) | 184 of 196 (93.9%) | 0 (0.0%) | 0 |
| shopify | `/products/<handle>.js` | 200 | 190 (95.0%) | 190 of 196 (96.9%) | 0 (0.0%) | 0 |
| woocommerce | Store API search | 200 | 157 (78.5%) | 157 of 185 (84.9%) | 7 (3.5%) | 0 |
| magento | GraphQL `products(search:)` | 200 | 72 (36.0%) | 72 of 144 (50.0%) | 16 (8.0%) | 5 (2.5%) |
| searchaction | SearchAction on the home page | 200 | 63 (31.5%) | n/a | n/a | 1 (0.5%) |
| searchaction | OpenSearch description | 200 | 1 (0.5%) | n/a | n/a | 1 (0.5%), inherited |

- Sample: four lists of 200 hosts from Common Crawl CC-MAIN-2026-43 (clustered draw, TLD-skewed, from a robots-obeying crawler; the Magento list is 200 of a 217-host pool and includes Magento 1).
- Client: plain Node `fetch`, honest bot User-Agent, one run on one day from one IP address, no Shopify market prefix.
- Also measured: Shopify `suggest.json` returns the documented 417 "Unsupported buyer locale" on 10 of 200 hosts; a robots.txt `respect` setting would have refused 83 of 1,200 route probes (47 by a rule, 36 by an unreachable robots.txt), 32 of which had answered.
- Proposed decision (owner to confirm): keep platform JSON first after UCP in S§5.2 in-store search, in the order Shopify, WooCommerce, Magento; handle Shopify's 417; treat Magento GraphQL as Magento 2 only; keep SearchAction/OpenSearch as a by-product of the home-page fetch. Proposed spec edits are listed in the report; `docs/spec.md` is not changed.
- Lab changes: the Magento probe is a product search; result lines keep the classifier's whole input; `reclassify.ts` re-runs the classifier offline; five classifier rules added from the review.

Report: [`docs/spikes/c-platform-routes.md`](spikes/c-platform-routes.md).

### 2026-11-17: Workstream 2b (part A), domain contracts

**Shipped**

- `packages/shared`: Zod schemas for the persisted records `Listing`, `PriceObservation` (all S§4.1 fields), `MatchVerdict`, the judge's output (`JudgeVerdict`, `JudgeBatch`), `PlannerIntent`, `PlannerOutput` and `SearchIntent`, `NotificationEvent` and `Delivery`, `RunRecord`, `RunStep`, `RunBudget` and `RunCost`. Each exports its inferred type under the same name. Tests first (two rounds, the second after review of PR #9): 74 new run-time cases plus compile-time assertions in `test/contracts.types.ts`.
- 17 new vocabularies in `vocab.ts` and three validated free-text fields (below). `Money` is now strict: an unknown key is refused instead of stripped.

**Vocabulary gaps.** Enumerated where S§5 prose gives the values: read methods (S§5.2 reader ladder plus the S§5.2/S§5.9 adapters), identifiers offered (S§5.4 tier 1, S§5.3 listing key), fetch outcome kinds and the playbook subset (S§5.1 "Only `ok`, `wall` and `empty` may change the playbook"), price components (S§5.5), watch_listing added_by (S§5.12 paste box, S§5.3 re-discovery; a watch made through chat counts as `user`), search_run, run and job_run statuses (S§2.9 save first, S§6 cancellation, S§5.8 running jobs and skipped runs), run types (the S§5.7 run-type table), budget kinds (S§5.7), delivery state and outcome (S§2.11, S§5.11 retry policy), channel types (S§5.11 core channels), setting sources (S§5.13), SearchIntent kind and fulfilment (S§5.4). Free text, validated: wall vendor, FX source, unit-price unit (open-ended by nature). Left undefined until the phases that own those lifecycles (the migration omits the columns): store health fields, watch status, job status; profile_fact kind (Phase 4).

**Decisions**

- Casing: TypeScript keys, including the wire keys of model output, are the camelCase of the S§4 names (`*_json` drops the suffix); OpenTelemetry GenAI attributes keep their dotted names and appear only in `run.ts`. Every contract object is strict: unknown keys are refused.
- Ids are positive integers (SQLite rowid). Timestamps are UTC with exactly three fractional digits (`…:00.000Z`), so text order is time order in SQLite.
- PriceObservation: one `ListingCurrency`; every amount is a non-negative integer in its minor units; with `unknown` every amount must be null. Shipping carries an amount only when `known` or `estimated` (`conditional` depends on something the engine could not settle; `unknown` has none, S§2.10). `missingComponents` is tied to its fields by the rules that need no policy (sticker exactly when null; shipping when conditional or unknown, never when known; tax when inclusion is unknown, never when included or known; duty never when set); the rest is the Phase 1 derivation's policy (S§5.5, owner decision 10). `effective` needs the sticker and is at most the sticker (a coupon or member price only lowers it); `landed` needs `effective`, `known` shipping and an empty missing list, so tax inclusion is known, and is at least `effective`. The schema does not check the arithmetic. `coupon` is an amount off. A failed read writes no row, `multiple_prices` included: no sticker is allowed only when out of stock, or with currency `unknown` and raw candidates; a sticker needs at least one raw candidate.
- Model output: planner text is search input. It is matched against listings as text, never parsed into a figure, never shown as a price, a total or a date, and the budget comes only from the user's input through code (S§2.1). No pattern can stop a model from writing "300 dollars", so the schemas do not claim to. As a second line, model text refuses currency symbols and the percent and per-mille signs (`%`, `％`, `٪`, `﹪`, `‰`), queries included, and model attribute names refuse `price`, `budget`, `cost`, `discount`, `deal` and `sale`. The planner has no budget, currency, location, GTIN or MPN field: tier 1 confirms identity on identifiers and alerts follow from it (S§5.4), so identifiers come from code. The judge's output is strict; `differingAttrs` holds distinct attribute names, is empty for `exact` (a shared barcode, S§5.4), and `reason` is non-empty and stays in the run record. Must-have attributes and substitutes are distinct.
- Runs: one run has one type (S§5.7 table); a fast search is one run whose model-call steps carry the planner or judge role, prompt version, provider and model. Usage and cost on the run are totals. Turns never exceed `maxTurns` (checked before each call, S§2.6); tokens, time and spend may overshoot within the last call, so they are not bounded. With cost unknown no spend hit can be recorded (S§5.7). A run and each step end no earlier than they start.
- Run cost and the spend cap: integer nano-units (10⁻⁹ of the major unit) with an explicit `MinorUnitCurrency`, the one exception to S§4's minor units. Cents cannot hold a $0.0004 judge call; nanos hold $0.03 as 30,000,000 and per-token prices to three decimals per million exactly; the safe-integer ceiling is about $9 million. A provider-reported cost is read from its decimal text exactly and rounded up beyond nine decimals, so a cap is never under-counted. `RunCost` is a union on `source`: `none` has no amount field at all.
- OpenTelemetry: GenAI conventions left `open-telemetry/semantic-conventions` in v1.45.0 (2026-11-02) for `open-telemetry/semantic-conventions-genai` (status development, no tagged release; checked at commit e6658f1, 2026-11-06). Its usage attributes are `gen_ai.usage.{input_tokens, cache_read.input_tokens, cache_write.input_tokens, output_tokens, reasoning.output_tokens}`; v1.45.0's deprecated registry still says `cache_creation`. Null means not reported, never zero. A tool refusal's hint refuses every decimal digit (`\p{Nd}`); spelled-out numbers are not caught.
- Delivery is a union on `state`; `accepted` requires `acceptedAt` and outcome `accepted`, and only it may stamp a cooldown (S§2.11). Every listing alert, `new_listing` included (its push rests on a valuation, hence a price, S§5.9), names its watch, listing and observation.
- `Listing.variant` keys are store text (trimmed, at most 100 characters, "Size", "option1"); the strict attribute-name type is kept for model output and `differingAttrs`. A canonical URL carries no user-info. A GTIN is never all zero.

**Spec edits**

- §4 opening: model spend is the one exception to minor units (pointing to §4.4); timestamps have exactly three fractional digits.
- §4.1 store `read_route`, `identifiers_offered`; host_access `last_outcome`, `wall_vendor`; fx_rate `source`.
- §4.1 listing: `status` removed, because no sentence of the spec names a listing state other than "gone" (S§5.9) and `gone_at`, `trackable` and `consecutive_errors` already carry it; `variant_json` keys are the store's names.
- §4.1 price_observation: `coupon` defined; shipping amounts; unit pair; the needs and bounds of `effective` and `landed`; `missing_components` values and how they follow the fields; `read_path`; raw candidate fields; a sticker needs a raw candidate; the failed-read rule including `multiple_prices`.
- §4.2 watch_listing `added_by`; search_run `status`.
- §4.4 job_run status; run type, step roles, status, budgets, turns, budget hits (none for spend with unknown cost), the nano-unit cost and its rounding; delivery states, outcomes and `accepted_at`; channel types; setting sources.
- §5.4 SearchIntent kind and fulfilment, what the planner may not write (GTIN and MPN included), and that its text is search input; the judge's key is written `differingAttrs` (the casing rule), distinct, empty for `exact`, with a non-empty reason.

**Open items**

- A failed read writes no observation; where its candidate list is logged (S§5.2: "Each read stores its candidate list") is for the Phase 1 readers unit to settle.
- Not modelled yet: the buy-box disagreement flag of S§5.2 (arrives with browser reads in Phase 6); a `css` or recipe read method (S§5.2 ranks "generic CSS"; Phase 6 recipes); "free shipping" cannot be recorded when the currency is unknown, since every amount is then null.
- Schema patterns are enforced by Zod after a model replies. `z.toJSONSchema` exports a pattern without its `u` flag, and compiled without it `^[^\p{Sc}%]*$` refuses "Sony" and accepts "$300". The Phase 2 structured-output unit must not rely on patterns in an exported schema.
- Phase 2 must define the placeholder contract for model prose (agent notification `text`, summaries; S§2.1). Today that text is free text rendered as plain text.
- Whether "same read path" in the alert rules (S§5.8) also means the same rung is for Phase 1.

### 2026-11-17: Workstream 2a, Money, Currency and vocabularies

**Shipped**

- `packages/shared`: `currency-table.ts`, generated by `scripts/generate-currency-table.ts` from ISO 4217 List One. `Currency` (every ISO code plus `unknown`), `MinorUnitCurrency`, `ListingCurrency`, the `Money` schema (safe-integer `amountMinor` plus a required currency), and 24 enumerated S§4 vocabularies (plus S§2.10 shipping status and stock, S§5.1 rungs), each as an `as const` array, a Zod enum and a type.
- `packages/core`: `moneyFromDecimal`, `moneyToDecimal`, `minorUnitExponent`, `compareMoney`, `addMoney`, `subtractMoney`. Decimal strings are scaled with BigInt, so no float is involved. Every function returns a typed refusal for any run-time input and never throws. No I/O.

**ISO 4217 source.** List One XML from SIX, <https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml>, published 2026-09-17, SHA-256 `33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff`, fetched 2026-11-17. It has 178 distinct codes by exponent: 0 for 17, 2 for 139, 3 for 7, 4 for 2, and "N.A." for 13.

**ISO against ICU.** Node 26.2.0 (ICU 78.3, CLDR 48) disagrees with ISO for 16 codes. ICU gives 0 fraction digits where ISO gives 2 for AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP and YER, and where ISO gives 3 for IQD. The ISO values are kept. ICU does not know 22 table codes (the fund codes, VED, the metals, the bond units, XTS, XUA and XXX), so their exponents rest on the ISO list alone. The test lists both sets explicitly.

**Decisions**

- Codes with no minor unit ("N.A.") and `unknown` are valid `Currency` values but are not `Money`: an amount in minor units means nothing without an exponent. Converting them is a typed refusal.
- `ListingCurrency` (for `listing.currency` and `price_observation.currency`) is every code with a minor unit plus `unknown`. It refuses XXX, XTS, the metals and the bond units, so none of them becomes a second "unknown". Fund codes are still accepted (open point).
- Amounts are signed (for differences and discounts). Anything outside ±(2^53 − 1) minor units is refused, never rounded.
- Zero padding beyond the exponent is accepted because it loses nothing ("1299.00" JPY is 1299). A non-zero excess digit is refused. Decimal strings over 64 characters are refused before parsing, and echoed input in a refusal is cut to 24 characters.
- Exponent stability: amounts are stored without their exponent and `price_observation` is append-only, so the generator refuses to change an existing code's exponent or drop a code unless `--allow-exponent-change` is passed.

**Spec edits**

- §2 invariant 2: a price whose currency is `unknown` has null amount fields, and what was read stays as text in the raw candidates. An amount in minor units needs an exponent, and `unknown` has none.
- §4.1 `listing` and `price_observation`: currency is an ISO code with a minor unit or `unknown`; with `unknown`, sticker and the other amount fields are null. This states the same rule where the schema and migration units read it.
- §4.3 `event`: the kinds are written as identifiers (`not_interested`, `already_own`, `wrong_match`), and `less_like_this` is added. §5.10 and §5.12 name "less like this" as a feedback signal with its own meaning, but the §4.3 list left it out.

### 2026-11-17: Owner decisions 1 and 2

- Renamed to Agentic Dasher: package scope `@agentic-dasher/*`, image `agentic-dasher`, compose project `agentic-dasher`, database file `agentic-dasher.db`. Spec and plan titles updated.
- Licence changed from the AGPL-3.0 default to PolyForm Noncommercial 1.0.0 (LICENSE, every `package.json`, README, CONTRIBUTING, spec §1.3 and §9).
- Note for later: contributions arrive under the same non-commercial licence. If the owner ever wants to offer commercial licences, a contributor licence agreement must be in place before outside contributions are accepted.

### 2026-11-17: Workstream 1, repository scaffold

**Shipped**

- pnpm 12 workspace: `apps/server`, `apps/web`, `packages/shared`, `packages/core`, `packages/db` (S§3.2).
- TypeScript 7.0.2 strict, Biome 2.6, Vitest 5.1, tsdown 0.23 (server bundle), Vite 8 + React 19 (placeholder SPA).
- Server: Hono 4.13 on `@hono/node-server` 2.1, `GET /api/health` (status, version, uptime, DB ping, RSS), static SPA with fallback, graceful SIGTERM shutdown. SQLite opened in WAL mode via better-sqlite3 13 and Drizzle 1.0.0-rc.5.
- Core image `docker/Dockerfile` (node:26-trixie-slim, non-root, amd64 + arm64), `docker/compose.yaml` (`init: true`, named data volume, healthcheck), root `compose.yaml` so plain `docker compose up` works.
- CI (`.github/workflows/ci.yml`): lint, typecheck, unit tests, build, multi-arch image build, and the S§5.14 budgets as a failing check (`scripts/check-image-budgets.ts`, limits in `budgets.json`).
- LICENSE, README, CONTRIBUTING, this log; spec and plan moved to `docs/`.

**TypeScript 7 check (plan: confirm Hono and Drizzle inference on day one).** Passed on 7.0.2, so no fallback to 6.x. `apps/server/test/rpc.types.ts` (Hono RPC client response inference) and `packages/db/test/inference.types.ts` (Drizzle select, insert and partial-select inference) are compile-time assertions in `pnpm typecheck`; both were confirmed to fail when an assertion is deliberately broken.

**Budgets, measured locally** (Docker 29.9 on macOS arm64, one run, empty app):

| Metric | Value | Budget |
|---|--:|--:|
| Core pull (gzip of flattened fs) | 88.0 MB | 110 MB |
| Core unpacked | 278.7 MB | 320 MB |
| Idle memory (container, after 5 s) | 26.2 MB | 150 MB |
| Start to healthy (from `docker run`) | 234 ms | 3,000 ms |

Note: the base image is most of the size. Headroom is about 22 MB pulled and 41 MB unpacked for everything Phases 1-7 add to the core. If that runs out, the next lever is a custom base (Node binary on `debian:trixie-slim` without npm), not a budget raise.

**Decisions and deviations**

- **pnpm 12** (spec says pnpm workspaces, no version). Its defaults deny dependency install scripts and enforce a minimum release age; both are kept. `@hono/node-server` is pinned to 2.1.8 because 2.1.9 was published the same day.
- **Node 26 has no corepack.** CI uses `pnpm/action-setup` (reads `packageManager`), and the image installs pnpm with npm in the build stage only.
- **better-sqlite3 13 ships N-API prebuilds for all platforms** and has no install script. The image keeps only the target's `linux-<arch>.node` and drops the C sources (27 MB → 2.7 MB). Because of this, the whole image build runs on the build host's platform and multi-arch needs no QEMU.
- **Workspace packages are consumed as source** and the server runs on Node's type stripping in dev (`.ts` import extensions, `erasableSyntaxOnly`). Only the two apps have a build step.
- Budgets that need later subsystems (RSS during a 30-50-page search; browser add-on figures) are added to `budgets.json` with those subsystems. The SPA first-load budget (200 KB gzip JS, S§5.12) becomes a CI check in Phase 3 as planned; today's placeholder is 70 KB.
