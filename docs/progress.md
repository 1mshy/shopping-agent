# Progress log

Per phase: what shipped, measured numbers with sample sizes, and deviations from the spec with reasons (plan, cross-cutting tracks). The newest entry goes at the top of its phase.

## Owner decisions (S§9)

| # | Decision | Status | Value |
|---|---|---|---|
| 1 | Project name and repository | **decided 2026-11-17** | Agentic Dasher: `agentic-dasher` (root package, image, compose project), `@agentic-dasher/*` (workspace packages). GitHub repo not renamed yet (`1mshy/shopping-agent`) |
| 2 | Licence | **decided 2026-11-17** | PolyForm Noncommercial 1.0.0 (SPDX `PolyForm-Noncommercial-1.0.0`): anyone may use, modify and distribute for non-commercial purposes; no commercial use. Source-available, not OSI open source |
| 3 | Agent-profile host | **decided 2026-11-23** | jsDelivr mirror pinned to the tag `agent-profile-v1` (`https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@agent-profile-v1/lab/catalog/agent-profile.json`), chosen by the orchestrator after Shopify refused GitHub raw's `text/plain`; accepted by Shopify in the second functional check |
| 4 | robots.txt default | **decided 2026-11-23** | `ignore`, setting exposed |
| 5 | Native Anthropic Messages adapter | **decided 2026-11-24** | Built in Phase 2 (was Phase 7), the tested route for Claude. The owner left the choice to the orchestrator and asked for it in the Phase 2 documents |

Owner asked for "open source for anyone to use, distribute and modify, but no commercial use". A non-commercial restriction cannot be OSI open source, so the project is described as source-available. PolyForm Noncommercial was chosen over CC BY-NC because it is written for software (patent grant, cure period for violations) and Creative Commons advises against using its licences for software.

---

## Phase 1: Deterministic core

Phase 1 started on 2026-11-24 at 22:15 as an unattended run: the owner handed it to the orchestrator for the night with 2 to 3 subagents, local commits and no pushes. **Nothing in this section has run in CI.** Every "exit 0" below is lint, typecheck, test and build run locally on the merged tree and judged by exit code. Unit status is in `docs/orchestration.md`.

### 2026-11-25, 05:00: Phase 1 report at the end of the unattended run

**Phase 1 is not complete.** Of its six exit gates, two hold (the fixtures; the image budgets, on arm64 only), two were measured in part (freeze, restart), and two could not be run (the live check, the directory comparison). The run was meant to go from 22:15 to 05:00; the session hit its usage limit at about 00:55 and nothing ran until 03:20, so about two and a half of its hours were lost. No later phase was started. **Nothing has been pushed and nothing has run in CI**: over 60 local commits sit on `main` ahead of `origin/main` (`90c6d2d`); `git rev-list --count origin/main..main` gives the number. This report was first written at 04:00 and brought up to date at the end of the run; the last hour has its own entry below.

**What exists.** A server that, with no model anywhere, takes a pasted product link through its API, saves it first, reads the page through the guard and the reader ladder on a schedule, records each price, evaluates drop, target and restock rules, and delivers alerts in-app, to ntfy or to a webhook; and a small web UI (set the password, set the market, paste a link, see prices, history and alerts) that was walked in a headless browser. Twenty-three units and pieces were built by subagents or the orchestrator, each read at least in part by the orchestrator, merged and checked locally. On `5e93b2d`: lint, typecheck, test and build exit 0; 3,916 tests in 182 files pass.

**What does not exist.** The rest of the UI (the one that exists is the cut-down one: an inline SVG line instead of the uPlot chart, no forms for channels or for changing the password, settings other than the market are read-only, no component tests); the store directory, host fingerprint and in-store search (workstream 3), without which a watch by name cannot find listings and ends `failed` with `NO_DISCOVERY_SOURCE`; store trust signals (RDAP, Tranco, look-alike); the country-pack script and the hand-written adapters; Telegram, Discord and Web Push (Phase 3).

#### Exit gates (plan, Phase 1)

| Gate | Value | Status |
|---|---|---|
| The ported fixtures all pass | 601 of 601 cases implemented, 0 pending, `pnpm test` exit 0. No case, expectation or contract was edited | **holds** |
| Freeze test: pause the container across several due slots; exactly one catch-up per job, no duplicate in-app events, the outbox retries a channel that 503s and then succeeds | One real pause of 3 min 35 s (`docker pause`, n = 1) across three one-minute slots: on resume each of the three minute-jobs ran exactly once, 0.1 s after the resume, each run standing for 3 slots; the next two slots ran once each on the grid; the watched listing kept its price and its next check. **Not measured in the container:** duplicate in-app events (no alert was pending) and the 503-then-200 retry (no push channel was configured). Both are covered only by scripted tests on a fake clock | **open** (measured in part) |
| Restart test: watches, history and pending outbox items survive `docker compose down && up` | One container removed and a new one started on the same volume (n = 1): the watch, its one observation, its reference, the session cookie and migration level 2 survived; one boot run per job; no run left `failed`. **Not measured:** pending outbox items across the restart (none were pending). `docker run` was used, not `docker compose` | **open** (measured in part) |
| Live check: 20 watched listings across ≥10 hosts read for 48 h; error rate per outcome kind; no failed read alerts | Not started: it needs the owner's approval of the listings and 48 hours. One listing on one host was read once (the first real read, above) | **pending-owner**, then **pending-time** |
| Directory comparison on the 40 dev products: verified stores per product and identity precision (tiers 1-2) reported against the held-out set | Not run: there is no store directory. The matcher's dev-split figures exist (precision of `exact` 70/73, recall 70/77, n = 867, tuned on that split, model labels on both sides). **The held-out split has not been run or read**, on purpose: it is to be run once, on the matcher as it stands when the directory exists | **open** (blocked on workstream 3) |
| Core image and RSS within budget | Image built from `5e93b2d` (the UI included) on this arm64 machine, n = 1, with the runtime started: pull 93.8 MB (budget 110), unpacked 292.0 MB (320), idle container memory 48.8 MB (150), start to healthy 259 ms (3,000). The Node process's own RSS at idle, from `/api/health`, was 141.7 MB; the budget is checked on the container's figure. **Not measured:** the amd64 image (CI does that), and the 400 MB budget for RSS during a 30-50-page search, which has no check yet | **holds** on arm64; amd64 unmeasured |

#### Reviews

