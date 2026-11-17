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
