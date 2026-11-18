# Spike A: HTTP transport lab

Plan P0 workstream 5, spike A · run 2026-11-18 · harness `lab/transport/` · status: **decision proposed, owner to confirm**

## Question

S§5.1's `http` rung reads shop pages with an impersonating client before any browser is used ("User-Agent and client hints come from the TLS profile and are never set by hand"). S§3.3 names `impit` as the client, with `impers` (curl-impersonate) and `wreq-js` as fallbacks, "default chosen by the Phase 0 lab". The plan asks spike A to read the predecessor's lab stores and about 30 playbook hosts over HTTP only with the three clients, pick the default `HttpTransport`, and check each client's JA4 and HTTP/2 fingerprint against a capture of the Chrome version it claims. The risk register asks whether a Node TLS client "reads far fewer stores than curl_cffi did".

Measured here, narrowly: **for one product URL per host, does one plain GET (redirects followed by hand) from each client return a page that carries a usable price in structured data?** Not measured: search, cookies or sessions, retries over time, the browser rung, price correctness.

## Method

**Hosts: 59**, built by `lab/transport/hosts/build-hosts.ts` from the predecessor's own records and committed as `lab/transport/hosts/hosts.json` (rules and counts in `lab/transport/hosts/README.md`). Predecessor copy: `~/Documents/GitHub/hermes-shopping`, branch `browser-agent`, commit `51db126` plus uncommitted files (the owner has not confirmed this copy).

| Source | Hosts | Product URL |
|---|--:|---|
| The browser lab's 42 stores (`scripts/browser-lab/stores.json`) | 34 | the product page the lab (2026-10-16) opened and read a price on, most frequent after canonicalisation (33); for `ebayca`, whose lab run only reached search results, the engine's newest priced read in `reports/` (1) |
| … excluded | 8 | no priced product page on record: `digikeyca`, `mouserca`, `raspberrypi`, `techcitycanada`, `graingerca`, `sandisk`, `futuretechs`, `braultmartineau` |
| The playbook (`data/fetch_playbook.json`, 125 hosts, 99 not lab stores) | 25 | the newest URL on that host with a price the predecessor's engine read, from `reports/*.json`. The other 74 have no priced product URL on record and were left out (the plan asked for about 30) |

From the playbook file only host names, strategies (`http`, `browser`, `blocked`) and their dates were taken; nothing else in `data/` was opened. URLs were canonicalised (search-position, ad and analytics parameters dropped).

**The predecessor had no HTTP cell in its browser lab.** Its cells were all browsers (`cells.json`: H0-H6, E0-E4, E0P2, HP, EP), and the plan's "31 of 42" is the price count of its best browser cells (H2, H6, E4), not of curl_cffi. The curl_cffi comparison below therefore uses the two records the predecessor did keep per host: the playbook strategy (`http` = its curl_cffi GET, profile `PW_IMPERSONATE`, default `chrome`, returned a usable page the last time the host was recorded; per host, not per page kind) and the rung of its newest price read in `reports/` (`http:json-ld`, `browser:selector`, …).

**Readable** (`lab/transport/readable.ts`), decided on the body, never on the status: the page carries a positive price in one of S§5.2's reader rungs short of the browser: JSON-LD (a Product-family node, or an Offer with `itemOffered`, and an offer with `price`, `lowPrice`, `highPrice` or `priceSpecification.price`; an untyped `offers` object counts), microdata (a schema.org Product/Offer `itemtype` and an `itemprop="price"` or `lowPrice` with a number), OpenGraph `product:price:amount` / `og:price:amount`, or Shopify's storefront `meta.product` variant price. No currency, variant or product-identity check. The predecessor's lab counted a page as read when its engine's extractor found a price, which also tried site-specific CSS selectors, XPath recipes and Next.js data; that is broader, not stricter, so this criterion stands on its own and is the same for every client. Failures are classified by spike C's classifier (`lab/routes/classify.ts`, imported unchanged) with this criterion as its validator: a 2xx page without price markup and without wall evidence is spike C's `invalid_payload`, reported here as **served, no price markup**.