Five independent reviews ran (the fetch path; the sweep, alerts, outbox and watch service; auth, sessions, CSRF and settings; then two of the fixes themselves: the alert fixes and the Host check) and found 34 defects, 6 of them critical. **The two reviews of the fixes each found the fix wrong or incomplete** (a restock recorded twice; the Host check bypassable with a trusted proxy), which is the measure of how far the unreviewed code here can be trusted. Fixed or bounded the same night, with tests written failing first (the cookie-jar tests were seen failing only after the change was written, by taking it out again; the file-mode tests were written with the change and never seen failing): the guard's own-network gap; out-of-stock reads in the reference; the reference including the reads being judged; the alert flood behind a permanently failed push channel; a web page claiming an install through DNS rebinding; reads of the API from another site; the session kept across a password change; a late-accepted older alert becoming "the last accepted"; a restock lost while a push is pending; late pushes saying "now" for an old price; the crash-plus-clock-step case; unbounded cookie jars; the session drop clearing the wrong site; port 0; an absurd Retry-After; the database's file modes; and what the reviews of the fixes found (the double restock, the throw after a clock step, the forwarded-host bypass, `ALLOWED_HOSTS` entries that never matched, a logout undone by a password change). **Still open:** one client keeping the owner from signing in through the global login throttle (high; needs the owner's ruling, see the auth review below); a steady cheaper store firing a "drop" against a cross-store reference (needs the owner); redirects not paced under their own host; the upstream connection held after an over-cap Content-Length; the exported network that dials any address; the outbox lease; the smaller items listed in each review's table.

**Never reviewed independently:** the matcher, price text and currency, the platform and structured-data readers, the scheduler, prices and verdicts, the web UI, the fixes to the fetch path made tonight, and the second round of fixes to the alerts and the Host check (their first round was reviewed, and found wanting). The orchestrator's own probes (about 120 inputs against the guard and the money code) are not a substitute.

#### Decisions made in the owner's place

Each is in the entry of the unit that made it. The ones most worth a look: the reference price reading (a listing's median over 30 days of in-stock reads, without its two newest); no repeat alert while one awaits delivery, and one per cooldown behind a failed push; delivery is at least once; tax not included with no amount never gives a landed total; *High* is 10% over the 90-day median; a price stops counting after 7 days; pacing's minimum gap of 2,125 ms; the wall back-off schedule; `empty` below 60 visible characters; a password of at least 15 characters; the scheduler's 20-second lease and the 60-second retry of every failed run; every boot writes a backup; the API answers only for an address, a local name or a name in `ALLOWED_HOSTS` (and `fritz.box` is not a local name); one restock event per out→in transition whatever the delivery state; a message sent more than an hour after its read words the price as a past read; a provider's Retry-After is honoured up to one day; at most 256 cookie jars and 4,000 cookies.

#### For whoever continues

1. Push, and let CI run: none of this has been built on Linux amd64 or by a clean install.
2. The owner's rulings the reviews ask for: the global login throttle (auth review, finding 2) and the cross-store reference (alert review, finding 3).
3. Independent reviews of the units that have had none, starting with the matcher, and of the fixes made tonight after the reviews.
4. Workstream 3 (the directory), then the directory comparison and the held-out matcher run.
5. The rest of workstream 8 (the UI): the uPlot chart, channel and password forms, editable settings, component tests, and a look at it by a person on a real phone.
6. The owner's approval of 20 listings on at least 10 hosts starts the 48-hour live check; an ntfy topic or webhook target is needed for a real delivery.
7. Isolated worktrees start from `origin/main`: until the push, a new subagent must `git merge main` first.

### 2026-11-25, 04:00 to 05:00: three more reviews, the minimal UI, and fixes

Five subagents ran in the last hour (the UI, the open alert findings, a review of auth, then reviews of the alert fixes and of the Host check), each told to merge local `main` first; the orchestrator fixed fetch and auth findings meanwhile. Final code tree `5e93b2d`: lint, typecheck, test and build exit 0; 3,916 tests in 182 files; 601 of 601 corpus cases, none edited.

#### Review 3: auth, sessions, CSRF, settings

A reviewer subagent, read-only, against the built server on loopback and the auth test harness.

| # | Severity | Finding | Reproduced | State |
|---|---|---|---|---|
| 1 | critical | Before the owner sets a password, any web page could take the install over through **DNS rebinding**: the CSRF rule compared Origin with an origin built from the request's own Host, and Host was never checked. `POST /api/auth/setup` with `Host` and `Origin` both `evil.example` answered 201 with a session, and the owner's own setup then answered 409 | yes, with spoofed headers against the built server; not in a browser | **fixed** (`09de739`): every `/api` request must name a host the server answers for (an IP address, `localhost`, a single-label name, a name under `.local`, `.lan`, `.home`, `.internal`, `.home.arpa`, or one listed in the `ALLOWED_HOSTS` environment variable). The reviewer's request replayed against the built server and the image: 403, password still unset. The plain LAN race (a device on the LAN reaching the wizard first) is unchanged; the reviewer's optional setup code printed to the log is not built |
| 2 | high | One client can keep the owner from signing in for as long as it runs: the global throttle key is never reset by a success and locks for up to 15 minutes. One wrong guess per window: the owner succeeded 0 times in 96 tries over 24 simulated hours. Existing sessions are not affected | yes, on a fake clock | **open**, on purpose: the fix trades the owner's access against the rate of guessing across many addresses, which is the owner's call. The reviewer's options: let the global key add delay but never refuse; or cap its lock far below the per-client 15 minutes. With finding 1 fixed, a page in the owner's browser can no longer drive it; a device on the LAN still can, and with `auth.trustProxy` on and the server also reachable directly, a client rotating `X-Forwarded-For` can |
| 3 | medium | Reads had no origin check: with the owner's cookie, a GET naming another origin (`chrome-extension://…`, `Sec-Fetch-Site: cross-site`) answered 200 with settings and channels | server side yes; the browser side (an extension with host permission) from reading only | **fixed** (`09de739`): a request that says it comes from another site is refused on every method; the always-open routes are exempt |
| 4 | low | Changing the password kept the session token it was made with | yes | **fixed** (`849c72a`): every session ends and the answer carries a new one. Two existing tests asserted the old token kept working and were changed |
| 5 | low | With `auth.trustProxy`, the rightmost `X-Forwarded-For` but the leftmost `X-Forwarded-Proto` and `-Host` are read | reading only | open |
| 6 | low | A webhook URL with its secret in the path, and an ntfy topic, are stored in plain text and returned by `GET /api/channels` | reading only | open |
| 7 | low | The database and its backups are created world-readable (0644); only the key file is 0600 | observed | **fixed** (`35f52e8`): the database, its WAL files and backups are 0600, and a directory the server creates is 0700 (an existing directory keeps its mode). Checked on a fresh start of the built server |
| 8 | low | `/api/health` gives the version, RSS, rungs and job names to anyone | observed | open; it is what the health contract says |
| 9 | low | Setup hashes with no limit on how many run at once until a password exists (19 MiB each) | reading only | open |

Examined and found sound by the reviewer: path tricks against the allow-list (trailing and double slashes, case, percent-encoding, `..` forms, HEAD, OPTIONS, TRACE, a made-up method, `X-HTTP-Method-Override`: all 401, nothing leaked); the static fallback against traversal; the CSRF matrix for state-changing requests; four concurrent setups giving one 201; token form, logout, duplicate cookies; settings keys such as `__proto__`, oversized and malformed bodies; the PHC parser's bounds; the secrets envelope and its key file. Not covered: a real rebinding run in a browser; whether a query error's parameters can reach the log; the cost of a tampered stored hash at the memory bound.

**About the Host rule (orchestrator's decision, the owner may overrule).** A name not on the list above gets 403 from the API until it is put in `ALLOWED_HOSTS`: an owner who reaches the box through a domain of their own or a tailnet name must set it (the README says so). It is an environment variable, not a setting, so nothing reachable over the API can widen it. With `auth.trustProxy` on, the host judged is the forwarded one.

#### Review 4: the alert fixes made tonight (reviewer subagent, read-only, 04:22 to 04:29)

| # | Severity | Finding | Reproduced | State |
|---|---|---|---|---|
| 1 | critical | The restock fix could record **one out→in moment twice**: its watermark was the time of the observation the newest event names, which is older than the decision when that decision covered a second listing that came back later. X and Y out; X in and the process dies before its evaluation; Y in → one event naming X; Y read again → a second event | yes | **fixed** (`75eacb2`): the watermark is the event's decision time (the later of the observation it names and the event's own time); the reviewer's sequence written failing first. The same shape without a crash (X unconfirmed or its store blocked when read, counted as back later) was argued from reading and is not tested |
| 2 | high | After the clock steps back, a watch with two or more listings **threw on every read** until real time caught up (another listing's read lay after "now" and the pure rule refuses that), and the restock was lost meanwhile. Mostly older than tonight's fixes | yes | **fixed** (`75eacb2`): an evaluation's now is never before the newest read of any tracked listing; the reviewer's sequence written failing first |
| 3 | low | With alerts accepted out of order, the cooldown runs from the acceptance of the newest decision, which can be hours before the last push the user received | reading only | open |
| 4 | low | A read whose time is ahead of the send time (after a clock step) is worded as current | reading only | open |

Found sound by the reviewer, by running: two listings restocking an hour apart (2 events) and on consecutive reads (2 events, none after); a first sighting in stock after another listing's event (none); out, failed, in (no event on the failed read, then one); in, failed, in, in (none). Not reached: three alerts accepted in the order 3, 1, 2; the newest decision failed for good; target and drop alerts mixed; a restock event whose observation was pruned (`lastAcceptedAlert` inner-joins the observation, so such an event drops out of "last accepted"); the restock rule switched off and on; the reference change of `d9144f6` beyond a skim. The reviewer's test runs were refused by the session's permission classifier near the end, so two follow-up runs did not happen.

#### Review 5: the Host check, the cross-site refusal and the session rotation (reviewer subagent, read-only, 04:22 to 04:31)

Against three built servers on loopback. The reviewer found no way to claim an install or read private data without a session; every rebinding variant sent was refused.

| # | Severity | Finding | Reproduced | State |
|---|---|---|---|---|
| 1 | medium | With `auth.trustProxy` on, a client that reaches the server directly passed the Host check by sending `X-Forwarded-Host` itself (`GET /api/setup` under `Host: evil.example` answered 200). The Origin rule still refused the claim, so only the routes open without a session were readable | yes | **fixed** (`5e93b2d`): the request's own host and the forwarded one are both judged. The reviewer's request replayed on the built server: 403 |
| 2 | low-medium | `ALLOWED_HOSTS` entries with a port (`name:8443`), a `*.` wildcard or a Unicode name never matched, silently | yes | **fixed** (`5e93b2d`): entries are read as written, and those that are not host names are named in a warning at start-up |
| 3 | low-medium | Names outside the built-in list that worked before now get 403 (`nas.fritz.box`, `nas.localdomain`, `dasher.test`, a tailnet name), and `docker compose` gave no way to pass `ALLOWED_HOSTS` | yes | **fixed in part** (`5e93b2d`): compose passes the variable; `.test` and `.localdomain` are answered; the 403 names the refused host. `fritz.box` is **not** on the list, on purpose: `.box` is a public top-level domain, so the name can be carried by the public DNS; a FRITZ!Box owner lists `.fritz.box` |
| 4 | low | A password change racing a logout of the same session issued a new session after the logout had succeeded | yes | **fixed** (`5e93b2d`): the password changes and nobody is signed in |

Found sound by the reviewer: the refused and accepted host spellings (trailing dots, case, numeric IPv4 forms, mapped IPv6, user-info, bad ports, a missing Host); the absolute-form request target and a duplicated Host, which the check and the origin read the same way; every forwarded-header combination tried (none makes the own origin equal a hostile Origin while the judged host is allowed); Node's `fetch` as the Docker healthcheck uses it; the rotated cookie's attributes and the transaction around the rotation. Not done: a real browser (Safari's headers on a same-origin GET, service workers, prefetch); long-lived streams across a password change.

#### The alert review's open findings (subagent, `phase1/alert-fixes`)

Findings 5, 6, 8 and 7 of the second review, one commit each, each with its reproduction written failing first; states are in that review's table below. Existing tests changed: one sweep test now expects the rule's own silence (`already_told`) where the removed hold answered `awaiting_delivery`; two exact-body outbox tests gain the "Read at" line and `alert.observedAt`. Spec S§5.8 and S§5.11 say the new rules. Nothing was run against a real channel.

#### The fetch review's findings 3, 5 and 7, and a Retry-After bound (orchestrator)

States are in the first review's table below. The cookie caps are the orchestrator's numbers (256 jars, 4,000 cookies, least recently used first); the reviewer's 2.5 GB heap figure was not measured again. A provider's Retry-After over one day is treated as one day (the bound is the orchestrator's; no corpus case says otherwise).

#### P1-8b, cut down: the minimal web UI (subagent, `phase1/ui`)

`apps/web`: the gate (setup with the 15-character rule, sign-in with plain messages for a wrong password and for a throttle, log out, back to sign-in on any 401), the market step (no currency pre-selected), watches (paste box, list with lookup state and last alerts), watch detail (each listing's price with its freshness, availability, condition, errors; pause, archive, the rules, exclude, track, wrong match, "Check now"), history as an inline SVG line with the deal verdict, the alerts feed, and read-only Settings and Diagnostics. No new dependency; strings in one module. Built JS 251 kB, **77.7 kB gzipped** (budget 200 kB first load, S§5.12).

Amounts are shown from integer minor units with their currency through `Intl`, given a decimal string; a typed target is turned into minor units by string handling and refused when it cannot be read exactly. Store text is rendered as text; a link is made only from an `http(s)` URL.

**Seen rendered** by the orchestrator in a headless Chromium at 390 px wide, light and dark, against the built server, n = 2 walks: an empty install (setup, a refused currency, an empty list, a link watch on a host that never resolves, a name watch that fails for want of the directory, a refused sign-in), and a database seeded through the sweep's own harness with 80 scripted reads over 20 days on two listings (79 observations and one failed read) (a drop from 249.99 to 219.99 CAD confirmed on its second read, one restock): the list showed the reference and both last alerts, the detail showed both prices as current, the line and "good price · 19 days of history", the feed showed both alerts. No console error, no horizontal overflow on any screen. One defect found and fixed (`1419e59`): the Diagnostics tables had no column headers, so a next run read as a completion in the future.

**Not verified:** a person using it on a real phone; any real store's data in it; the 429 path; there are no component tests (the money helpers have 8). Known gaps the subagent reported: the name-watch failure arrives as prose, not a code, so the UI infers it from the watch kind; before a watch's first read it has no currency, so a typed target is written in the market's currency (the server flags a later mismatch); the deal verdict, channel and job shapes are not in `packages/shared`, so the UI declares its own partial types; the feed shows the listing link twice and words a price as "Now".

### 2026-11-25: Two independent reviews, and what they found

Two reviewer subagents, each given the code and the spec and asked to find and reproduce defects, read-only. They are the first independent reviews of Phase 1. **They found defects that the units' own tests and the orchestrator's reading did not, three of them critical for alerts.** Still unreviewed: the matcher, the price-text and currency code, the readers, the scheduler, prices and verdicts, auth and settings.

**Treat drop and restock alerts from this build with care.** Of the second review's findings below, 2, 5, 6, 7 and 8 are fixed, 4 partly, 1 is bounded by a stop-gap, and 3 is open and needs the owner. Every one of those changes was made in the last hours of the run and has had no review itself. Spec S§5.8 says the new reading of a listing's recent price.

#### Review 1: the fetch path (guard, pinned transport, fetchPage, cookies, fetcher, walls scanner)

| # | Severity | Finding | Reproduced | State |
|---|---|---|---|---|
| 1 | critical | A redirect or a name could reach this machine itself and devices on its LAN at their **global IPv6 addresses** (and a server at its public IPv4 address): the guard refused the IANA special-purpose ranges and knew nothing of the host's own addresses. Every global address of this Mac's interfaces passed `checkDestination` | yes, as guard verdicts; no connection made | **fixed** (`8e7aca5`): an address on one of the machine's own networks is refused as `private_address` at every hop |
| 2 | medium | A redirect to another host is not paced or robots-checked under that host, and its outcome is recorded in the playbook against the first host. Five URLs redirecting to one host produced five simultaneous requests to it | yes | open |
| 3 | medium | Cookie jars grow without bound and a page chooses the hosts: no cap on the number of jars, expired cookies purged only when that jar is read again. 2,000 hosts × 300 cookies grew the heap by about 2.5 GB | in parts | **fixed** (`9d5c5c4`): at most 256 jars and 4,000 cookies across them, the least recently used jar dropped first (two tests, seen failing without the change). The heap was not measured again |
| 4 | low-medium | When Content-Length is over the cap, the upstream connection and the proxy ticket stay open until the request's deadline (5 s in the script), while the host's pacing turn is already released | yes | open |
| 5 | low | The session drop can clear the wrong site: `CookieJars.forget` has no public-suffix guard (a wall on `www.myshopify.com` emptied every `*.myshopify.com` jar); and the runtime drops by the requested URL, not the final one | first case yes | **fixed** (`9d5c5c4`, `7f127ed`): forgetting a site that is a public suffix under the scanner's rule clears its own hosts only, a parent-domain cookie on a public suffix is left alone, and a wall forgets both the site asked and the site that answered. The suffix rule is the small in-house one, not the public suffix list |
| 6 | low | The exported network dials any address it is handed; only convention keeps callers on `guardedFetch` | reading only | open |
| 7 | low | Port 0 passes the guard and then fails as a transport error | reading only | **fixed** (`2b326ff`): refused as `url_form`, in a URL and in a redirect |

Examined and found sound by the reviewer: the special-purpose address table against 20-odd spellings (hex, octal, short and full-width IPv4, mapped, NAT64, 6to4, Teredo, zone ids, `localhost` forms); the URL-form and Location checks; the pinning proxy (wrong secret, ticket reuse, two concurrent CONNECTs, another host, an expired ticket: all refused; it listens on loopback only and never resolves a name); impit always going through the proxy even with `NO_PROXY=*`, returning a 302 unfollowed and ignoring an Alt-Svc h3 header; the body cap applied to decompressed bytes (1 GiB gzip and brotli bombs refused after about 90 ms); the wall scanner on 17 hostile 6 MiB inputs (at most 327 ms). Not covered: whether any code outside `packages/fetch` reaches the network without the guard; HTTPS through the proxy against a real TLS server; `robots/parse.ts`; the full wall rule set.

About the fix: the own-network list comes from `os.networkInterfaces()`, read for every hop. A link prefix shorter than /16 (IPv4) or /48 (IPv6) is ignored and only the interface's own address refused, so a tunnel that states /0 does not refuse the internet. **Inside a container the process sees the container's interfaces, not the host's**, so on a host with IPv6 enabled for Docker the host's LAN prefix is not known to it; with Docker's default IPv4-only networking the container has no IPv6 route. The reviewer's second half of the fix, binding the server to loopback unless `HOST` is set, is **not done**.

#### Review 2: the sweep, the alert rules, prices, the outbox and gating, the watch service

Reproductions used the sweep's own harness: a real SQLite file, `checkListing` with scripted reads 30 minutes apart, delivery rows set by SQL. H is 100.00 CAD, L is 90.00 CAD, the rule the default 5% drop.

| # | Severity | Finding | Reproduced | State |
|---|---|---|---|---|
| 1 | critical | A push channel that has failed for good (a 401, say) turns one drop or restock into **a new alert on every read**: the failed push means the in-app acceptance never counts, so there is no cooldown, and the "awaiting delivery" hold does not apply to `undelivered`. 20 reads at H then L ten times: 9 events for one unchanged price. A restock: 5 events | yes | **bounded** the same night, not settled: while the previous alert of that kind is `undelivered`, a repeat that is not a lower price is held for the watch's cooldown counted from that event (three tests; the reviewer's sequence now gives 1 event). Nothing is stamped, and the alert still counts as undelivered. This is the orchestrator's stop-gap and touches the owner's ruling that in-app acceptance alone does not count: with a broken push channel the user now gets one in-app alert per cooldown for an unchanged drop. A restock in that state is held the same way |
| 2 | critical | **Out-of-stock reads feed the reference**, so a price that never changed fires a drop: H×3 in stock, six out-of-stock reads carrying 200.00, H×2 in stock → one `price_drop` event against a reference of 200.00. S§5.8 says only in-stock reads are compared | yes | **fixed** the same night: a listing's recent price takes in-stock reads only (two tests from the reviewer's sequences, written failing) |
| 3 | high | Two stores at steady, different prices: the cheaper fires "price drop" on its second read, because the reference is the median across listings while noise and confirmation are per listing. It follows the spec's words | yes | open; needs the owner |
| 4 | critical | **A new watch cannot alert on a drop of any size until it has about three earlier reads**, and on any watch the reference follows a drop down once low reads outnumber high ones in the window: the read being evaluated is inside its own reference median and inside the MAD window. H then L×6: no event; H then 50.00×6: no event | yes | **partly fixed** the same night: a listing's recent price leaves out its two newest reads, so H, L, L now fires once on the confirming read and the reference holds while a drop is read and confirmed (three tests written failing, two more for a recovery and a steady price). Still open: the pure rule's MAD window includes the low reads, so with exactly two baseline reads (H, H, L, L) the drop is "within noise" until the third low read; and a drop that lasts still pulls the reference down over the following weeks |
| 5 | high | An older alert accepted late becomes "the last accepted" (ordered by acceptance time, not decision order), so a higher price passes as a further drop inside the cooldown: alerts at 90.00, 80.00, then 85.00 | yes | **fixed** (`aa753be`): the last accepted alert is the newest accepted decision, by event order; its own acceptance starts the cooldown |
| 6 | high | A restock held while a push is pending is lost for ever and never written to the feed: a second out→in while the first alert awaits delivery is held, and after acceptance the watermark is past it. Against S§2 invariant 11 | yes | **fixed** (`034a23c`): one event per out→in transition whatever the delivery state; the watermark is the later of the last acceptance and the observation the watch's newest restock event names. Left open by the fix's author: an acceptance that lands between a new transition's observation and its evaluation (a crash resumed after the acceptance) can still hide that transition |
| 7 | high | A push delivered late says "Now 90.00" for a price read days ago, also for a watch archived since: the message carries no observation time and the outbox has no age limit | reading only | **fixed** (`b10f1d5`) for pushes: every message states when the price was read, and one sent more than an hour after the read words it as a past read; the webhook body gains `alert.observedAt`. Nothing is dropped. The in-app feed still says "Now", with the read time on the next line |
| 8 | medium | After a crash following the observation insert, if the clock also stepped back, that observation is never evaluated (the resume test compares timestamps strictly) | yes | **fixed** (`67778ea`): a read's time is strictly after the listing's last read time, so the resume test is exact. A row written by the old code in that state is still not resumed |
| 9 | low | The outbox lease is sized for one delivery, and a pass sends a channel's queue under one lease | reading only | open |
| 10 | low | `/listings/:id` has no profile filter (harmless with one profile); a webhook URL with its token in the path is stored in `config_json` and returned; two spellings of a link (`www.`, http and https, a trailing slash) make two watches; two concurrent creates of one watch give a 500; a Retry-After of about 10^14 s throws | reading only | the Retry-After item **fixed** (`b781fd5`: honoured up to one day); the rest open. The webhook URL item is also the auth review's finding 6 |

Examined and found sound by the reviewer: a failed read between two low reads confirms nothing; two currencies are never compared and no float is on the decision path; event keys make re-evaluation add nothing; parked deliveries; the lease-conditional delivery writes; secrets never in an error; archived and paused watches, blocked stores and unconfirmed listings never alert; save-first ordering.

**What this says about the night's method.** Findings 2 and 4 of the second review are in the code that joins the pure rules to the rows (`sweep/evaluate.ts`), which no corpus case covers: the corpus pins each pure decision, and every one of its 601 cases passes. Finding 4 comes from a reading the sweep unit chose itself to fix a different problem (a single-listing watch whose reference equalled the latest price), and the orchestrator accepted it on the unit's report. The orchestrator's integration test passed because it started with six baseline reads.

**Worktrees.** Both reviewers found their isolated worktree at the Phase 0 commit `90c6d2d`, not at local `main`: a new worktree starts from the remote's `main`, which the night's commits are ahead of. The first read the main checkout in place; the second moved its worktree to `main` and back. Neither changed the repository. The implementation units were told to `git merge main` first, which is why they were not affected.

### 2026-11-25: Auth and settings (P1-8a), the server starts the runtime, and the first real read

All on local `main`, checked there (lint, typecheck, test, build exit 0). **Auth is a high-risk area and has had no independent review.**

**P1-8a, owner auth, settings and the route assembly** (`667762d`). `apps/server/src/auth`, `src/settings`, `app.ts`, `index.ts`; shared schemas `auth.ts`, `settings.ts`. The unit's run stalled at 00:41 on the usage limit and was restarted at 03:39.

- *Protected by default.* The guard runs first on every `/api/*` request, and `OPEN_ROUTES` in `auth/guard.ts` is the only place a route can be opened: `/api/health`, `/api/auth/status`, `/api/auth/setup` (409 for ever once a password exists), `/api/auth/login`, and `/api/setup` until a password exists. A test walks the assembled route table and requires every other route to answer 401 without a session. The author could not run a mutation check of the guard (the edit was refused by the session's permission classifier), so that test has not been shown to fail when the guard is weakened.
- *Password.* argon2id, m = 19,456 KiB, t = 2, p = 1 (OWASP's first recommendation), stored as a PHC string in `owner_password`; Node's argon2id checked against the RFC 9106 test vector. One hash took 14.8 ms and one verify 13.6 ms on this machine (the author's measurement, n = 1). At least 15 characters, at most 256.
- *Session.* A 32-byte random token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored. Idle window 14 days, sliding, capped at 90 days. `Secure` follows `auth.cookieSecure` (`auto`: set when the request came over HTTPS).
- *Login throttle.* Per client address (an IPv6 /64) 5 free failures, then a lockout of 1 s doubling to 15 min; globally 20 free failures. The client address is the socket's unless `auth.trustProxy` is set.
- *CSRF.* Every request that is not GET, HEAD or OPTIONS needs a same-origin `Origin` (or, without one, `Sec-Fetch-Site` of `same-origin` or `none`) and a JSON content type or an `X-Requested-With` header. No CORS headers are sent.
- *Settings.* A registry of typed definitions; a value comes from the database, else the environment, else the default, and the API says which. Defined: `market.country`, `market.currency`, `market.language` (**no default**: absent until the user chooses), `fetch.robots` (default `ignore`), `auth.cookieSecure`, `auth.trustProxy`. A secret setting is stored encrypted and never returned.

**The server starts the runtime** (`a7c8d68`, by the orchestrator). `index.ts` builds `createRuntime` with the `watch-lookup` job, starts it once the port listens and stops it before the database closes. `POST /api/refresh` triggers the sweep. `/api/health` now reports the fetch rungs and, per job, the last and next run and the skipped runs (S§5.8); the shared `HealthResponse` gained `rungs` and `jobs`.

**First real read through the whole stack**, in a container built from `a7c8d68` on a fresh volume (n = 1 listing, 1 host, 1 request):

| Step | Result |
|---|---|
| Password set, market set to CA / CAD / en-CA through the API | 201, then 200 three times |
| `POST /api/watches` with a Canada Computers product link carrying a `utm_source` parameter | 201; the parameter was stripped; the lookup was `done` at once |
| The sweep triggered by the new watch | One read 1.6 s after the watch was created: sticker and effective price CAD 874.99, in stock, condition `new`, freshness `current`; the watch adopted CAD and a reference of 874.99; next check 30 minutes later |
| Sweep job detail | `checked: 1`, `outcomes.read: 1` |

The page was read by the structured-data ladder on the `http` rung, through the guard, the pinned transport, pacing and the wall classifier. The host is one the Phase 0 transport lab read on 2026-11-18.

**Found by that read and fixed the same night:** the listing's title was still the placeholder (its URL) after the read. The sweep adopted a title only when the stored one was empty, and the lookup stores the URL as the placeholder. It now replaces a placeholder with the title the store states and keeps a title an earlier read gave (three tests, the first written failing). The fix has not been re-run against the real page.

### 2026-11-25: Watch intake, the watch service and its routes (P1-6c-a)

Squash-merged into local `main` as `e021a71` and checked there (lint, typecheck, test, build exit 0). **No independent review yet.**

**Gate: "the ported fixtures all pass".** `node evals/corpus/count.ts` on the merged tree: **601 cases, 601 implemented, 0 pending**, with `pnpm test` exit 0. No case, expectation or contract was edited by any Phase 1 unit; each unit was told to report a case it believed wrong rather than change it, and none reported one.

`packages/core/src/watches` (the pure intake decision, area watch-intake 23), `packages/shared/src/watch-api.ts` (the API and `rules_json` schemas), `apps/server/src/watches` (`createWatchService`, `watchLookupJob`, `createWatchRoutes`). 43 server tests. **The routes are not mounted and the job is not registered yet.**

- *Save first.* `create` commits the watch row, then the lookup runs. The tests read through a second SQLite connection, which sees only committed rows, and show the row exists when `discover` and `onListingsDue` are first called.
- *A pasted link needs no network to become a watch:* the lookup writes the store (`source` `pasted`, `trust_tier` `unverified`, platform and currency `unknown`), the listing (condition and currency `unknown`, a placeholder title until the first read), the link (`tracked`, added by `user`) and the `listing_check` row due now. Two watches on one link share one listing and one check.
- *A name* needs a discovery source, which is the store directory (not built). With none bound the lookup ends `failed` with `NO_DISCOVERY_SOURCE`. With scripted candidates, only what tiers 1-2 call `exact` is tracked; the rest are linked as candidates.
- *Money in `rules_json`:* `{ targetPrice: Money | null, dropBasisPoints, restock }`, so a target carries its currency. Once the watch has adopted a currency, a target or reference in another is refused (409); one saved earlier that turns out to differ is flagged and never compared. Spec S§4.2 now says this.
- *Routes:* watches (create, list, read, change, archive), per-listing exclude / track / wrong-match, listing view with the deal verdict, history, `POST /refresh` (202, joins a running sweep), the in-app feed, Diagnostics (jobs, fetch playbook).

Decisions the unit made, which the owner may overrule: creating a watch is refused until the market is set; "wrong match" writes a person's verdict of `other_model`, since the vocabulary has no "not this product"; a name's dedupe key is lower-cased, not Unicode case-folded.

Not built: peer prices for the cross-store verdict tier (it always reports `no_peers`); automatic re-queueing of a failed name lookup. Not verified: the routes through the typed client; real store-search candidates; the regional rewrite on real directory data. One run of the full suite failed once in `packages/fetch/test/transport/resolver.test.ts` ("gives up at the deadline") while a build was running, and passed alone three times and in the final run: a timing flake under load, not fixed.

### 2026-11-25: The sweep engine and the runtime (P1-6c-b, runtime)

Both are on local `main`, checked there (lint, typecheck, test, build exit 0). **No independent review yet.** The session reached its usage limit at about 00:55 and nothing ran until 03:20; the sweep unit was resumed from its saved state.

**P1-6c-b, the sweep engine** (`406099e`). `apps/server/src/sweep`: `checkListing`, `sweepJob` / `runSweep`, `listingState`, `watchState`. 31 tests on a real SQLite file with scripted reads; the author's two mutations (dropping the failed-read marker, skipping the outlier hold) each failed a test. One end-to-end test goes through the real `readListing` on a saved JSON-LD page. **No real store has been read through this path.**

- *One event per decision.* Each watch is evaluated in its own `BEGIN IMMEDIATE` transaction, and the event is recorded under `alertEventKey(kind, watch, observation)`, so evaluating an observation again adds nothing.
- *A crash between the observation insert and the evaluation.* `listing_check` is written last; on the next check an observation newer than `last_read_at` is evaluated first. A test crashes there, restarts and gets exactly one event.
- *A failed read* writes no observation, raises the error count, sets the cause and logs one record with its candidates. `no_price`, `unreadable_price`, `variant_not_found`, `converted_currency` and `no_structured_data` are all stored as cause `no_price`; the exact reason is in the log record only.
- *Who may alert.* A person's `exact` verdict; else a link the user added; else an effective cached `exact` verdict. A person's other verdict means never. A `blocked` store never alerts.

Decisions the unit made, which the owner may overrule. The first two changed spec S§5.8:

- **The reference is the median of each listing's recent price, where a listing's recent price is the median of its own reads over 30 days.** P1-6a had read "recent prices" as each listing's latest price; with that reading a watch on one listing has a reference equal to the price just read, and a drop could never fire. The cost of the new reading: a drop that lasts pulls the reference down with it over the following weeks.
- **No repeat alert while the last one of that kind is still awaiting delivery**, except for a lower price. Without it a failing push channel would collect one event per read. This is a hold, not a cooldown stamp.
- Consecutive failed reads back off to 30 min, 1 h, 2 h, 4 h, then 6 h. A closed host is deferred and is not counted as a failure of the listing.
- A read in another currency than the listing's adopted one is stored and logged, never compared, and never changes the listing's or the watch's currency.
- Per check: a 45 s deadline and at most 8 requests. Per sweep: 8 checks at once, 200 listings, a 10-minute deadline.

Where the merged pieces did not fit, worked around locally: `chooseReferencePrice` wants a product id and a watch has none; the listing fingerprint's store form (id or host) is not settled; a `rate_limited` outcome gives the Retry-After delay but not the time it was measured from. Wanted in the schema, not done: `watch.product_id`; an evaluated-up-to marker on `listing_check`; a read-attempt log for the live check's error rates.

Not verified: two processes sweeping one database; confirmation through a cached `match_verdict` row (only the user-added path is tested).

**The runtime** (`f7f07a1`, by the orchestrator). `createRuntime` in `apps/server/src/runtime.ts` builds the process's one fetcher (the guard, the wall classifier as its `classify`, pacing and the playbook on SQLite, and the HTTP rung's session drop: a walled answer clears that site's cookies) and the scheduler with the sweep, outbox and backup jobs. **The server does not start it yet**; that waits for the route assembly of P1-8a.

One integration test, on a fake clock and a real SQLite file with scripted reads (n = 1 scenario): the scheduler's sweep reads a watched listing nine times at the default 30-minute interval (six at 100.00, three at 90.00); exactly one `price_drop` event is recorded, naming the read that confirmed the drop; the outbox job accepts its in-app delivery. Two smaller tests: the three jobs are registered and the boot catch-up writes one backup; with no market set nothing is read, and a second refresh joins the running sweep.

Seen while writing it, not changed: **every boot runs a backup** (boot schedules a catch-up of every job), so an install that restarts often rotates its seven kept copies quickly.

### 2026-11-25: The orchestrator's probes of the guard and the money code

**Not an independent review.** The reviews of the high-risk units are still owed; no reviewer subagent has run, because the run was held to three agents and every slot went to building. These are the orchestrator's own probes of the merged code with inputs that are not in the corpus, run once from throwaway scripts.

| Probed | Inputs | Result |
|---|--:|---|
| `checkDestination` on URL spellings (decimal, hex, octal and short IPv4, IPv4-mapped and NAT64 forms, full-width digits, the ideographic full stop, user-info tricks, a backslash, other schemes, metadata addresses, `localhost` names) | 47 | Every private, loopback, link-local, CGNAT and metadata form refused; public literals pass; NAT64 of a public address passes and of a private one is refused |
| `checkDestination` on DNS answers (mixed public and private, mapped and NAT64 private, empty, garbage, a zone id, a short form, CGNAT, benchmarking, multicast, broadcast, unique-local) | 14 | A mixed answer refuses the name; only the two all-public answers pass |
| `guardedExchange`: a name that resolves public on the first hop and private on the second; a redirect to the metadata address | 2 | Both refused as `private_address`; only the first hop was dialled |
| `parsePriceText` (separators by locale, zero- and three-decimal currencies, ranges, instalments, marks of another currency, full-width and Arabic-Indic digits, amounts at and past 2^53 − 1) | 41 | No wrong amount. 2^53 − 1 minor units reads exactly and one more is refused |
| `derivePrices` | 6 | A coupon and a member price leave the effective price alone; estimated shipping or an unknown tax flag gives no landed total; a discount above the sticker is refused |
| `evaluatePriceAlert` (the threshold at exactly 5% and one minor unit short, a single read, amounts near 2^53, a noisy history, a failed read between two low reads) | 8 | As the rules say, with one finding |

**Finding, fixed the same night:** `evaluatePriceAlert` accepted an in-stock read with price 0 and fired on it (reference of 1 minor unit, price 0). The price-text rules and the platform readers refuse a zero price, so a reader should never produce one, but the alert rule did not refuse it itself. A zero read is now not comparable: it neither fires nor confirms (two new tests, written first and failing). One existing unit test asserted the old behaviour ("a drop to zero fires") and was changed with a comment saying so; no corpus case holds a zero price, and the alert-price-rules area still passes.

### 2026-11-25: The wall classifier (P1-1c)

Squash-merged into local `main` as `c4e61e0` and checked there (lint, typecheck, test, build exit 0). **No independent review yet.** Corpus after this merge: **601 cases, 578 implemented, 23 pending** (only watch-intake).

`packages/fetch/src/walls` (areas wall-classification 32, challenge-wait 22, walled-session-drop 9): `classifyPage`, `classifyResponse` (the `Classify` hook of `fetchPage`), `worthWaiting`, `statusAfterWait`, `planSessionDrop`, `dropsSession`, `sessionSite`. It is not passed to the fetcher yet; the final wiring does that.

- *No bare substrings.* A 404 or 410 is `not_found` whatever is on the page. Every rule except an explicit header or a vendor's own redirect path needs a block-shaped page (at most 2,000 visible characters and 256 KiB). Titles are matched whole. `cf-ray` and `server: cloudflare` name nothing, since they are on every proxied page.
- *`empty`* (the spec gave no threshold): a 2xx page with fewer than 60 visible characters in a document under 5,000 bytes, the Phase 0 browser lab's numbers. A large client-rendered shell is not empty, because a reader may still find its JSON-LD. Spec S§5.1 now says this.
- *Its own bounded HTML scanner, not parse5:* one forward pass, about 80 ms on a 6 MiB page (the author's measurement, n=1).

Against the Phase 0 lab's saved answers (read-only, uncommitted lab output; the labels are the lab's own reclassification, not a person's):

| Set | Result |
|---|---|
| Transport lab, 177 answers with saved bodies | Walls called readable: 0. Readable pages called walls: 0. 42 walls agree; 130 served pages are `ok`; 3 plain-text 451s are `network_error HTTP_451`; 2 that the lab called "forbidden" are bare-403 walls under the ruling |
| Route lab, 1,889 response views (snippet and title only, no body) | Wall on both sides: 8. Neither: 1,856. 25 that the lab called "forbidden" are bare-403 walls |

Decisions the unit made, which the owner may overrule: a 403 whose headers show a bot manager names that vendor (the "bare 403 names no vendor" ruling holds when there is no such header); a 401 with no wall evidence is not waited on; the session drop uses a rule for registrable domains, not a public suffix list (a miss clears less, never another site's session).

Open for the owner: Amazon's "continue shopping" page is a button, not a puzzle, so it is `challenge` and the browser rung would wait 20 s for something that never clears; a bare 403 on platform JSON (a disabled Magento GraphQL) is a wall under the ruling.

Not verified: the rules for Kasada, AWS WAF, Imperva, Sucuri, DDoS-Guard and the localised Cloudflare titles, which no saved page shows; the browser rung's evidence (Phase 6). Found in passing, in `cookies/jar.ts`: `CookieJars.forget(site)` also removes cookies set for a public-suffix parent, and the jar accepts `Domain=co.uk`; per-host jars keep the harm small.

### 2026-11-25: Prices, pacing and the backup job (P1-5a, P1-1d, P1-9b)

Each was squash-merged into local `main` and checked there (lint, typecheck, test, build exit 0). **No independent review yet.** The corpus is unchanged by these: 515 of 601 implemented.

**P1-5a, prices and verdicts** (`3ab1e8e`). `packages/core/src/prices`: `derivePrices`, `buildObservationRecord` (the record is checked against the shared `PriceObservation` schema before it is returned), `taxLabel`, `judgeDeal`, `toStreamVerdict`, `assessOutlier`, `confirmOutlierRead`. 190 tests; the author's 18 boundary mutations each failed tests. Spec S§5.5 was edited to say the following, all of them numbers or policies the unit chose where the spec was silent, which the owner may overrule:

- Estimated shipping is listed as missing, so only known shipping gives a landed total.
- Tax not included with no amount is listed as missing **in every country**. The orchestrator's brief had allowed a landed total in a tax-inclusive country; the unit departed from it on purpose, because an unknown must never become "included". The country default feeds only the label (`before_tax` for US and CA).
- No duty estimate is not listed (owner decision #10 makes none).
- A member price never lowers the effective price.
- Time-weighted median: each price weighted by the time it held inside the 90-day window; a price stops counting 7 days after its last read; out-of-stock time counts for nothing.
- *High* is 10% or more over that median, the mirror of *Good*.
- The outlier median leaves the candidate out; the listing count includes it.
- The share of 90 days is rounded up and "X% under" rounded down, so neither overstates a deal.

Not verified: the records against a real SQLite insert. The stream's verdict block cannot say why a tier was not judged.

**P1-1d, pacing, playbook, robots and the composed fetcher** (`5e979ae`). `createFetcher` and `bindReaderGet` in `packages/fetch`: robots → playbook gate → pacing → budget → `fetchPage` (which holds the guard) → playbook update.

| Scenario (fake clock, no real traffic) | What the test asserts |
|---|---|
| 50 concurrent requests to one host, 700 ms each | Starts in arrival order, at most 1 in flight, every gap between 2,125 and 3,250 ms |
| 14 hosts at once, 1 s each | 12 start at once, the other two 1,000 ms later |
| Failed DNS lookup; guard refusal | The host's slot is not used up |
| Restart on the same SQLite file | The first request waits exactly until the stored time |

- *Pacing.* The gap is 2.5 s × a jitter of 0.85 to 1.3, read literally: at least 2,125 ms (the Phase 0 lab floored it at 2.5 s). A 429 without Retry-After closes the host for 60 s; no pause exceeds 1 h, and a stored time further ahead (a clock that jumped) is cut to that.
- *Playbook.* Only `ok`, `wall` and `empty` change it. Back-off after consecutive negative verdicts on one rung: 5 min, 15 min, 1 h, 3 h, then 6 h. A rung still backing off is refused as `host_limit` without a request.
- *robots.txt.* `ignore` never fetches it. Under `respect`: 4xx is allow-all, 429 and 5xx disallow-all for 15 minutes, an HTML page or a challenge gives no verdict. A network error on robots.txt ends the request with that error and is not cached; RFC 9309 would record "disallow all", which after a laptop wakes offline would refuse every host as `robots` for a while.
- *Spec.* S§5.1: the back-off schedule, what a "start" is, the robots mapping.
- *Open.* One `host_access` row per host and page kind means the last outcome wins across rungs, which Phase 6 will have to change. A redirect to another host is paced under the first host only. "One in flight" holds per process.

**P1-9b, backups** (`642d679`, by the orchestrator). `runBackup` and `backupJob` in `apps/server/src/ops`: `VACUUM INTO` under a `.partial` name, renamed when complete, seven copies kept; `docs/restore.md`. Not wired into start-up yet. **The restore steps in the document have not been run against a container.**

### 2026-11-25: Alert rules and the outbox (P1-6a, P1-7)

Two more units, each built by a subagent, read by the orchestrator, squash-merged into local `main` and checked there (lint, typecheck, test, build exit 0). **Neither has had its independent review yet.** Corpus after these merges: **601 cases, 515 implemented, 86 pending** (the pending areas are wall-classification, challenge-wait, walled-session-drop and watch-intake).

**P1-6a, alert rules as pure decisions** (`5f98cc8`; areas alert-price-rules 38, alert-restock 15, alert-delivery-gating 11, reference-price 21, stale-read 10). `packages/core/src/alerts`: `evaluatePriceAlert`, `evaluateRestock`, `gateOnDelivery`, `chooseReferencePrice`, `applyRead`, `showWatchPrice`. Arithmetic is exact (BigInt, comparisons by cross-multiplication). The author's two mutations (a strict user threshold; B / 100 rounded half up) each failed tests.

Readings the unit chose where the contracts left them open, which the owner may overrule:

- "Same read path" is the read method plus the rung, for the confirmation and for the MAD window.
- The MAD is raw, and its window is every comparable read the caller passes on that path, the evaluated read included. How far back the history goes is the caller's choice.
- The reference is the median of each eligible listing's **latest** price; the spec says "recent prices".
- A sold-out listing's last price still counts in the reference. The spec does not say.
- A target, reference or last alert in another currency than the read's is never compared.

**P1-7, the outbox and delivery v1** (`ed384b0`; area notify-retry 33). The retry decision is pure, in `packages/core/src/notify`. In `apps/server/src/notify`: `recordEvent`, `runOutboxPass` and `outboxJob`, the in-app, ntfy and webhook adapters, the gating read model (`lastAcceptedAlert`, `gatingDeliveries`, `deliveryStatus`), the channel service and its routes (not mounted yet). In `apps/server/src/secrets`: AES-256-GCM in a versioned envelope, the key from `SECRET_KEY` or a key file created with mode 0600 in the data directory.

- *Delivery is at least once, not exactly once.* A pass claims due deliveries under a 10-minute lease; `accepted` is written only after a 2xx (or for in-app). A crash between a successful send and its UPDATE sends the message again when the lease expires. The webhook carries an `Idempotency-Key`; ntfy has nothing like it.
- *Removed and disabled channels* (the open item of migration 0002): their pending deliveries are parked at a sentinel `next_attempt_at` of year 9999, never claimed and left out of gating, so an alert does not wait for ever on a channel that is gone. Re-enabling a channel does not resend the parked backlog.
- *Gating.* On an install with no push channel the in-app acceptance counts. With a push channel, only a push acceptance counts; a push that failed for good leaves the alert `undelivered`, and the in-app acceptance does not stand in for it.
- *Channel requests* use the platform `fetch` with a deadline and no redirects, not the shop-fetch guard: a channel target is set by the owner and is often on the LAN. Targets come only from `config_json`, which only the channel service writes.
- *Messages* are built by code from the event's records: the observation's effective price and sticker, the store host, the listing URL. The watch's reference price is left out, because it can change before a retry.

Scripted tests, on a real SQLite file and local HTTP servers. These are not the Phase 1 freeze gate, which pauses a real container:

| Scenario | What the test asserts |
|---|---|
| 503, then 200 | Two requests, one accepted body, `attempts` 2, one wait of 2,000 ms; a second pass sends nothing |
| 429 with Retry-After 7, then 200 | One wait of 7,000 ms, one accepted message |
| 401 | Failed after one request, no retry an hour later |
| The same event key twice, repeated passes | One event, one request |
| Three passes at once, two connections | Three events sent once each |
| Restart | A pending delivery survives close and reopen and is delivered once |
| Crash while the server accepts | Pending with no acceptance after reopen; sent again after the lease: the same body accepted twice |

Not verified: a real ntfy server (local fake only, by design); the path where the table refuses a duplicate event key under a race (read, not triggered). Wanted in the schema, not done: labels on `notification_event`; a last error on `delivery`; an explicit parked state. Quiet hours are Phase 3.

### 2026-11-25: Readers and the scheduler (P1-2b, P1-2c, P1-6b)

Three more units, each built by a subagent, read by the orchestrator, squash-merged into local `main` and checked there (lint, typecheck, test, build exit 0). **None has had its independent review yet.** Corpus after these merges: **601 cases, 387 implemented, 214 pending**.

**P1-2c, structured-data readers and the ladder** (`dcc5d1b`). `packages/sources/src/structured` and `src/read`, against a reader contract the orchestrator wrote first (`src/read/contract.ts`, `25603dd`) so both reader units could run side by side. `readListing(request, endpointReaders, context)` returns a read with what each method saw, or a failed read with its reason, the page's fetch outcome (passed through untouched) and every candidate.

- *Order.* Platform endpoint readers that apply, in order; the first read ends the ladder without fetching the page, and so does an endpoint's `variant_not_found`, `multiple_prices` or `converted_currency`. Otherwise one page fetch, read by JSON-LD, microdata and OpenGraph.
- *Candidate rule.* Rank: JSON-LD 3, platform JSON and adapters 2, microdata and OpenGraph 1. The top rank decides; a refusal there is the result and a lower rank never overrules it; reads at the top rank that disagree on currency or amount are `multiple_prices`. Because an endpoint read ends the ladder, "JSON-LD outranks platform" is exercised only in the rule's own tests.
- *Variant coupling.* A ProductGroup's `hasVariant` members, or else each Offer, are the units. A selector picks a unit when at least one field matches and none contradicts; without one the URL picks. Several units and none selected is `variant_not_found`: never the range, the first, the cheapest or the in-stock one.
- *Where a failed read's candidates go* (an open item of Phase 0): a failed read writes no observation, so the caller logs its reason, detail, fetch outcome and candidates as one record per failed read. The ladder logs nothing.
- *Fixtures.* 15 pages: 12 cut from Phase 0 lab pages of 2026-11-18 (source URL, body hash and original size in each), 3 synthetic for the known failures (multi-capacity range, multi-capacity offers, ProductGroup range). The author's three mutations (first variant, a range accepted, a lower rank overruling a refusal) each failed tests.
- *Dependency.* `parse5` 8.0.1, behind one module, because microdata needs the tree a browser would build.
- *Spec.* S§5.2: the candidate sentence and the variant-coupling paragraph now say the above.
- *Not verified.* No real traffic; parse5's time on a full 6 MiB page (a 3.9 MB JSON-LD block is bounded under 5 s in a test). `UsedCondition` and `DamagedCondition` read as `unknown`; unit and member prices are always null; microdata `itemref` is not followed.

**P1-2b, platform JSON readers** (`8a3ae43`). `shopifyReader`, `wooReader`, `magentoReader` and `PLATFORM_READERS` (ladder order) in `packages/sources/src/platform`.

- *Shopify.* The `.js` integers are hundredths of the major unit whatever the currency: one real answer had `.js` 2288000 beside `.json` "22880" with `price_currency` JPY (n = 1 store). Three-decimal currencies are refused, since hundredths cannot carry the third decimal. The `.js` payload states no currency; it is taken, for the same session and market prefix, from the `cart_currency` cookie of the `.js` response (set on 142 of 190 `.js` answers stored by spike C), else `price_currency` of the `.json` view when its price agrees with the `.js` figure, else `/cart.js`. With none, currency `unknown`. The host's ccTLD, the store's base currency and the locale are never used for it.
- *WooCommerce.* The Store API's `currency_minor_unit` is converted only when exact. A variation's own prices come from its own request; the parent's price and range are never used.
- *Magento 2.* GraphQL by GET with an exact `url_key` check on the answer. A simple product whose minimum and maximum final price differ is `multiple_prices`.
- *A 404 on a reader's first request* means "not this platform, or not this product" (`not_applicable`); any other failure carries the fetch outcome through.
- *Manual smoke.* 11 real requests to 5 hosts of the committed lab lists, at most 3 per host, at least 3.5 s apart; no wall, 403 or 429. One product read per platform (currencies JPY, USD, CHF, and EUR on a second Shopify store). One host ignored Magento's `url_key` filter and returned two unrelated products, which the reader refused.
- *Spec.* S§5.2: the `/cart.js` sentence now gives the Shopify currency order.
- *Not verified.* A Shopify Markets prefix live (one default-market store only); Woo variations and Magento configurables against real answers; two reads of one Shopify host under different prefixes interleaving in one cookie session.
- *Wanted in the reader contract, not done:* a reason for an answer that is not the platform's payload; the Magento generation in `StoreHints`; an `unconfirmed` flag on `no_read`; a stated cap of 20 candidates.

**P1-6b, the scheduler** (`fa417a3`; areas scheduler-catch-up 12, scheduler-network-gate 11). Pure decisions in `packages/core/src/scheduler`; `createScheduler` in `apps/server/src/scheduler` (`register`, `start`, `trigger`, `health`, `wake`, `stop`). It is not wired into start-up yet.

Scripted tests, on a fake clock and a real SQLite file. These are not the Phase 1 freeze and restart gates, which pause and restart a real container:

| Scenario | What the test asserts |
|---|---|
| Freeze, 09:00 to 11:47, three jobs | One catch-up run per job standing for 5, 2 and 33 slots; further wakes add nothing; the 12:00 slot then runs once each |
| Graceful restart | The stopped run ends `failed`; one boot run per job; the next slot runs once |
| Crash | The dead run ends `failed` or `timed_out`, keeping its partial results; one boot run per job |
| Two schedulers on one database | The second joins the first's run; a second `running` row is refused by the index; the slot runs once across both |
| Deadline, handler never settles | The run ends `timed_out` at the deadline with its partial results; the lock is free |
| DNS gate | Probes at 0, 3, 8, 18, 38 and 68 s, then `skipped` and a retry 60 s later; `next_run_at` unchanged |

- *Differs from the migration's design note:* an open run is treated as dead only when its heartbeat (written into `detail_json` every 5 s) is 20 s old. Taken literally, "any open run found at boot is dead" would let a second instance end a live run and start another. The cost: after a crash, the job's boot catch-up waits up to 20 s.
- *Decisions the unit made, which the owner may overrule:* a failed run retries in 60 s for every job, so a job that always fails runs every minute (a back-off is the obvious follow-up); a timed-out run leaves no retry; the deadline counts the DNS gate's wait; croner runs in UTC.
- *Not verified.* A real container pause or laptop sleep; two real processes on one database; a handler that blocks the event loop past the lease.
- *Schema the unit would want:* owner and heartbeat columns on `job_run` instead of keys in `detail_json`; a way to store "no next slot" for a spent one-off job.

### 2026-11-24: Migration 0002, the state Phase 1 persists (P1-0b)

**Shipped** (branch `phase1/migration-0002`, squash-merged as `f22f52d`). `packages/db/migrations/0002_phase1_state.sql`, the Drizzle definitions, `packages/db/test/state.test.ts` and extensions of the existing db tests. `0001_initial.sql` is untouched. A fresh database goes 0 → 2 and a level-1 database with rows goes to 2 with every value kept (tests); the built server started on an empty data directory reports `migrationLevel: 2` (orchestrator's smoke, n=1). Lint, typecheck, test, build exit 0. The author's mutation check: removing the watch trigger and the lock index failed exactly 7 tests.

**No table rebuild.** Existing tables get `ALTER TABLE … ADD COLUMN` only, so every added column is nullable: NULL means what the column says (not paused) or "not recorded" on a row written before 0002. Writers set these columns always. A rule over several new columns is a CHECK on the last of them. Where a column would break a strict contract (`Listing`, `Delivery`), the state is a new table.

**The design, by the unit that uses it.** This is the reference the Phase 1 units are briefed from.

- *Per-host pacing (P1-1d): table `host_pacing`.* `host` (primary key, lower case, non-empty), `next_start_at` (the earliest instant the next request to the host may start). Before a start, read it and wait; on a start, upsert `next_start_at = start + 2.5 s × jitter(0.85-1.3)`; a Retry-After pushes it to the later of the two. Shared by every rung. "One request in flight per host" stays in process memory.
- *Scheduler (P1-6b): `job`, `job_run`.* `job.retry_at`: the one pending one-off retry; a newer one overwrites it, a run that stands for it clears it, and it never moves `next_run_at`. The cadence is `job.cron` in croner syntax with `next_run_at` the earliest slot not yet run (the corpus contract's `everyMs` grid is how the cases write a fixed cron). `job_run.reason` (`slot | boot | caller | retry`, the vocabulary `JOB_RUN_REASONS`), `coalesced_slots` (set exactly when the reason is), `detail_json` (an object for Diagnostics). **The overlap lock is the job's open run:** a partial unique index allows one `job_run` with `ended_at IS NULL` per job, and a CHECK ties `status = 'running'` to `ended_at IS NULL`. Starting a run inserts a running row; a refused insert means another run is open and is joined. At boot an open run belongs to a dead process: it ends `timed_out` when it has reached the deadline and `failed` otherwise, then the boot catch-up runs.
- *Watches (P1-6c): `watch` columns.* `paused_at`, `archived_at`: the status is derived (archived, else paused, else active); a watch that has alerted cannot be deleted (RESTRICT), so the UI's delete archives. `dedupe_key` (`url:…` or `query:…`), unique per profile among watches that are not archived; a paused watch keeps its key. `restock_enabled_at`: the restock contract's `restockRuleOnSince`, NULL when the rule is off. The save-first lookup (S§2.9): `lookup_state` (`queued | done | failed`, `WATCH_LOOKUP_STATES`), `lookup_queued_at`, `lookup_due_at` (set exactly while queued), `lookup_attempts`, `lookup_error` (required when failed). A trigger refuses a new watch without `dedupe_key` or `lookup_state`. Re-discovery reuses the lookup columns and is queued only when `lookup_queued_at` is at least 24 h old.
- *Sweeps (P1-6c): table `listing_check`,* one row per listing (a listing is read once for all the watches that follow it). `next_check_at` (NULL while no active watch tracks the listing), `last_read_at` (the latest attempt, observed or failed), `first_error_at` and `last_error` (a `READ_FAILURE_CAUSES` value) for the current run of failed reads. A failed read sets `last_read_at`, raises `listing.consecutive_errors` and sets the error columns (`first_error_at` only when empty); an observed read clears them and resets the count. "3+ consecutive errors over a day" is `consecutive_errors >= 3 AND first_error_at <= now − 24 h`. Per-host back-off stays in `host_access.backoff_until`.
- *The last accepted alert has no stamp column* (S§2.11). It is read from the outbox: the watch's events of the kind, their deliveries in state `accepted`, keeping a delivery whose channel is not `in_app` or whose event has no push delivery at all; per event the earliest `accepted_at`; the price is the `effective` of the observation the event names. The index `notification_event_watch_kind_idx (watch_id, kind, created_at)` replaces `notification_event_watch_idx`. The query is in `state.test.ts` as `LAST_ACCEPTED`.
- *Store directory and trust (P1-3a, P1-5b).* `store.consecutive_errors`, `last_ok_at`, `last_error_at`, `last_error`. Table `domain_registration`: `domain` (the registrable domain), `registered_at` (NULL is the explicit fact that RDAP gave no date), `fetched_at`; a transient failure writes no row.
- *Owner auth (P1-8a).* Table `owner_password`: `profile_id` (primary key), `password_hash` (a PHC string, `$argon2…`; Node's `crypto.argon2` returns raw bytes, so the unit builds the string), `set_at`. Not a `setting` row, so no settings route can read it. Table `session`: `profile_id`, `token_hash` (SHA-256 of the cookie token, 64 lower-case hex characters, unique), `created_at`, `expires_at`, `last_seen_at`; logging out deletes the row.
- *Channels (P1-7).* `channel.name`, `created_at`, `disabled_at` (NULL means enabled), `removed_at` (soft removal: a channel with deliveries cannot be deleted). Nothing changes on `delivery` or `notification_event`, and every guard is intact.

**Numbers.** Tables 24 → 29; CHECKs 138 → 175 (named 32 → 43); triggers 11 → 12. Vocabulary added to `packages/shared`: `JOB_RUN_REASONS`, `WATCH_LOOKUP_STATES`, `READ_FAILURE_CAUSES` (every fetch outcome except `ok`, plus `no_price` and `multiple_prices`).

**Spec.** S§4.1 (`store` health fields; `listing_check`, `domain_registration`), S§4.2 (`watch`), S§4.4 (`job`, `job_run`, the outbox clause, `channel`, `host_pacing`, `owner_password`, `session`).

**Open, for the units named.**

- A pending delivery on a removed or disabled push channel can never be moved to `failed` (the `delivery_outcome` rule), so the delivery unit must leave such deliveries out of the gating status or skip them in the outbox pass.
- In-app unread state has no home yet (Phase 3 feed: its own table). `delivery` has no error detail for Diagnostics.
- Not persisted: HTTP cookie jars, the Tranco list, a per-watch check interval, a timezone for croner.
- The live check's "error rate per outcome kind" has no read-attempt log; counts in `job_run.detail_json` are the proposal.
- Query plans were checked on small test databases only.

### 2026-11-24: The first four units (guard, price text, transport, matcher)

Each was built by a subagent in its own worktree, read by the orchestrator, squash-merged into local `main` and checked there (lint, typecheck, test, build exit 0). **None has had its independent review yet**; all four are high-risk areas and the reviews are owed before Phase 1 exits. Corpus after these merges: **601 cases, 364 implemented, 237 pending** (`node evals/corpus/count.ts`).

**P1-1a, the URL guard** (`910a62d`; areas url-guard-address 57, url-guard-transport 11). `packages/fetch/src/guard`. Refused: every entry of the IANA IPv4 and IPv6 special-purpose registries, IPv4 multicast, and in IPv6 everything outside 2000::/3; an IPv4-mapped or NAT64 address is judged by the IPv4 address it carries. A name is resolved once per hop, every answered address is judged and one refused address refuses the name; only vetted addresses are dialled. Redirects are followed by hand and re-checked. Decisions the unit made, which the owner may overrule: at most 10 redirects, and one more is `network_error ERR_TOO_MANY_REDIRECTS` (the vocabulary has no refusal reason for it); `localhost` names are refused without a lookup; an empty DNS answer is `network_error ENOTFOUND`. Not verified: the range table against a fresh copy of the IANA registries.

**P1-2a, price text and currency** (`82403bc`; eight areas, 138 cases). `packages/core/src/pricetext`, `currency`, `market`. Digits stay text until `moneyFromDecimal`; no float, no default currency. The author wrote the code before its unit tests (the corpus cases were the failing tests) and says so; the unit tests then found three bugs, fixed in the branch. Spec S§5.2 edited: a sign several currencies share ("$", "¥", "kr") takes the store's country and is refused when that country does not write it; a lone comma before three digits is thousands, except under a decimal-comma locale, and is refused in a three-decimal currency with no clear locale. The "1.299 €" ruling is read literally: only locales that group with a dot read it as thousands (fr-FR, sv, pl and pt-PT group with spaces and are refused). Not verified: the locale separator table against a pinned CLDR release; the country-to-currency table against ISO sources. Proposed for `packages/shared`, not done: the refusal-code vocabularies, plus `not_positive`, `out_of_range` and `not_an_amount`.

**P1-1b, the HTTP transport** (`d02b35b`). `impit` has no connect-to option, so each hop is pinned through an in-process SOCKS5 proxy on loopback: a one-use ticket per hop for the vetted address, TLS end to end with the server name and certificate check from the URL. `fetchPage` serves the `api` and `http` rungs and has no way to the network but `guardedFetch`. Body caps: 6 MiB for a page, 4 MiB for JSON. Image, measured once by the unit on the native arm64 image: 92.8 MB pull, 288.1 MB unpacked, 29.5 MB idle, 222 ms to healthy (budgets 110 / 320 / 150 MB and 3 s; the server does not load impit yet, so the idle figure does not include it). Both platforms build and each image holds only its own impit addon. Real traffic: 3 requests in a manual smoke (example.com twice, www.iana.org once), all `ok`. Decisions the unit made: a status with no kind in S§5.1 (400, 405, 451, an unfollowed 3xx) is `network_error HTTP_<status>`; `sec-fetch-site` is sent beside a Referer. Not verified: a successful TLS request inside the test suite (impit cannot be told to trust a test certificate), HTTP/2, pinning to an IPv6 address, the amd64 image's budgets. For the lab: impit sends the caller's headers before the profile's own, a header-order difference from Chrome.

**P1-4, matcher tiers 1-2** (`31013f8`; areas match-title-rules 87, match-identifiers 16, match-owner-rulings 48, known-failure-wrong-variant 7). `packages/core/src/matching`, the `match_verdict` cache helper in `packages/db`, and the scorer `evals/gold/score-matcher.ts`. **Gold set, dev split only** (41 products, n = 867 snapshots, model labels on both sides), reproduced by the orchestrator on the merged tree:

| Measure | Value |
|---|---|
| Identity precision (of listings called `exact`) | 70 / 73 = 95.9% |
| Recall of `exact` | 70 / 77 = 90.9% |
| Left `unknown` | 120 / 867 = 13.8% |

The rules were tuned on this split, so these are not gate numbers. The held-out split has not been run or read; it is run once, at the Phase 1 gate, on the matcher as it then stands. Spec S§5.4 gained one sentence: identifiers and title rules must not contradict each other (an identifier match whose title the rules reject is `unknown`, and so is a title match on a page that states another valid GTIN or part number); on dev that costs 7 gold-exact listings (regional or in-store GTINs) and keeps 27 non-exact listings from being called exact. Labels where the rulings allow either: a material-grade Plus or a version suffix is `variant` (the gold set says `other_model`); a model-name qualifier (Duo Plus, A1 mini) is `other_model`. The accessory vocabulary is English and German and grew from reading dev listings. Found by the unit: the gold set's README says both WH-1000XM5 products are held out, and `split.json` assigns them to dev. Not verified: anything outside CA, US and DE.

---

## Phase 0: Foundations, contracts and spikes

### 2026-11-24: The open Phase 0 decisions, settled

The owner answered the Phase 0 report with "implement what you think is best" and asked for a native Claude API system in the Phase 2 documents. Each item below is the orchestrator's decision under that word, and the owner may overrule any of them.

**1. The recordings are published as they are.** Before pushing, the orchestrator read what they expose: the `anthropic-ratelimit-*` header values (the account's limits and what was left of them) and the Models API list, 14 ids, every one a model Anthropic lists publicly. With the two leak scans of the entry below (0 pieces of the key, no personal term), nothing in them is a secret. The two details changed at review (NAT64 judged by its embedded IPv4 address; the in-app acceptance stamps the cooldown where no push channel is configured) stand.

**2. The gold-set gate is accepted on model labels.** Phase 0 exits with it. What it carries forward: the Phase 2 identity-precision gate is measured on this set, so that figure is reported as "against model labels" unless a person has checked the held-out `exact` labels first (37 listings, small enough to check all). The in-app review queue of Phase 2 is where a person's labels first arrive.

**3. Where the corpus and the gold set disagreed, the corpus follows the gold set.** Five cases in four listing families stopped being `exact`:

| Case | Was | Now | Gold set |
|---|---|---|---|
| `match-owner-rulings/plus-only-in-the-listing` (PolyTerra PLA+ for PolyTerra PLA) | `exact` | `other_model` or `variant` | `other_model` |
| `match-owner-rulings/plus-asked-listing-plus-2-0` (SUNLU PLA+ 2.0 for SUNLU PLA+) | `exact` | `other_model` or `variant` | `other_model` |
| `match-title-rules/for-mac-edition` (MX Master 3S For Mac) | `exact` | `variant` | `variant` |
| `match-title-rules/with-heatsink-for-a-console` (SN850X with heatsink) | `exact` | `variant` | `variant` |
| `match-title-rules/with-heatsink-compatible-with-a-console` (990 PRO with heatsink) | `exact` | `variant` | `variant` |

Reasons: `exact` means the two would share a barcode (S§5.4), and none of these pairs does; a false `exact` mixes two products' price histories and can fire an alert for the wrong one, while a false `variant` only moves a listing to another result group; and Phase 1 code is written to pass the corpus while the Phase 2 gate is measured on the gold set, so a disagreement between them would have been built in. This retires "Plus counts the query's way" for the material grade (a ruling from the predecessor's review of 2026-10-23): a Plus on either side alone is a material suffix under the owner's ruling of 2026-11-23. The two filament cases expect the pair that ruling names, as their neighbours do; the other_model / other_line boundary stays open.

The corpus is still **601 cases, 601 pending**. The matcher areas now hold 46 `exact` expectations (51 before) and 39 sets (37). Each changed case keeps the predecessor's behaviour in `divergence` and lost its `ownerCheck`. Other configuration questions (Prusa kit or assembled, Saturn 12K or 16K, the two Sonicare model codes) keep theirs. Spec S§5.4 says the new rule.

**Effect on spike D.** Its dataset fingerprint moved again, to `ac532875…e03961` (46 `exact`, 119 single, 39 sets). The published figures are not re-scored. They counted an `exact` on these five items as right, and the report says effort `low` more often called a For Mac or heatsink listing a variant, so `medium`'s recall lead is overstated by an unknown amount. Judge effort `medium` is therefore provisional until Phase 2 measures the judge on the gold set (noted in the report and in S§5.7).

**4. Decision #5: the native Anthropic Messages adapter is built in Phase 2.** It was Phase 7 by default. Spec: S§1.3, S§3.3 (transport), S§4.4 (`llm_endpoint.wire` and prices), S§5.7 (the adapter's rules, the probe on that wire, the structured-output ladder, cost) and S§9 #5. Plan: a Phase 2 workstream of its own with its tests-first order, a Phase 2 exit gate, the probe-matrix gate, the first-run wizard, a Phase 6 note on snapshot pruning, the Phase 7 line removed, one risk-register row.

- *Transport:* `@anthropic-ai/sdk` as transport only, as spike D's runner already uses it; retries off, no SDK tool runner, the run loop stays the project's own. Fallback: raw `fetch` against the same fixtures.
- *From our recordings:* the seven probe steps, cache write then read of 3,628 tokens, thinking tokens in `output_tokens_details`, the provisional `message_start` count, the 400 on a sampling parameter, a forced `tool_choice` accepted by Claude Haiku 5.5, the empty reply to `tool_choice: none`.
- *From Anthropic's documentation, not recorded here:* that the current Opus, Sonnet and Fable models refuse a forced `tool_choice`; that editing earlier turns invalidates later thinking blocks; the minimum cacheable prefix; the second rate card of Claude Haiku 5.5 above 100K prompt tokens. The plan asks for recordings of the first two before code relies on them.
- *Not established:* the SDK's size in the core image; anything about OpenRouter or LiteLLM as a route for Claude.

**CI.** The push of these commits is green (run 45530574650, both jobs). The run before it, on the gold-set review commit `5ecc97a` (2026-11-24), had failed, which the ledger's "CI green on GitHub `main`" did not say: one test of the transport lab, "impit adapter times out on a body that never ends", got `GenericFailure` where it expects `timeout`. Three timers race at the deadline (impit's own, the abort signal, the body reader's), and when impit's fires first its error carries no timeout word. The adapter now names any failure at or after the deadline a timeout. Seen once in CI, never locally on macOS; Phase 1's `HttpTransport` must keep this rule, or a timed-out read is not retried.

**Still the owner's, none blocking Phase 1:** the other_model / other_line boundary; the 37 other set cases (39 with the two filament cases); the three boundary questions of the gold-set review; the author's readings listed in the entry below.

### 2026-11-24: The corpus follows the rulings of 2026-11-23 (P0-3e)

**Shipped** (branch `phase0/corpus-rulings`, squash-merged). Every owner ruling and every detail the orchestrator settled on 2026-11-23 is pinned by corpus cases that cite it, except one (below). **568 → 601 cases, 601 pending, 0 implemented** (+33: reference-price +8, alert-price-rules +7, url-guard-address +5, alert-delivery-gating +4, currency-resolution +4, price-text-parsing +2, scheduler-catch-up +2, wall-classification +1). Lint, typecheck, test and build exit 0 on the merged tree. The author's mutation check (one case throwing a `TypeError`) made the test command exit 1.

**Expectations that changed:**

- the median reference price is recomputed as reads arrive (was `keep`); the user's confirmed price wins over it;
- in-house walls name `ebay` and `amazon` (were null); a 401 is `login_required`;
- a URL with user-info or no host is refused as `url_form` (was `scheme`; two were `private_address`);
- "1.299 €" with no locale is `ambiguous_separator` (was `excess_precision`), and reads as 129900 EUR minor units on a dot-thousands locale;
- two matcher cases that were `exact` on the URL alone are now `unknown` (a model number in a URL path is supporting evidence only);
- SUNLU PLA, PLA Matte and Silk PLA+ for a SUNLU PLA+ query now expect `other_model` or `variant` (were `other_line`), the pair the owner's ruling names.

**Vocabulary** (`packages/shared`): `url_form` in `POLICY_REFUSAL_REASONS`, `timed_out` in `JOB_RUN_STATUSES`. No migration: `job_run.status` has no CHECK. **Spec:** S§4.4, S§5.1, S§5.2, S§5.4, S§5.5, S§5.8 and S§5.11 now say what the rulings say.

**Two details changed by the orchestrator at review** (2026-11-24, the owner may overrule):

- *NAT64.* The author read "every IANA special-purpose range is refused" literally and refused 64:ff9b::/96. On an IPv6-only network with DNS64 every IPv4-only shop resolves into that range, so a NAT64 address is judged by the IPv4 address it embeds, as the predecessor did (`nat64-of-public-passes`; the private and loopback forms stay refused).
- *In-app only.* The author read "in-app acceptance alone does not stamp the cooldown" as never stamping on an install with no push channel, which leaves every alert of a default install "undelivered". The ruling is about a failed push; where no push channel is configured the in-app acceptance is the delivery and stamps (`in-app-only-install-stamps-at-in-app-acceptance`).

**Spike D's dataset** is built from the matcher areas, so its fingerprint moved: `e930f87b…a7e29` (158 items, 53 exact, 35 sets, as measured on 2026-11-23) → `5520a85b…2236` (158 items, 51 exact, 37 sets). The published figures are unchanged and say which dataset they were measured on; re-scoring those runs needs a checkout of `d5acab7`.

**Not pinned:** "`unknown` condition never triggers a new-item alert" has no case, because no area holds new-listing alerts (they arrive with saved searches).

**Open, for the owner** (none blocks Phase 1; each changes only which label a non-match gets, or is one listing family):

- The corpus keeps four `exact` expectations from the predecessor's reviews that the gold set labels otherwise, because the gold products carry a must-have the corpus query does not: PolyTerra PLA+ for PolyTerra PLA (gold: `other_model`), SUNLU PLA+ 2.0 for SUNLU PLA+ (`other_model`), MX Master 3S For Mac (`variant`), SSDs with a heatsink (`variant`). The suffix ruling of 2026-11-23 points the gold set's way.
- 37 matcher cases expect a set of relations; the author's single pick for each is in the unit report (most follow the gold set's labels).
- The other_model / other_line boundary (Polymaker sibling lines are `other_line` in the corpus and `other_model` in the gold set).
- The author's readings: a smaller second drop that still meets the rule fires at the second read's price; a bare 403 keeps mode `challenge`; "approx." detection is the words "approx." and "≈".

### 2026-11-24: Wire recordings of Claude Haiku 5.5 (P0-6b)

**Shipped** (branch `phase0/wire-recordings`, squash-merged). `evals/wire` gains a native Anthropic Messages recording path (family `anthropic`: key as `x-api-key`, `anthropic-version: 2026-10-21`), a 19-scenario `messages-*` matrix covering the seven probe steps of S§5.7, the family `anthropic-compat` for Anthropic's OpenAI-compatibility endpoint (the existing matrix), replay matching on `x-api-key`, `anthropic-version` and `anthropic-beta`, and a counts-only review script (`review.ts`). Tests were written against the scripted server before any recording.

**Committed: 38 real recordings** of `claude-haiku-5-5` under `evals/wire/fixtures/` (19 Messages, 19 compatibility endpoint; 29 HTTP 200 and 9 error statuses), each unedited recorder output, parsed and replayed byte for byte in `test/fixtures.test.ts`. 39 requests in all (one scenario was recorded twice, below), sequential, no retries. **Spend: $0.0021** at list price, of a $1.00 cap.

**What the recordings show** (counts are of these recordings, one session per endpoint, one day):

- `tool_choice: none` with tools supplied returned an empty reply on both wire shapes (2 of 2). S§5.7's forced finish now says an empty final call goes to the deterministic finisher.
- Messages: usage arrives in `message_start` and, cumulative, in the last `message_delta`; the provisional `output_tokens` of `message_start` equalled the final count in 3 of 11 streams. Thinking tokens are `usage.output_tokens_details.thinking_tokens` (35 of 38 output tokens in the one thinking recording); no thinking block appeared in the 10 requests at default settings. The cache pair wrote and then read 3,628 tokens. A sampling parameter is refused (400).
- Compatibility endpoint: no cache and no cached count (3,645 and 3,644 prompt tokens), no reasoning field (38 completion tokens billed for a one-word reply), `json_object` refused (400), `/models` refused without `anthropic-version` (400), errors in OpenAI's shape without a request id.
- Every SSE `data` object on both endpoints (24 of 24 streams) is padded with spaces before its closing brace, so a client parses the JSON and never matches the text.

**Leak review, done twice.** The author's `review.ts` and the orchestrator's own scan of the 59 files under `evals/wire` both found 0 of the key's 99 eight-character windows, 0 base64 windows and no personal term. Response headers that name the account or the request (`request-id`, `anthropic-organization-id`, `anthropic-workspace-id`, `cf-ray`) are dropped; `req_…` and `msg_…` ids in bodies are masked after the prefix. **Sent back once by the orchestrator:** the thinking signature (an opaque blob of 884 characters whose binding cannot be checked) is now masked after its first 8 characters by a redaction rule, and that scenario was re-recorded so the file is still recorder output; id-shaped examples in the tests, copied from Anthropic's documentation, were replaced by made-up values. Kept and visible: `toolu_…` ids (parallel calls need distinct ids), the rate-limit header values (they show the account's usage tier) and the model list (14 models).

**Spec edits:** S§5.7 (the forced finish), S§9 #5 (the evidence; the decision stays the owner's).

**Deviation.** The brief asked for Messages recordings; the compatibility endpoint was recorded too because Anthropic's documentation offers one and decision #5 rests on the difference. The plan's other servers (OpenRouter, OpenAI, vLLM, Ollama, llama.cpp) are not recorded (owner, 2026-11-23: hosted Haiku 5.5 only for now).

**Not established:** behaviour on any other model or day; what `/models` returns on the compatibility endpoint once the version header is sent; whether a masked signature matters to a test (it cannot be replayed to the real API).

### 2026-11-23: Gold set v1 reviewed (second labels and rulings, by a model in the owner's place)

The owner handed the review of `evals/gold/sets/matcher-v1/` to Claude Mythos 5.2 (handle `m1`) instead of doing it by hand. **No person has labelled the set**; the second labeller is another Claude model, so the agreement is weaker evidence than a person's labels. Details in the set's README.

- **Blind second labels, n = 174** (the whole worklist), filed in `labels/m1.json` before the agent labels were opened. Seven relations: raw agreement 164/174 = 0.943, Cohen's kappa 0.919. Exact versus not exact: 174/174, kappa 1.000 (12 exact listings on the worklist). The 10 disagreements are between kinds of non-match: other_line / other_model 6, other_model / variant 2, bundle / variant 2.
- **Rulings on the 25 flagged disagreements:** 19 keep the tie-break, 6 are `adjudicated` labels: `braun-series-9-ca-s06` other_model to variant; `happybrush-de-s17` and `-s18` variant to bundle; `breville-barista-express-ca-s16` and `ninja-af101-s01` exact to unknown; `polyterra-pla-s13` other_model to unknown. The 72 unflagged disagreements keep their tie-break and were not ruled.
- **Gold after the rulings:** exact 114 (dev 77, held-out 37), variant 124, bundle 54, accessory_or_part 226, other_model 529, other_line 246, unknown 14. Hard negatives 933 of 1,307 (71.4%). Every product still has an exact listing.
- **Validator (strict): OK**, 0 violations; `double_labelled` 174 of 1,307 (13.3%). The gate "gold set v1 is labelled with its 40/20 split, 10% double-labelled, agreement reported" is met by the tooling's definition, with model labels on both sides.
- **Open, for the owner:** the other_model / other_line boundary has no reproducible rule; a kit around another variant of the target is labelled `bundle`; whether a product rename the listing does not state (PolyTerra to Panchroma Matte) may count as `exact`.

### 2026-11-23: Spike D part 2: Claude Haiku 5.5 as the model judge

Report: `docs/spikes/d-model-judge.md`; harness `evals/judge-spike/` (branch `phase0/spike-d-part2`, for the orchestrator to review).

- **Shipped.** A native Anthropic Messages call path for the judge runner (`--api anthropic`, `lib/anthropic.ts`) through the official `@anthropic-ai/sdk` 1.12.0, not the OpenAI-compatibility endpoint: rules in `system`, structured output by `output_config.format`, adaptive thinking with `output_config.effort`, no sampling parameters, no prefill, `stop_reason` read before content, SDK retries off, usage normalised (Anthropic's `input_tokens` plus cache reads and writes). The four budgets, the repair retry, validation, records and the leak check are shared with the Chat Completions path. Tests against scripted servers only (unit, runner and end to end). The report generator now names the API and sums output and reasoning tokens and known spend.
- **Runs.** Smoke first: 3 calls at `low` ($0.000279 a call) and 3 at `medium` ($0.000444), projecting about $0.63 for both full runs, under the $5 cap. Then the default plan (batch sizes 1, 5, 10, 15; 3 trials; 873 batches, 1,896 judgements) twice on `claude-haiku-5-5`, at effort `low` (878 calls) and `medium` (876 calls), both completed with no budget stop, 0 refusals, 0 truncations, 0 HTTP errors. **Actual spend: $0.521310** (smoke $0.002169, `low` $0.208681, `medium` $0.310461), at $0.10 / $0.50 per million input / output tokens; 5 free token-counting calls.
- **Results** (n = 1,896 judgements per run: 12 readings of 158 items, 53 of them exact; on the matcher corpus, hard-weighted, no held-out split):

| Effort | Precision of exact | Recall of exact | Abstention | Invalid batches after the repair | Cost / batch (size 1 to 15) | Median latency (size 1 / 15) |
|---|--:|--:|--:|--:|--:|--:|
| `low` | 362/385 = 0.940 | 362/636 = 0.569 | 182/1896 = 0.096 | 1/873 | $0.000176 to $0.000342 | 1.0 s / 1.9 s |
| `medium` | 490/515 = 0.951 | 490/636 = 0.770 | 181/1896 = 0.095 | 0/873 | $0.000258 to $0.000512 | 1.8 s / 3.3 s |

- At `medium`: other line 0/60, other model 0/204, wrong capacity 0/12 (one item), accessory or part 5/420, set items 20/420; every false accept is one of 4 items (two Combo rulings, a touch screen for the printer, an MPN-only listing). Precision is flat across batch sizes (0.943-0.961); recall is 0.849 at one listing a call and 0.730-0.767 in batches; agreement across trials (same relation) 0.911 at size 1, 0.791-0.842 in batches. Only 3 batches of 15 listings exist, so full batches are not established.
- 9 of 1,754 first attempts broke the schema rule "`differingAttrs` empty for `exact`" (6 of them `condition` on open-box listings); the repair fixed 8. Of the 6 exact items never accepted at `medium`, 2 rest on the URL the judge does not see and 4 are owner or predecessor rulings the prompt does not carry (heatsink, For Mac, two PLA+ rulings).
- Haiku 5.5's tokenizer: the fixed part of `judge.v1` counts about 682 tokens (under 800; the part-1 estimate was 537), and the schema sent as `output_config.format` adds about 419 tokens of input.
- **Proposed decision.** Haiku 5.5 is a usable tier-3 judge on this set, at effort `medium` (its default, sent explicitly): against `low` it found 128 more exact judgements at the same precision for about 1.5 times the cost. Keep batches of up to 15. A `judge.v2` should say that condition is not identity (owner's call). Spec edits proposed in S§5.7 (the judge's effort, the Messages usage fields, counting the prompt with the endpoint's tokenizer), not made.
- **Deviation.** The brief asked for one full run; two were made, one per effort level, to decide the effort setting, after the smoke check showed both fit far under the cap.
- **Caveats.** One model only (owner's decision; no veto-only reading); labels are the predecessor's reviewed pairs as the corpus ported them, some of which are rulings the prompt does not carry; not the S§6 gate; no lift over rules (tier 2 is Phase 1). Raw results (uncommitted) in `evals/out/judge-spike/`.

### 2026-11-23: Gold set v1 (P0-4c), agent-labelled, waiting for the owner's review

**Merged by the orchestrator** after reading both review sheets and sampling labels. Owner workload trimmed: of the 97 disagreements, only the 25 where one pass said `exact`, `variant` or `bundle` need a ruling (marked ⚑); in the other 72 both passes call the listing a non-match, and the tie-break stands. v1 is taken as enough for Phase 1; the 403-walled large retailers and single-store products are revisited when the browser rung exists (Phase 2).

**Shipped** (branch `phase0/gold-v1`): `evals/gold/sets/matcher-v1/` (products, snapshots, primary labels, both agent passes with evidence, split, worklist, two review sheets, README), `evals/gold/agent-label.ts` (the labeller), `evals/gold/capture/` (the capture scripts and how the capture was done). `@anthropic-ai/sdk` 1.6.0 added to `evals` (the newest release older than two weeks).

**Products (n = 61).** CA 25, US 18, DE 18. Categories: 3d-printing 12, computing 12, audio 10, kitchen-appliances 10, personal-care 9, power-tools 8. 19 of the predecessor's 20 keep their ids; the Kobra 3 Combo became the Kobra 3 Max V2 Combo (German stores sell only that). Two more products were retargeted after the first labelling found no exact listing (Milwaukee 2853-20 to 2953-20; Liberty 4 NC (DE) to Liberty 4 Pro); their listings were relabelled. Identity: GTIN on 50, MPN on 38, neither on 7, all taken from a listing the store publishes.

**Snapshots (n = 1,307, 17-23 per product)** from 47 stores out of 237 probed: shop search through Shopify predictive search, WooCommerce Store API, Magento GraphQL, Best Buy Canada's JSON API, and three German HTML search pages. About 1,810 requests, at most one in flight per host and at least 1.2 s apart, honest lab User-Agent. One 429 (alternate.de, after 45 requests); the host was stopped. Most large retailers answered 403 to plain HTTP and were not retried. **All requests came from one Canadian IP**: US and DE stores were seen from Canada, and two US stores showed CAD prices (recorded as currency `unknown`). 31 of 61 products have listings from one store; Best Buy Canada supplies 295 of the 542 CA listings. Set size 2.3 MB.

**Labels.** Claude Opus 5.5 (`claude-opus-5-5`) on the native Anthropic API, effort `low`, structured output, prompt `gold-label.v1` with the owner's rulings (line or material suffix never `exact`; Combo versus not-Combo is `variant` both ways; condition and price are not identity). Pass A: product first, listings in id order. Pass B: listings first in reverse order, product after. The passes agree on 1,210 of 1,307 (92.6%). The 97 disagreements went to a third call that saw both readings: other_line/other_model 45, accessory_or_part/other_line 26, other_model/variant 18, bundle/variant 3, exact/unknown 3, other 2. Primary labels: exact 116, variant 125, bundle 52, accessory_or_part 226, other_model 531, other_line 246, unknown 11. Hard negatives 934 of 1,307 (71.5%; dev 600 of 867, held-out 334 of 440). Every product has at least one exact listing; held-out has 38.

**Spend:** $7.43 over 154 calls (690,802 input, 233,509 output tokens at $4 / $20 per million, cache counted as plain input), plus $0.23 on a two-product trial; cap $15.

**Split and worklist.** `split.ts assign --seed matcher-v1-2026-11-23`: dev 41, held-out 20 (the same-item pairs WH-1000XM5 CA/US and Raspberry Pi 5 US/DE went to held-out together through the leakage guard). `double-label.ts pick`: 174 snapshots (13.3%: `ceil(10%)` per product); 14 of them are also disagreements.

**Validator (strict): fails on one requirement only.** Met: products 61, snapshots per product, labels 1,307, all labelled, categories 6, countries 3, hard negatives 71.5%, split assigned, dev 41, held-out 20. Short: `double_labelled` 0 of 1,307. Violations: 0. `double-label.ts agreement` refuses (n = 0) until the owner's second labels exist.

**What the owner needs to do.** (1) Label the 174 rows of `evals/gold/sets/matcher-v1/REVIEW.md` without opening the other sheet; the orchestrator files them as `labels/<owner handle>.json` with `"pass": "second"` and runs the agreement report. (2) Rule on the 97 rows of `REVIEW-disagreements.md` ("ok" or a relation); differing rulings become `adjudicated` labels. (3) Decide whether v1 is enough as it stands (31 single-store products; 116 exact listings, 38 held-out) or more stores and exact listings should be added before Phase 2 measures identity precision on it.

### 2026-11-23: Spike B part 2: functional check stopped at the profile host

**Second run, same day (orchestrator):** profile re-hosted on jsDelivr pinned to the tag `agent-profile-v1`; the same 6-row functional check got HTTP 200 on 6 of 6, 0 profile rejections, 20 products per request, 120 of 120 offers priced with link and checkout URL, attribution parameters (`_gsid`, `utm_source`, `utm_medium`) on all 120, 108 of 120 in the requested currency, no 429. Spike B is done; see the updated report.

Report: `docs/spikes/b-shopify-catalog.md`; harness `lab/catalog/`. The run was the 6-row functional check chosen earlier today (2 queries × CA/CAD, US/USD, DE/EUR; sequential, ≥2 s apart, no retries, stop on 429). No latency was recorded, because the API terms forbid benchmarking.

- **n = 1 request sent** (CA/CAD). The profile URL `https://raw.githubusercontent.com/1mshy/shopping-agent/main/lab/catalog/agent-profile.json` served HTTP 200, `text/plain; charset=utf-8`, `cache-control: max-age=300`, with a body identical to the committed file.
- **Shopify answered** HTTP 422, JSON-RPC `-32001` "UCP discovery failed", `data.code: profile_malformed`, "Unable to fetch agent profile: Invalid content type". The runner stopped on the profile rejection, so the other 5 rows were not sent and no other host was tried.
- **Not observed:** products, offers, currency match and attribution parameters (0 products, 0 offers). The request shape got as far as profile discovery without an invalid-params error. Whether Shopify enforces UCP's `Cache-Control: public` rule is not known.
- **Fallback needs:** HTTPS, no redirect, `Content-Type: application/json`, and `Cache-Control: public` with `max-age` ≥60. The jsDelivr mirror of this repository meets all of these by its headers (checked once, not sent to Shopify), but it is third-party and caches a branch URL for up to 7 days. GitHub Pages and header-setting static hosts were not checked.
- **Code:** `run.ts` has a `--functional-check` flag (≤6 rows, no latency anywhere) and stops at the first profile rejection. Records also carry the UCP version, message codes, and counts of offers with a link or a checkout URL. Tests were added.
- **Spec:** S§5.3 now requires `Content-Type: application/json`, which is confirmed live. It keeps its [verify] mark for the result-side claims and switches the source off on a profile rejection. S§9 #3 records the refusal.
- **Open:** a new profile host (orchestrator or owner), then the same 6-row check.

### 2026-11-23: Owner answers on the Phase 0 gates

- **Predecessor copy confirmed:** `~/Documents/GitHub/hermes-shopping` (`browser-agent`, `51db126` plus uncommitted files) is the first iteration and the reference for everything ported. The corpus gate holds without condition.
- **Deployment:** the app runs in a Docker container on the user's own laptop or computer. Nothing about the app is public; only the static agent profile is.
- **Spike B:** the owner accepts the Shopify API License and Terms of Use and left the rest to the orchestrator, who chose:
  - Profile host: GitHub raw from this public repository (S§9 #3). Shopify's guide names GitHub raw; UCP's hosting rules ask for `Cache-Control: public`, and raw sends `max-age=300` without it and as `text/plain` (checked 2026-11-23). The functional check shows whether Shopify accepts it; the fallback is an own domain or a static host that sets headers.
  - Part 2 is a small functional check: a handful of `search_catalog` queries to confirm the profile is accepted and results come back in the requested currency. No latency statistics and no 60-query run, which keeps clear of the terms' benchmarking clause.
  - The keyless Catalog stays on by default (S§5.3) for a single-user install, with the optional Dev Dashboard token setting. Shopify says not to use unauthenticated requests for production traffic; one person's searches from their own machine are taken as outside that, and the owner may overrule.
- **LLMs:** hosted Claude Haiku 5.5 only for now. Spike D drops the second hosted model and the local one; the wire recordings cover Haiku 5.5 only, and OpenAI, vLLM, Ollama and llama.cpp wait. Still needed: the route (proposed OpenRouter, as S§9 #5 keeps Claude there until a native adapter) and a spending ceiling.
- **Decision #4:** robots.txt public default is `ignore`, setting exposed.
- **Later the same day:** spike decisions A (`impit` default, `wreq-js` swap-in, `impers` not adopted) and C (platform JSON first: Shopify, WooCommerce, Magento; Magento GraphQL as Magento 2 only) confirmed. Haiku 5.5 is reached on the native Anthropic API with the key and URL in the gitignored `.env`, not through OpenRouter, so spike D and the recordings need an Anthropic Messages path (this brings part of S§9 #5 forward for the lab tools only; the product's adapter decision is still open). LLM spend is capped at $100 for the month and is meant to stay far below.
- **Gold set (P0-4c):** agents label every snapshot with Claude Opus 5.5 (never the model being judged) and attach their evidence; the owner reviews a random 10% (this is the double-label pass, with agreement reported) plus every snapshot where agent passes disagree. Six categories from the predecessor's products: `3d-printing`, `computing`, `audio`, `kitchen-appliances`, `power-tools`, `personal-care`. Countries CA, US and DE (Germany is the EU country). The hard-negative definition (`variant`, `bundle`, `accessory_or_part`, `other_model`) is adopted. The 35 matcher cases that expect a set are labelled the same way.

**Owner rulings on the Phase 1 questions (2026-11-23)**, to be applied to the corpus cases before Phase 1 implements them:

- Alert price is the effective price after an automatic discount, shown beside the sticker; a coupon that needs clipping or a code does not trigger an alert on its own.
- A user's threshold is inclusive ("$50 or less" fires at $50.00).
- The confirming read must itself meet the rule; a smaller drop on the second read sends nothing and the watch keeps watching.
- Delivery: acceptance by the in-app channel alone does not stamp the cooldown; push keeps being retried until a push channel accepts, and the cooldown starts then.
- Reference price: the user's confirmed price wins over the observed median until the user changes it; otherwise the median of recent observations, recomputed as reads arrive.
- `unknown` condition is shown with a flag, left out of the reference price, and never triggers a new-item alert.
- Matcher: a name suffix that changes the line (Duo vs Duo Plus) or the material (PLA+ vs Silk PLA+) makes a different product (`other_model` or `variant`), never `exact`.
- "1.299 €" on a shop whose locale uses the dot as a thousands separator reads as 1,299 euros; with an unclear locale the price is refused.
- A Shopify Markets presentment price is the shop's own price for that market, not a converted figure; conversions made by the agent or a site's "approx." figures are still refused.

**Settled by the orchestrator** (engineering details; the owner may overrule): the confirming read uses the same read path including the rung; the cooldown is per watch; an even-count median is the mean of the two middle values rounded half-up to the minor unit; probe timings are delays between probes as ported (offsets 0, 3, 8, 18, 38, 68 s), and a job that reaches its deadline ends as timed out keeping its partial results; currency evidence ranks an explicit mark on the figure, then a platform declaration, then the page locale, then the ccTLD; percentage coupons round half-up; a bare 403 with no wall marker is a block, not a named wall, and a 401 is `login_required`; in-house walls name their vendor; every IANA special-purpose address range is refused; a URL unacceptable as written (user-info, no host) gets its own refusal reason instead of `scheme`; a model number in a URL path is supporting evidence, never identity on its own; the gold-set product identity adopts the `packages/shared` `SearchIntent` shape.

### 2026-11-18: Spike A: HTTP transport lab

Report: `docs/spikes/a-http-transport.md`; harness `lab/transport/`. One GET of one product URL per host from each client, 59 hosts (34 of the predecessor's 42 lab stores, 25 playbook hosts with a priced product URL on record), 180 requests, at most 5 to a host; "readable" = a price in JSON-LD, microdata, OpenGraph price tags or Shopify's product meta. After the offline re-classification (1 of 177 rows changed):

| client | n | readable | served (readable + page without price markup) | wall |
|---|--:|---|---|---|
| Node `fetch` (baseline, honest UA) | 59 | 26 (44.1%) | 37 (62.7%) | 19 (32.2%) |
| `impit` 0.14.9, `chrome151` | 59 | 31 (52.5%) | 48 (81.4%) | 10 (16.9%) |
| `wreq-js` 3.2.0, `chrome_149` (its newest) | 59 | 29 (49.2%) | 45 (76.3%) | 13 (22.0%) |
| `impers` 0.1.3 | not run: its `koffi` dependency has an install script and pnpm 12 fails the install without an `allowBuilds` entry; it also downloads libcurl-impersonate at first use without a checksum | | | |

- impit read every host any client read; impit and wreq-js differ on 5 hosts (4 to 1 for impit), which one run does not separate.
- On the 26 hosts where the predecessor's curl_cffi had read a price (records 26-60 days old), impit was served on 24 and readable on 19; the 5 unreadable pages were all ones the predecessor read with a site-specific reader. The risk "Node TLS client reads far fewer stores than curl_cffi" is not borne out on these hosts.
- Fingerprints (local capture, equal to tls.peet.ws, one request per client): impit's `chrome151` does not match the predecessor's real Chromium 151 capture (JA4 `t13d1516…806a8c22fdea` against `t13d1518…4980c97edce0`; an extra HTTP/2 SETTINGS 5:16384); wreq-js's `chrome_149` could not be verified (no Chrome 149 capture), its HTTP/2 string equals the Chrome 151-156 captures.
- Proposed: keep impit as the default `HttpTransport` (S§3.3), wreq-js as the swap-in behind the seam (not a per-request second try), impers not adopted under the install policy. Spec edits listed in the report; `docs/spec.md` unchanged.
- Caveats: one run, one day, one IP address; 59 hosts the predecessor's owner chose, Canadian-heavy, hard cases on purpose; URLs 26-60 days old; readable means structured data only; the predecessor had no HTTP cell, so curl_cffi is compared through its playbook and priced reads; impit and wreq-js also differ in the OS their headers claim.
- Image unchanged (lab excluded): pull 88.0 MB of 110. Registry tarballs suggest about 5 MB of pull for impit's addon and 4 MB for wreq-js's per architecture.
- Raw results (uncommitted) in `lab/out/transport/` on the owner's machine.


**Decision (orchestrator, for the owner to confirm at the phase report).** `impit` with its `chrome151` profile is the default `HttpTransport`, as S§3.3 already had it; `wreq-js` is the swap-in behind the seam; `impers` is not adopted, because it cannot be installed without an install-script exception and downloads its native library at first use without a checksum. The headline counts were recounted by the orchestrator from the raw result files (59 hosts; readable 26, 31 and 29; walls 19, 10 and 13; 60, 59 and 61 requests). Spec edits: S§3.3 (the HTTP fingerprint row), S§5.1 (the fingerprint check at each client upgrade), S§5.14 (the per-platform addon). The plan's "31 of 42" is the predecessor's best browser cells, not `curl_cffi`: the predecessor's lab had no HTTP cell. Raw results are kept, uncommitted, in `lab/out/transport/`.

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