**Clients** (each imported in exactly one adapter under `lab/transport/clients/`; no User-Agent, client hint or TLS option set on an impersonating client):

| Client | Library | Profile | Notes |
|---|---|---|---|
| `fetch` (baseline) | Node 26.2.0 `fetch`, undici 8.3.0 | none | spike C's User-Agent `agentic-dasher-lab/0.1 (route reachability probe)` |
| `impit` | `impit` 0.14.9 (Apify; Rust reqwest + patched rustls) | `chrome151` (the plan's profile) | the profile claims Windows; HTTP/3 off (default); no cookie jar |
| `wreq` | `wreq-js` 3.2.0 (Rust wreq + BoringSSL) | `chrome_149`, its newest Chrome profile: it ships no `chrome_151` | OS left at the default, `macos`; a standalone `fetch` is an ephemeral session |
| `impers` | `impers` 0.1.3 | — | **not run**: its dependency `koffi` has an install script and pnpm 12 fails the install without an `allowBuilds` entry (see Packaging) |

**Limits** (enforced in code, `lab/transport/run.ts`, `probe.ts`, `get.ts` and spike C's `pacer.ts` and `guard.ts`): GET only; one product URL per host; no cookies in any client; one request in flight per host, 2.5-3.25 s between starts to a host, at most 12 in flight; 15 s timeout including the body; 3 MiB body cap; at most 3 redirect hops, each re-checked by the guard; off-site redirects not followed; one retry after a network error; **per client at most 5 requests per host, per host at most 15** (3 clients × 5). The client order rotates with the host's position in the list (`fetch, impit, wreq`, then `impit, wreq, fetch`, then `wreq, fetch, impit`), so no client always goes first.

**Run.** One run, from one IP address, on 2026-11-18. Pilot: `node lab/transport/run.ts --pilot 6 --out lab/out/transport/pilot` (seed 20261118), 06:29:15Z to 06:29:23Z, 6 hosts, 18 requests. The pilot's evidence was read (all 18 rows); nothing in the probe was changed, so the pilot hosts were not probed again. Full run: `node lab/transport/run.ts --out lab/out/transport/full --skip lab/out/transport/pilot/results.jsonl`, 06:30:18.9Z to 06:30:51.4Z (32 s), 53 hosts, 162 requests, no interruption, exit code 0. The stop rule (more than a third of the first 20 hosts walled or rate limited for every client) did not fire: 6 of the first 20 were walled for every client. **Together: 59 hosts, 180 HTTP requests (fetch 60, impit 59, wreq 61); most to one host 5, most by one client on one host 3; no retry happened.** Requests to a host: 3 on 57 hosts, 4 on 1, 5 on 1. Each client was first on 19 or 20 hosts. Request start times were not recorded; the shortest time a host took for its three requests was 5.3 s, consistent with the 2.5 s gap.

**Raw results** are not committed. They are in `lab/out/transport/` of the worktree that ran the spike and copied to `lab/out/transport/` of the main checkout (git-ignored there): `pilot/` and `full/` (`results.jsonl` as probed, `bodies/<sha256>.gz` every answered body), `reclassified/` (after the review below), `fingerprint/fingerprints.json`, the run logs and the summariser output. Every table below is `node lab/transport/summarise.ts` on `reclassified/*.jsonl`, except where a table says otherwise.

## Results

Percentages are of the row's n. All tables are after the offline re-classification (one row changed; before and after under "Classification review").

### Outcomes per client

| client | n | readable | wall | forbidden | client_error | served, no price markup | requests |
|---|--:|---|---|---|---|---|--:|
| fetch (node 26.2.0, none) | 59 | 26 (44.1%) | 19 (32.2%) | 2 (3.4%) | 1 (1.7%) | 11 (18.6%) | 60 |
| impit (impit 0.14.9, chrome151) | 59 | 31 (52.5%) | 10 (16.9%) | 0 | 1 (1.7%) | 17 (28.8%) | 59 |
| wreq (wreq-js 3.2.0, chrome_149) | 59 | 29 (49.2%) | 13 (22.0%) | 0 | 1 (1.7%) | 16 (27.1%) | 61 |

`rate_limited`, `not_found`, `server_error`, `network_error`, `off_site_redirect`, `refused_by_policy` and `skipped` did not occur (0 of 177 rows). The one `client_error` per client is the same host (`ankeronline`: HTTP 451, a disabled Vercel deployment).

**Served** (readable plus served without price markup, i.e. the client got the shop's page): fetch 37 of 59, impit 48 of 59, wreq 45 of 59 (from the result lines; not a summariser table).

### Readable by host source

| source | n | fetch | impit | wreq | any client |
|---|--:|---|---|---|---|
| lab | 34 | 8 (23.5%) | 12 (35.3%) | 11 (32.4%) | 12 (35.3%) |
| playbook | 25 | 18 (72.0%) | 19 (76.0%) | 18 (72.0%) | 19 (76.0%) |
| all | 59 | 26 (44.1%) | 31 (52.5%) | 29 (49.2%) | 31 (52.5%) |

The lab stores were chosen by the predecessor as hard cases (groups a-c: walled in its Phase 0, known bot-walled stores, hosts its exploration queue could not read). The browser lab read a price on 33 of these 34 URLs on 2026-10-16 (that is how they were chosen; the 34th, eBay's, is from the engine's reports); over HTTP the best client reads 12.

### Walls by vendor

| client | vendor/mode | hosts |
|---|---|--:|
| fetch | cloudflare/challenge | 12 |
| fetch | akamai/block | 2 |
| fetch | datadome/block | 2 |
| fetch | unknown/block | 1 |
| fetch | unknown/challenge | 1 |
| fetch | vercel/challenge | 1 |
| impit | cloudflare/challenge | 6 |
| impit | datadome/block | 2 |
| impit | akamai/block | 1 |
| impit | unknown/challenge | 1 |
| wreq | cloudflare/challenge | 10 |
| wreq | datadome/block | 2 |
| wreq | akamai/block | 1 |

Nine hosts were walled for all three clients: `rona` (Cloudflare for fetch, DataDome for the others), `siboor`, `bhphoto`, `staplesca`, `microcenter`, `simons`, `hobbywholesale.com` (Cloudflare challenge), `adorama` (DataDome), `ebayca` (Akamai 403). The `unknown` vendors are, by their evidence, Akamai (`bestbuyca`: "Access Denied" with Akamai Bot Manager cookie names but no Akamai header) and PerimeterX/HUMAN (`walmart.com`: redirect to `/blocked`, "Robot or human?") for fetch, and Amazon's captcha for impit (`amazonca`); spike C's vendor attribution has no rule for them.

### Pairwise overlap (readable)

| A | B | n | both | only A | only B | neither |
|---|---|--:|--:|--:|--:|--:|
| fetch | impit | 59 | 26 | 0 | 5 | 28 |
| fetch | wreq | 59 | 25 | 1 | 4 | 29 |
| impit | wreq | 59 | 29 | 2 | 0 | 28 |

Hosts exactly one client reads: impit `bmr`; fetch none; wreq none. **Every host any client read, impit read** (31). Where impit and wreq differ (from the result lines): impit read `bmr` (wreq: Cloudflare challenge) and `sameday.costco.ca` (wreq was redirected to the storefront); impit was served and wreq walled by Cloudflare on `memoryexpress`, `neweggca` and `newegg.com`; wreq was served and impit got a captcha on `amazonca` (a page without structured price either way). On discordant hosts (exact two-sided sign test, descriptive only): served, impit 12 vs fetch 1 (p = 0.003), wreq 8 vs fetch 0 (p = 0.008), impit 4 vs wreq 1 (p = 0.38); readable, impit 5 vs fetch 0 (p = 0.06), impit 2 vs wreq 0 (p = 0.5).

### Against the predecessor's curl_cffi on the same hosts

| predecessor record | value | n | fetch readable | impit readable | wreq readable | any client | record dates |
|---|---|--:|---|---|---|---|---|
| newest price read | http | 26 | 17 (65.4%) | 19 (73.1%) | 17 (65.4%) | 19 (73.1%) | 2026-09-19 to 2026-10-23 |
| newest price read | browser | 18 | 5 (27.8%) | 6 (33.3%) | 6 (33.3%) | 6 (33.3%) | 2026-09-19 to 2026-10-23 |
| newest price read | unknown | 2 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 2026-10-23 to 2026-10-23 |
| newest price read | none recorded | 13 | 4 (30.8%) | 6 (46.2%) | 6 (46.2%) | 6 (46.2%) | n/a |
| playbook | http | 31 | 17 (54.8%) | 19 (61.3%) | 17 (54.8%) | 19 (61.3%) | 2026-10-15 to 2026-11-18 |
| playbook | browser | 16 | 5 (31.3%) | 6 (37.5%) | 6 (37.5%) | 6 (37.5%) | 2026-10-17 to 2026-11-16 |
| playbook | blocked | 1 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 2026-10-19 to 2026-10-19 |
| playbook | no entry | 11 | 4 (36.4%) | 6 (54.5%) | 6 (54.5%) | 6 (54.5%) | n/a |

Breaking the "newest price read: http" row down from the result lines (the 26 hosts where curl_cffi read a price):

| on the 26 hosts curl_cffi read | fetch | impit | wreq |
|---|--:|--:|--:|
| readable | 17 | 19 | 17 |
| served, no price markup | 3 | 5 | 5 |
| walled | 6 | 2 | 4 |

impit's 2 walls there are `ebayca` (Akamai 403 for all three clients) and `amazonca` (captcha; fetch and wreq were served). impit's 5 served-but-not-readable pages are `cdwca`, `neweggca`, `3djake.com`, `newegg.com` and `walmart.com`, and on every one of them the predecessor's price had come from a site-specific reader (XPath recipe, CSS selector, Next.js data), not from structured data. On the 19 of the 26 whose predecessor price came from structured data (JSON-LD, microdata, meta), impit read 18, wreq 16, fetch 16. On the 31 playbook `http` hosts, impit was served on 30 (walled on `ebayca`), wreq on 26, fetch on 24.

**Age.** The curl_cffi price reads are 26 to 60 days old (2026-09-19 to 2026-10-23), the playbook entries 0 to 34 days old, the browser lab 33 days. On 8 of the 26 hosts the predecessor's read was on a different URL of the host than the one probed. Sites change, so a difference is not purely the client.

## Fingerprints

Each client's TLS ClientHello and first HTTP/2 frames were captured locally (`lab/transport/fingerprint/`: a TCP front on loopback records the ClientHello and passes it to a TLS server that records the frames; `https://localhost:<port>/`, a self-signed certificate, so certificate checking was off for this one request per client: impit `ignoreTlsErrors`, wreq-js `insecure`, `NODE_TLS_REJECT_UNAUTHORIZED` for fetch). Each client then made **one** request to the public echo service **tls.peet.ws** (`https://tls.peet.ws/api/all`) with checking on, because the predecessor's reference captures came from that service. For all three clients the JA4 and the Akamai HTTP/2 string computed locally equal what tls.peet.ws reported, so the local capture and its JA4 code agree with an independent implementation, and switching certificate checking off did not change them. The echo answer's caller address and TCP/IP block were dropped before storing.

**Reference.** The predecessor's `scripts/browser-lab/fingerprints/` holds tls.peet.ws captures of real browsers from 2026-10-16 (copied, with provenance, to `lab/transport/fingerprint/reference.json`). Chrome 151: `H2.json` (and `H1.json`, identical JA4 and HTTP/2), full **Chromium 151.0.7922.34** on linux/arm64, not Google-branded. There is **no capture of Chrome 149**; the nearest are Chromium 153 (`E2.json`) and Google Chrome 155 (`H6.json`, `E4.json`).

| client | claims | JA4 (local = tls.peet.ws) | HTTP/2 Akamai (local = tls.peet.ws) | reference | result |
|---|---|---|---|---|---|
| fetch | (no profile) | `t13d5212h1_b262b3658495_8e6e362c5eac` | `2:0;4:262144\|458753\|0\|a,m,p,s` | — | n/a. Node 26's fetch offers ALPN `http/1.1, h2` and speaks HTTP/2 when the server picks it |
| impit | Chrome 151, Windows UA | `t13d1516h2_8daaf6152771_806a8c22fdea` | `1:65536;2:0;4:6291456;5:16384;6:262144\|15663105\|0\|m,a,s,p` | Chromium 151 (H2): `t13d1518h2_8daaf6152771_4980c97edce0`, `1:65536;2:0;4:6291456;6:262144\|15663105\|0\|m,a,s,p` | **does not match**: 16 extensions against 18, a different extension and signature-algorithm hash, and an HTTP/2 `SETTINGS_MAX_FRAME_SIZE` (5:16384) that Chrome does not send |
| wreq | Chrome 149, macOS UA | `t13d1516h2_8daaf6152771_d8a2da3f94cd` | `1:65536;2:0;4:6291456;6:262144\|15663105\|0\|m,a,s,p` | none of Chrome 149 | **not verified.** Side by side: its HTTP/2 string equals every Chrome and Chromium capture from 151 to 156 in the reference set; its JA4 equals none of them (151: `…1518…4980c97edce0`; 153-156: `…1517…cb7bf5808d99`) |

From the raw ClientHellos (local capture): impit and wreq-js offer the same 15 cipher suites (JA4 part b `8daaf6152771`, as every Chrome capture) and the same 16 extension types; impit sends **no GREASE values** (wreq-js does, as Chrome does) and puts three signature algorithms (0x0904-0x0906) before Chrome's usual list. impit's JA4 is exactly the one the predecessor captured from Playwright's **headless shell** (H0, headless shell 151.0.7922.34; E0, the engine's headless shell), the two cells with the most walls in its lab (where the shell's JavaScript tells were also at play). Both clients permute their extensions per connection, so raw JA3 hashes differ between captures and are not compared. The local capture's errors (impit `GoAway`, wreq-js "protocol error") come from the capture server closing the connection after the first response; the capture was complete before that.

## Packaging

| | impit 0.14.9 | wreq-js 3.2.0 | impers 0.1.3 |
|---|---|---|---|
| Released | 2026-11-11 | 2026-08-23 | 2026-10-30 ("alpha state", its README) |
| Native code | Rust N-API addon, one prebuilt package per platform as `optionalDependencies` (`impit-<platform>`) | Rust N-API addon, one prebuilt package per platform as `optionalDependencies` (`@wreq-js/binding-<platform>`) | `koffi` (FFI; prebuilt per platform as optional dependencies, plus an `install` script) and **libcurl-impersonate v2.3.2, downloaded at first launch** from the GitHub release into `~/.cache` (or `IMPER_CACHE_DIR`), or `LIBCURL_PATH` |
| Platforms | linux x64/arm64 (glibc and musl), macOS x64/arm64, Windows x64/arm64 | the same plus Android arm64 | libcurl-impersonate builds for linux, macOS, Android and more |
| Installs under pnpm 12's default policy | **yes**, no install script | **yes**, no install script (`prepare` is not run for registry installs) | **no**: `koffi`'s install script is ignored and pnpm 12 fails the install (`ERR_PNPM_IGNORED_BUILDS`, exit 1) for the whole workspace, so it was removed before any commit |
| Size, linux x64 glibc: unpacked / registry tarball | addon 10.6 MB / 4.9 MB, JS 0.2 MB | addon 9.1 MB / 4.0 MB, JS 0.7 MB | koffi 1.8 MB + koffi-linux-x64 2.4 MB, JS 0.6 MB, and the libcurl-impersonate archive 27.8 MB (x86_64-linux-gnu) |
| Size, linux arm64 glibc | addon 8.9 MB / 4.7 MB | addon 8.7 MB / 3.8 MB | koffi-linux-arm64 2.4 MB, archive 26.8 MB |
| On this Mac (darwin-arm64, `du`) | 8.3 MB addon | 7.4 MB addon | not installed |

What impers needs, exactly: an `allowBuilds` entry for `koffi` (`koffi: false` would do: koffi loaded without its script here, from its prebuilt `@koromix/koffi-darwin-arm64`, in a check run before impers was removed), and a decision about libcurl-impersonate: as shipped, impers fetches it from `api.github.com` at first use with no checksum check (`dist/ffi/loader.js`; the release publishes SHA-256 digests, impers does not compare them), and if the download fails it falls back to the system libcurl, which has no impersonation (`resolveLibrary()` order in `dist/ffi/loader.d.ts`; `isUsingImpersonate()` can detect it). For an image it would have to be vendored at build time. None of this was run: impers was never loaded.

**Core image** (budget 110 MB pull, about 22 MB of headroom per `docs/progress.md`): on this branch the image is unchanged, because `lab/` is excluded: `image:budgets` measured pull 88.0 MB, unpacked 278.8 MB, idle container memory 28.0 MB, start to healthy 253 ms, Node RSS at idle 107.6 MB, and the image's `node_modules` holds no impit, wreq, impers or koffi. As a sign of cost, the registry tarballs suggest **about 5 MB of pull for impit and 4 MB for wreq-js** per architecture (gzip of the package; the layer will differ somewhat); the libcurl-impersonate archive alone (27 MB) exceeds the headroom, though how much of it impers keeps was not measured. One more fact for Phase 1: the Dockerfile builds on the build host's platform and keeps one prebuild by `TARGETARCH`, which works for better-sqlite3 because it ships every prebuild in one package; impit and wreq-js ship one package per platform, so the build must install the target platform's package explicitly (for example pnpm's `supportedArchitectures`).

## Classification review

Every non-readable row was read from stored evidence (status, final URL, headers, title, the 300-character snippet, and where needed the stored body), all of them, not a sample: 91 rows. The 86 readable rows were checked for final URL (all 86 on the requested URL, none redirected) and title (all name the product). As probed, before any fix:

| bucket | rows | read | correct | wrong, and what they really were |
|---|--:|--:|--:|---|
| wall | 41 | 41 | 41 | - (28 `cf-mitigated: challenge`; 6 small DataDome 403s with `x-datadome`; 4 Akamai (`AkamaiGHost`): 3 small 403s and 1 "Access Denied" title; 1 "Access Denied" title with Akamai cookie names only; 1 "Robot or human?" title after a redirect to `/blocked`; 1 `x-vercel-mitigated`). Two vendor attributions are `unknown` where the evidence points to Akamai and PerimeterX; spike C's vendor rule has no cookie-name or path rule for them; left as they are |
| served, no price markup | 45 | 45 | 44 | 1 was Amazon's captcha (impit, `amazonca`): status 200, 3.7 KB, title "amazon.ca", no vendor header, a form posting to `/errors_page/validateCaptcha`. Really a wall |
| forbidden | 2 | 2 | 2 | - (fetch only: `tanguay`, a 118-byte 403 from `awselb/2.0`; `th3dstudio.com`, a Cloudflare 403 with only `cf-ray`, which spike C's rule calls `forbidden`. Both are read by impit and wreq) |
| client_error | 3 | 3 | 3 | - (`ankeronline`, HTTP 451 "Deployment unavailable", every client) |

The 44 correct "served" rows: 40 product pages whose price is not in structured data in the raw HTML (client-rendered pages such as `canadiantire`, `sportchek`, `target.com`, `keurig.ca`, `canac`; a price only in site JSON, `bestbuyca`, `homehardware`, `londondrugs` (in a React server-component payload); JSON-LD without a Product, `newegg`; Amazon's full pages, which carry no JSON-LD), 3 rows of a stale URL (`princessauto`, all clients: "Product not found" with status 200, a soft 404) and 1 redirect away from the product (`sameday.costco.ca` for wreq, to the storefront). Borderline, not changed: `walmart.com` has `itemProp="price"` with "$148.98" but no schema.org `itemtype`, so it is not microdata by the criterion; `homehardware` has a non-standard `<meta class="aggregateOffer" content="239.99">`.

**Fix** (test first in `lab/transport/result.test.ts`, applied offline by `node lab/transport/reclassify.ts`, which re-runs the whole classification from the stored bodies): a small (< 64 KiB) HTML answer whose form posts to `/errors/validateCaptcha` or `/errors_page/validateCaptcha` is a wall (vendor `unknown`, mode `challenge`). It matches the form's action path, not body text. It lives in `lab/transport/result.ts`, not in spike C's classifier, which this unit does not edit. Re-classification changed exactly 1 of 177 rows and reproduced every other outcome:

| impit, n = 59 | readable | wall | served, no price markup |
|---|---|---|---|
| as probed | 31 (52.5%) | 9 (15.3%) | 18 (30.5%) |
| re-classified | 31 (52.5%) | 10 (16.9%) | 17 (28.8%) |

fetch and wreq did not change.

## Limits and biases

- **One run, one day, one IP address.** 2026-11-18, about 40 seconds of requests from a single connection (the machine that ran the spike). Bot managers score per IP and over time; another day or address can reorder the clients. One request per client per host: a client that is walled on a first, cookieless request might pass on a second, and the lab never tries.
- **A small host list chosen by the predecessor's owner**, Canadian-heavy, with hard cases on purpose (34 lab stores, groups a-c of which were picked for being walled) and 25 playbook hosts the predecessor had already read. It says nothing about shops in general, and no rate here is a rate for a vendor.
- **Stale URLs.** The product URLs were recorded 26 to 60 days before the run (the lab's on 2026-10-16, the playbook hosts' from reports of 2026-09-19 to 2026-10-23); one was a soft 404 for every client (`princessauto`), and the curl_cffi records they are compared with are of the same age.
- **The readable criterion is structured data only.** 16 to 17 hosts per impersonating client were served a real product page whose price a site-specific reader (or a Next.js / React payload reader) could read. Readability measures transport and reader together; the "served" figure is the transport part.
- **The order rotation** spreads first position evenly (each client first on 19 or 20 hosts), but with three requests to a host 2.5 s apart, a wall triggered by one client can still be charged to the next. Walls by position (first, second, third): fetch 4/20, 6/19, 9/20; impit 2/20, 4/20, 4/19; wreq 5/19, 5/20, 3/20. No first-position penalty is visible; n is small.
- **Profiles differ in more than TLS.** impit claims Windows and wreq-js macOS in their User-Agent and client hints; the lab cannot separate the fingerprint from the headers.
- **No predecessor HTTP cell.** The comparison uses the playbook (per host, any page kind, "usable" meaning not blocked and over 2,000 characters) and the predecessor's priced reads; its `.env` was not read, so a non-default curl_cffi profile cannot be excluded.
- **The guard does not pin the connection** to the address it checked (the clients resolve again), as in spike C.
- **Not measured:** impers (not installed), latency (stored timings include pacing waits), HTTP/3, sessions and cookies across requests, search pages, the browser rung.

## Decision (proposed)

The measurement is above; what follows is the author's recommendation, for the owner and the orchestrator to accept or change.

1. **Default `HttpTransport`: `impit` with the `chrome151` profile, as S§3.3 already says.** On these 59 hosts it read 31 (every host any client read), was served on 48 and walled on 10, the fewest of the three, and it installs under the workspace's default policy with a prebuilt addon of about 5 MB of pull. Its lead over wreq-js is small and not separated by this run (4 hosts served against 1, readable 2 against 0); its lead over plain fetch is clearer (served 12 against 1).
2. **Fallback: `wreq-js` (`chrome_149`), as the swap-in behind the seam, not as a second try per request.** On this run wreq-js was never served a host impit was not, except Amazon's page, which has no structured price either way, so trying it after an impit wall would have read 0 more hosts here at the cost of one more request to a host that had just walled us. Its HTTP/2 frames look like Chrome's and impit's do not; that is the reason to keep it ready, not this run's numbers.
3. **`impers`: not a fallback under the current install policy.** It needs an `allowBuilds` entry for `koffi` and downloads its native library from GitHub at first use without a checksum check, falling back to non-impersonating libcurl when that fails; the archive alone is larger than the image's headroom. Whether to make that exception is the owner's call; this spike recommends not to.
4. **The fingerprint check is a finding, not a blocker.** impit's `chrome151` does not match a real Chromium 151 capture in JA4 or in its HTTP/2 SETTINGS, and its JA4 is the headless shell's. It read the most hosts anyway on this run. If bot managers start keying on it, the lead can vanish quickly; keep `lab/transport/fingerprint/` and the probe as the check to repeat before each impit upgrade (about 180 requests, under a minute).
5. **Risk register: "Node TLS client reads far fewer stores than curl_cffi did" is not borne out on these hosts.** Where curl_cffi had read a price (26 hosts), impit was served on 24 and readable on 19; the 5 served-but-unreadable pages were all ones the predecessor had read with a site-specific reader. The gap that remains is readers (structured data only) and walls that defeat every HTTP client (9 of 59 hosts here: Cloudflare challenges, DataDome, Akamai), which belong to the browser rung, as the register's second branch says.
6. **The data does not support** a claim about shops in general, about any bot-manager vendor as a whole, about impers, or about which client would do better on another day or address.

**Spec edits I would make** (not made; `docs/spec.md` is unchanged):

- S§3.3 table, "HTTP fingerprint" row: choice "`impit` (`chrome151`) behind `HttpTransport`; chosen by the Phase 0 lab (spike A, 2026-11-18)"; fallback "`wreq-js`, swapped in behind the seam. `impers` only with an `allowBuilds` entry for `koffi` and a vendored, checksummed libcurl-impersonate (it downloads one at first use)."
- S§5.1, `http` rung: add "The client's JA4 and HTTP/2 fingerprint are checked in the lab against a real capture of the Chrome version its profile claims whenever the client is upgraded; a mismatch is recorded."
- S§5.1, wall classifier: add to the cases it must handle "a captcha page served with status 200 under a generic title (Amazon's `validateCaptcha` form)", and to vendor attribution "Akamai Bot Manager cookie names (`_abck`, `bm_sz`, `bm_s`) and a redirect to `/blocked` (PerimeterX/HUMAN)".
- S§5.14, images: add "The HTTP client's native addon ships as one package per platform; the multi-arch build installs the target platform's package."
- Plan (not the spec): spike A text "with `impit` (chrome151), `impers` and `wreq-js`" gains "(impers could not be installed under the install policy; see the report)"; the risk-register row is retired for these hosts, and the plan's "31 of 42" is attributed to the predecessor's browser cells, not to curl_cffi.

**For spike C's harness (not changed by this unit):** `lab/routes/http.ts#get` is wired to Node's fetch, so the redirect loop was written again in `lab/transport/get.ts` against the seam; a `transport` parameter on `get` would let both labs share it. `vendorOf` in `lab/routes/classify.ts` has no rule for Akamai cookie names or PerimeterX's `/blocked` path, and the wall rule has no case for Amazon's captcha form (handled in `lab/transport/result.ts` for now).
