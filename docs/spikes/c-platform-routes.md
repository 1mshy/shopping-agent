# Spike C: platform route reachability

Plan P0 workstream 5, spike C · run 2026-11-17 · harness `lab/routes/` · status: **decision proposed, owner to confirm**

## Question, and what it sizes

The spec plans to read shops through keyless platform routes and to search inside a known shop through them (S§5.2): Shopify `/products/<handle>.js` and `search/suggest.json`, the WooCommerce Store API, Magento GraphQL, and SearchAction / OpenSearch templates on the home page. Plan P0 spike C asks for a probe of about 200 domains per platform "to size the reader and directory routes". The answer feeds Phase 1 workstream 3 (store directory: host fingerprint and the in-store search routes) and the order of S§5.2 "Search inside a known shop".

The question measured here is narrow: **for a sampled host of each platform, does the route answer a plain, honest, paced GET with the documented payload shape?** It does not measure whether the answer is a correct product match, price correctness, the market prefix, or anything about product pages.

## Method

**Sample.** Four committed lists of 200 hosts each under `lab/routes/sample/` (800 hosts), drawn from the Common Crawl URL index of crawl CC-MAIN-2026-43 (captures 2026-10-05 to 2026-10-18), built on 2026-11-17 with seed 20261117. Selection rules (full detail in `lab/routes/sample/README.md`):

| List | Rule |
|---|---|
| `shopify` | a Shopify storefront URL (`/products/…`, `/collections/…`) in Common Crawl, and DNS resolving into Shopify's 23.227.38.0/24 |
| `woocommerce` | WooCommerce permalink bases, add-to-cart links or the plugin path in Common Crawl |
| `magento` | Magento controller routes, the Magento 2 static path or store parameters in Common Crawl (200 of a pool of only 217) |
| `searchaction` | any other shop-like host (cart, shop, product path segments), not in the three platform pools |

The lists were used as committed; no host was added, removed or re-probed.

**Probe per route** (paths, parameters and response shapes are cited in `lab/routes/routes.ts` and `discover.ts`; each validator checks the documented shape, never the status code):

| List | Route | Request | Documentation |
|---|---|---|---|
| all | robots.txt | `GET /robots.txt`, first; its final origin is used for the routes | RFC 9309 |
| woocommerce | `woo_store_search` | `GET /wp-json/wc/store/v1/products?search=a&per_page=1` | developer.woocommerce.com, Store API products |
| shopify | `shopify_suggest` | `GET /search/suggest.json?q=a&resources[type]=product&resources[limit]=1` (root locale) | shopify.dev, Ajax API predictive search |
| shopify | `shopify_product_js` | `GET /products/<handle>.js`, handle from the suggest answer, else from the first `/products/` link on the home page | shopify.dev, Ajax API product |
| magento | `magento_graphql` | `GET /graphql?query={products(search:"set",pageSize:1){total_count items{name sku url_key price_range{…}}}}` | developer.adobe.com, GraphQL `products` query, caching (GET) and headers pages |
| searchaction | `home_searchaction` | `GET /`, JSON-LD and microdata `SearchAction` with a `{placeholder}` target | schema.org SearchAction |
| searchaction | `opensearch` | the OpenSearch description, only if the home page links one on the same site | OpenSearch 1.1 draft 6 |

The Magento probe was changed before the run from a `price >= 0` filter to the product *search* S§5.2 will use, with one fixed term (`set`, 3 characters because Magento's default minimal query length is 3). A valid answer with zero items counts as `empty`: the route answers. "Answers" below means `ok + empty`.

**Limits** (enforced in code, unchanged from part 1, checked in `run.ts`, `http.ts`, `pacer.ts` and `guard.ts`): at most 5 requests per host, with robots.txt, redirect hops and the single retry after a network error all counted; one request in flight per host; 2.5-3.25 s between request starts to a host; at most 12 requests in flight overall; 15 s timeout including the body; 3 MiB body cap; 3 redirect hops, each re-checked by the guard; GET only; first request `https://`; private, loopback, link-local, CGNAT, metadata and reserved addresses refused; off-site redirects not followed.

**Client.** Node 26.2.0's own `fetch` (undici), with no TLS or header impersonation. Every request sent one fixed User-Agent, `agentic-dasher-lab/0.1 (route reachability probe)`, and nothing about the person running it.

**Run.** One run, from one IP address (the machine that ran the spike), on 2026-11-17: command `node lab/routes/run.ts --out lab/out/routes/full`, started 17:57:51Z, finished 18:03:44Z (5 min 53 s), no interruption, exit code 0. **800 hosts, 1,840 HTTP requests.** Most requests to one host: 5 (1 host); the cap was never exceeded. The first 100 results were checked during the run: 236 requests, at most 4 to a host, no `wall` and no `rate_limited`, one User-Agent, no repeated host.

| Requests to a host | 0 | 1 | 2 | 3 | 4 | 5 |
|---|--:|--:|--:|--:|--:|--:|
| Hosts | 3 | 19 | 544 | 204 | 29 | 1 |

(0 requests: DNS failed in the guard before any connection.)

**Raw results** are not committed. They are on the machine that ran the spike, under the worktree it ran in: `.claude/worktrees/agent-acd91586d4e9f71e1/lab/out/routes/full/*.jsonl` (as probed) and `…/lab/out/routes/full-reclassified/*.jsonl` (after the offline re-classification below), with the summariser output next to them. Every number below is from `node lab/routes/summarise.ts` on those files.

## Results

All tables are after the offline re-classification described under "Classification review"; only the Magento row changed (before and after are given there). Percentages are of the row's n.

### Outcomes per list and route

| list | route | n | answers (ok+empty) | ok | empty | wall | login_required | payment_required | forbidden | client_error | not_found | not_platform | off_site_redirect | invalid_payload | server_error | network_error | skipped |
|---|---|--:|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| shopify | shopify_suggest | 200 | 184 (92.0%) | 180 (90.0%) | 4 (2.0%) | 0 | 1 (0.5%) | 1 (0.5%) | 0 | 10 (5.0%) | 0 | 0 | 0 | 0 | 0 | 4 (2.0%) | 0 |
| shopify | shopify_product_js | 200 | 190 (95.0%) | 190 (95.0%) | 0 | 0 | 0 | 0 | 0 | 0 | 1 (0.5%) | 0 | 0 | 0 | 0 | 4 (2.0%) | 5 (2.5%) |
| woocommerce | woo_store_search | 200 | 157 (78.5%) | 143 (71.5%) | 14 (7.0%) | 0 | 2 (1.0%) | 0 | 2 (1.0%) | 0 | 17 (8.5%) | 7 (3.5%) | 0 | 3 (1.5%) | 6 (3.0%) | 6 (3.0%) | 0 |
| magento | magento_graphql | 200 | 72 (36.0%) | 60 (30.0%) | 12 (6.0%) | 5 (2.5%) | 3 (1.5%) | 0 | 18 (9.0%) | 0 | 50 (25.0%) | 16 (8.0%) | 3 (1.5%) | 14 (7.0%) | 12 (6.0%) | 7 (3.5%) | 0 |
| searchaction | home_searchaction | 200 | 63 (31.5%) | 63 (31.5%) | 0 | 1 (0.5%) | 0 | 0 | 0 | 0 | 114 (57.0%) | 0 | 3 (1.5%) | 0 | 1 (0.5%) | 18 (9.0%) | 0 |
| searchaction | opensearch | 200 | 1 (0.5%) | 1 (0.5%) | 0 | 1 (0.5%) | 0 | 0 | 0 | 0 | 176 (88.0%) | 0 | 3 (1.5%) | 0 | 1 (0.5%) | 18 (9.0%) | 0 |

`rate_limited` and `refused_by_policy` did not occur (0 of 1,200 route rows). For `home_searchaction`, `not_found` means the home page was read and carries no SearchAction template; for `opensearch`, that the page links no description. The OpenSearch row's `wall`, `off_site_redirect`, `server_error` and `network_error` are inherited from the home page (not a second request).

### Platform lists with the wrong-platform hosts taken out

Two separate figures, labelled by their denominators. "not_platform excluded": hosts whose route did not come back `not_platform`. "Confirmed platform": hosts with positive evidence of the list's platform (any route answered, or a platform header, cookie name or page marker on any stored answer from the host, robots.txt included).

| list | route | n | not_platform (wrong-platform rate) | n, not_platform excluded | answers | n, confirmed platform | answers |
|---|---|--:|---|--:|---|--:|---|
| shopify | shopify_suggest | 200 | 0 (0.0%) | 200 | 184 (92.0%) | 196 | 184 (93.9%) |
| shopify | shopify_product_js | 200 | 0 (0.0%) | 200 | 190 (95.0%) | 196 | 190 (96.9%) |
| woocommerce | woo_store_search | 200 | 7 (3.5%) | 193 | 157 (81.3%) | 185 | 157 (84.9%) |
| magento | magento_graphql | 200 | 16 (8.0%) | 184 | 72 (39.1%) | 144 | 72 (50.0%) |

The 4 Shopify hosts without confirmation are the 4 TLS handshake failures (DNS points at Shopify, no certificate is served). Of the 16 Magento `not_platform` hosts, 4 show Shopify and 1 WordPress; 11 show no platform.

**Magento generation (approximate, a heuristic on stored evidence, not part of the summariser).** Magento 2 evidence = an `x-magento-*` header, a `mage-cache-sessid` cookie, a Magento 2 path or script in a stored snippet, or any GraphQL answer or GraphQL error. Magento 1 evidence = a `frontend` cookie or `/skin/frontend/` in a snippet, and no Magento 2 evidence.

| Magento list, by evidence | n | GraphQL answers | other outcomes |
|---|--:|---|---|
| Magento 2 | 100 | 72 (72.0%) | server_error 10, not_found 10, invalid_payload 4, forbidden 2, login_required 2 |
| Magento 1 | 30 | 0 (0.0%) | not_found 28, invalid_payload 2 |
| neither | 70 | 0 (0.0%) | forbidden 16, not_platform 16, not_found 12, invalid_payload 8, network_error 7, wall 5, off_site_redirect 3, server_error 2, login_required 1 |

The Magento 2 row counts every answer by construction (an answer is Magento 2 evidence), so its 72.0% is an upper reading; it says that on 28 of the 100 hosts with Magento 2 evidence the search did not answer.

### Notable failure classes (from the stored evidence)

- **Shopify `suggest.json` and the buyer locale.** All 10 `client_error` rows (10 of 200, 5.0%) are HTTP 417 `{"description":"Unsupported buyer locale"}`, on 3 `.jp`, 3 `.co.il` and 4 `.com` hosts. Shopify documents this: predictive search answers only for 45 listed languages (Japanese, Hebrew and Arabic are not among them) and returns 417 otherwise; a `<script id="shopify-features">` tag on the storefront carries a `predictiveSearch` boolean. On 7 of these 10 hosts `/products/<handle>.js` still answered with a handle taken from the home page; on 3 the home page had no product link.
- **Shopify handle source.** The product route got its handle from `suggest.json` on 180 hosts (all 180 answered) and from the home page on 11 (10 answered, 1 `not_found`); 5 hosts gave no handle (`skipped`), and 4 were TLS failures.
- **WooCommerce.** 17 `not_found` (8.5%) are WordPress answering `rest_no_route`: the REST API is there but the Store API v1 route is not. 2 `login_required` are REST APIs restricted to logged-in users; 6 `server_error` are 500s from WordPress (4 "critical error") or WooCommerce (2) on the route.
- **Magento.** Besides Magento 1 hosts, 12 `server_error` are 5xx or GraphQL internal errors (two of them "No alive nodes found in your cluster", the search engine behind the shop being down); 3 `invalid_payload` are an older Magento 2 schema without `price_range` on `ProductInterface`; 2 `forbidden` are Magento itself refusing ("GraphQL is disabled.", and a 403 with "Syntax Error: Unexpected <EOF>", i.e. the query did not arrive).
- **SearchAction.** Templates were found on 63 of the 177 home pages read (35.6%; 63 of 200 hosts in the list, 31.5%). The template shapes: WordPress-style `?s=` on 37 (one with `post_type`), a `q=` parameter on 22, other on 4. By platform signals on the same page: WordPress 39, Shopify 21, neither 3. Across all 177 home pages read in this list, 70 show WordPress, 31 Shopify, 1 Magento and 75 none.
- **OpenSearch.** 1 of 200 (0.5%).

### Walls

7 route rows on 6 of 800 hosts, all classified by an explicit signal (no title-only wall):

| list | route | vendor / mode | rows | signal |
|---|---|---|--:|---|
| magento | magento_graphql | cloudflare / challenge | 3 | `cf-mitigated: challenge` on a 403 |
| magento | magento_graphql | cloudflare / block | 1 | title "Attention Required! \| Cloudflare" on a 403 |
| magento | magento_graphql | vercel / challenge | 1 | `x-vercel-mitigated: challenge` on a 429 JSON answer |
| searchaction | home_searchaction | cloudflare / challenge | 1 | `cf-mitigated: challenge` on a 403 |
| searchaction | opensearch | cloudflare / challenge | 1 | inherited from the walled home page |

No `rate_limited` outcome occurred. These counts are for a plain client on a crawler-permissive sample (see "Limits and biases").

## robots.txt (`report` mode)

robots.txt was fetched and parsed for every host, probed anyway, and each route recorded what `respect` would have done for the token `agentic-dasher-lab` (in practice the `*` group). Fetch states per list: Shopify parsed 196, unreachable 4; WooCommerce parsed 192, absent (4xx) 3, unreachable 5; Magento parsed 166, absent 21, no verdict 5, unreachable 8; SearchAction parsed 171, absent 8, no verdict 2, unreachable 19.

| list | route | n | `respect` would refuse | by a rule | by an unreachable robots.txt (5xx or network error) | refused but the route had answered | no verdict | answers | answers `respect` would keep |
|---|---|--:|---|--:|--:|--:|---|---|---|
| shopify | shopify_suggest | 200 | 10 (5.0%) | 6 | 4 | 5 | 0 (0.0%) | 184 (92.0%) | 179 (89.5%) |
| shopify | shopify_product_js | 200 | 0 (0.0%) | 0 | 0 | 0 | 9 (4.5%) | 190 (95.0%) | 190 (95.0%) |
| woocommerce | woo_store_search | 200 | 14 (7.0%) | 9 | 5 | 8 | 0 (0.0%) | 157 (78.5%) | 149 (74.5%) |
| magento | magento_graphql | 200 | 40 (20.0%) | 32 | 8 | 19 | 5 (2.5%) | 72 (36.0%) | 53 (26.5%) |
| searchaction | home_searchaction | 200 | 19 (9.5%) | 0 | 19 | 0 | 2 (1.0%) | 63 (31.5%) | 63 (31.5%) |
| searchaction | opensearch | 200 | 0 (0.0%) | 0 | 0 | 0 | 23 (11.5%) | 1 (0.5%) | 1 (0.5%) |

Over the 1,200 route rows: `respect` would have refused 83 probes, 47 by a rule and 36 because robots.txt was unreachable; 32 of the 83 had in fact answered, and all 32 of those were refused by a rule. None of the 36 refusals from an unreachable robots.txt was on a route that answered: those hosts were down for the route too. The rule text itself is not stored, so which rule refused a route is not known; the Magento refusals (32 by a rule, 19 of them on routes that answered) are the largest group. "No verdict" covers a robots.txt behind a challenge, off-site, or not reached, and routes not requested.

**This is a lower bound.** The sample comes from Common Crawl, whose crawler obeys robots.txt: hosts that block it, or block the paths the list signatures look for, cannot be in these lists. A sample of hosts the user never named, found some other way, would be refused more often.

## Classification review

Every non-success bucket was read from stored evidence only (no request): all rows where a bucket had 30 or fewer, a seeded sample of 15 otherwise, per route for `not_found`. Judged against the outcome definitions in `lab/routes/README.md`, before any fix:

| bucket | rows | read | correct | wrong, and what they really were |
|---|--:|--:|--:|---|
| wall | 7 | 7 | 7 | - (6 by `cf-mitigated` / `x-vercel-mitigated` / the Cloudflare block title; 1 inherited) |
| rate_limited | 0 | 0 | - | - |
| login_required | 5 | 5 | 5 | - (2 WordPress REST restricted, 2 HTTP auth on `/graphql`, 1 Shopify 401) |
| payment_required | 1 | 1 | 1 | - ("Unavailable Shop") |
| forbidden | 20 | 20 | 20 | - (plain 403s; 2 are Magento refusing GraphQL; 2 have no server header and `retry-after: 0`, possibly a CDN WAF, but with no vendor signal the rule says `forbidden`) |
| client_error | 10 | 10 | 10 | - (all Shopify 417 "Unsupported buyer locale") |
| not_found | 353 | 61 | 61 | - (Magento 15, Woo 15, home 15, OpenSearch 15, product 1) |
| not_platform | 28 | 28 | 23 | 5 were Magento: 4 serve Magento's own error-processor 404 page (`<base href=".../errors/default/">`, HTML-escaped), 1 shows that page on its robots.txt answer. Really `not_found`. |
| off_site_redirect | 9 | 9 | 9 | - |
| invalid_payload | 22 | 22 | 16 | 4 were GraphQL internal errors in a 200 answer (really `server_error`); 1 was a redirect to Magento's `/customer/account/login/` (really `login_required`); 1 is uncertain: a 200 page titled "Access Blocked" with no vendor signal, a block page of some kind, but bot wall or geo-block is not in the evidence (left as `invalid_payload`) |
| server_error | 16 | 16 | 16 | - |
| network_error | 57 | 15 | 15 | - (TLS certificate, handshake, DNS, refused, timeout) |
| skipped | 5 | 5 | 5 | - (no handle found) |

The 16 correct `invalid_payload` rows are, by the definition "2xx with the wrong shape": 3 older Magento GraphQL schemas, 3 soft 404s on Magento hosts (one redirecting `/graphql` into site search), 3 hosts of one non-Magento florist platform serving their home page, 2 parked domains, 1 suspended account, 2 other home pages served for the route, and 2 empty bodies. For sizing they mean "no usable route", like `not_found`.

robots.txt answers were read the same way: 2 robots.txt answers were challenges served with 403 (Cloudflare) and 429 (Vercel) and had been recorded as "absent, allow all"; the harness's own rule says a challenge served as robots.txt gives no verdict.

**Fixes** (each with a test in `lab/routes/*.test.ts`, then applied offline by `node lab/routes/reclassify.ts`, which re-runs the classifier on the stored evidence):

1. Magento's error-processor page (`<base href=".../errors/<skin>/">`, plain or HTML-escaped) is Magento evidence.
2. A 404 on a host whose robots.txt answer shows the platform is `not_found` (signal `host:platform:<name>`).
3. A GraphQL error of category `internal`, or "Internal server error", in a 2xx answer is `server_error`.
4. A final URL at Magento's `/customer/account/login` is `login_required`.
5. A challenge served as robots.txt gives no verdict at any status, not only 2xx.

The re-classification changed exactly 12 records and reproduced every other outcome of the 1,200 route rows and 800 robots.txt records from the stored evidence: 5 Magento `not_platform → not_found`, 4 `invalid_payload → server_error`, 1 `invalid_payload → login_required`, and 2 robots.txt `absent → unknown` (no verdict). Before and after, Magento row (the other rows did not change):

| magento_graphql, n = 200 | answers | wall | login_required | forbidden | not_found | not_platform | off_site_redirect | invalid_payload | server_error | network_error |
|---|---|---|---|---|---|---|---|---|---|---|
| before | 72 (36.0%) | 5 (2.5%) | 2 (1.0%) | 18 (9.0%) | 45 (22.5%) | 21 (10.5%) | 3 (1.5%) | 19 (9.5%) | 8 (4.0%) | 7 (3.5%) |
| after | 72 (36.0%) | 5 (2.5%) | 3 (1.5%) | 18 (9.0%) | 50 (25.0%) | 16 (8.0%) | 3 (1.5%) | 14 (7.0%) | 12 (6.0%) | 7 (3.5%) |

| Magento, derived figures | before | after |
|---|---|---|
| wrong-platform rate (not_platform) | 21 of 200 (10.5%) | 16 of 200 (8.0%) |
| answers, not_platform excluded | 72 of 179 (40.2%) | 72 of 184 (39.1%) |
| answers, confirmed platform | 72 of 137 (52.6%) | 72 of 144 (50.0%) |
| robots.txt: absent / no verdict | 23 / 3 | 21 / 5 |
| robots counterfactual: no verdict | 3 (1.5%) | 5 (2.5%) |

The "confirmed" before figure is the summariser's first output on the run; the after figure also uses fix 1 for the platform evidence. A marker rule can be applied offline only where it shows in the stored 300-character snippet; that held for all 5 Magento error pages here.

## Limits and biases

- **One run, one day, one IP address, a plain client.** 2026-11-17, a single address, Node `fetch` with no TLS or header impersonation and an honest bot User-Agent. A different day, address, or client (spike A) can give other numbers, in either direction. A wall rate here is a property of this client and this sample, not of the shop.
- **Sample from Common Crawl.** The draw is clustered: 60 chunks of adjacent reversed host names, so the effective sample is smaller than 200 per list, and TLDs that fell in a chunk are over-represented (Shopify `.com` 105, `.au` 24; Woo `.com` 82, `.au` 17, `.il` 16; Magento `.com` 53, `.de` 23, `.nl` 20; SearchAction `.com` 92, `.au` 19). Hosts with more captured URLs (bigger catalogues) were more likely to be drawn. The crawler obeys robots.txt, so robots-restrictive and crawler-hostile hosts are under-represented, and large retailers are rare.
- **Magento list.** 200 of a pool of only 217 signature hosts, so it is close to the whole pool rather than a draw from a large one, and the signature matches Magento 1 (end of life, no GraphQL) as well as Magento 2: at least 30 hosts carry Magento 1 evidence.
- **Shopify list** is DNS-confirmed, so its 0 `not_platform` is by construction and stores fronted by their own CDN are missing.
- **No Shopify market prefix.** Both Shopify routes used the root locale; S§2 invariant 3 requires the market prefix, which may change both the 417 locale failures and the answers.
- **The Woo and Shopify search term is `a`; the Magento term is `set`.** `empty` (Woo 14, Shopify 4, Magento 12) says the route answers, not that the shop's search is useful.
- **The guard does not pin the connection** to the address it checked (`fetch` resolves the name again). A same-site redirect from `https` to `http` is followed; this happened on 1 of 800 hosts.
- **Walls were classified without real saved pages to test against** (the ported wall fixtures of P0 workstream 3 are not in `main`); every wall here rests on an explicit header or the Cloudflare block title, and the review above read all of them.
- **The classifier was corrected after the run** from stored evidence (five rules, 12 records); before and after are both given above. The review had one reviewer, who also wrote the fixes, and read samples of 15 where a bucket was larger than 30.
- **Not measured:** UCP `search_catalog`, `/.well-known/ucp`, sitemaps, `llms.txt`, product pages, prices, relevance of search results, latency (the stored timings include pacing waits), and the Woo Store API on the general shop-like list.

## Decision (proposed)

The measurement is above; what follows is the author's recommendation, for the owner and the orchestrator to accept or change.

1. **Keep platform JSON as the first keyless in-store search route after UCP, in the order Shopify, WooCommerce, Magento** (S§5.2). On these samples, from a plain client, Shopify answered on 184 of 196 confirmed hosts for `suggest.json` and 190 of 196 for `/products/<handle>.js`; the Woo Store API on 157 of 185 confirmed hosts; Magento GraphQL search on 72 of 144 confirmed hosts. All three are worth building in Phase 1 workstream 3. The data does not rank UCP, which was not probed.
2. **Shopify: handle the documented 417.** `suggest.json` refuses buyer locales outside its 45 supported languages (10 of 200 here). The host fingerprint can read the `predictiveSearch` flag in the storefront's `shopify-features` script from the home page it already fetches, and in-store search should go to the next route on 417 instead of counting the store as unsearchable. `/products/<handle>.js` as the reader is supported by the numbers.
3. **Magento: GraphQL search is a Magento 2 route, and only half of the confirmed Magento hosts answer it.** The fingerprint should record the Magento generation and skip GraphQL on Magento 1 (0 answers on 30 hosts with Magento 1 evidence). Expect `server_error` (search backend down), older schemas (ask for the fields every 2.x version has, or fall back on a schema error) and refusals; on such hosts the next route (SearchAction template or `site:` search) carries the search. The Magento sample is nearly the whole Common Crawl pool and is weak evidence on its own.
4. **SearchAction / OpenSearch: keep as a free by-product of the home-page fetch, not as a route worth its own work.** A template was found on 63 of 177 home pages read, but 60 of those 63 pages show WordPress (39) or Shopify (21): on Shopify the platform routes come first, and whether the WordPress hosts run WooCommerce was not probed on this list. Most templates are site search (`?s=`, `q=`) that returns HTML, not a product payload. OpenSearch was found on 1 of 200 hosts. The data does not support investing in OpenSearch beyond reading the link when it is there.
5. **Plain client is enough for these routes on this sample.** Walls on 6 of 800 hosts and no rate limiting say the `api` rung of S§5.1 can start without an impersonating client for platform JSON. This says nothing about product pages or about hosts the crawler never saw.
6. **The data does not support** a claim about any platform as a whole, about robots-restrictive shops, about the market prefix, or about search quality.

**Spec edits I would make** (not made; `docs/spec.md` is unchanged, the owner or orchestrator decides):

- S§5.2 "Search inside a known shop": after "Shopify `suggest.json` under the market prefix", add: "(predictive search answers only for its supported buyer languages and returns 417 otherwise; the fingerprint records the storefront's `predictiveSearch` flag, and a 417 moves the search to the next route)".
- S§5.2 same sentence: "Magento GraphQL" becomes "Magento GraphQL `products(search:)` sent as GET (Magento 2 only; skipped on Magento 1)".
- S§5.2 "Host fingerprint": "platform probe" becomes "platform probe (including the Magento generation and Shopify's predictive-search flag)".
- S§5.2 same sentence, optional: "SearchAction/OpenSearch on the home page" stays, with "(read from the home page already fetched; no request of its own unless an OpenSearch description is linked)".
- S§5.1 "robots.txt": add "A challenge page served as robots.txt, whatever its status, gives no verdict." (the rule this review added to the lab).
- Plan, spike and risk register (not the spec): spike C retires "keyless platform routes answer often enough to build on" for Shopify and WooCommerce on these samples; it leaves Magento open and adds "market prefix untested" to Phase 1 workstream 3.

## Note for owner decision 4 (S§9: robots.txt public default)

Measured only, no recommendation. On these samples, which come from a robots-obeying crawler and so understate refusals: a `respect` setting would have refused 83 of 1,200 route probes, 47 by a robots.txt rule and 36 because robots.txt was unreachable (5xx or network error, which RFC 9309 treats as disallow-all); 32 of the 83 refused probes had answered, all of them refused by a rule. Per route, `respect` would have kept 179 of 184 Shopify suggest answers, 190 of 190 Shopify product answers, 149 of 157 WooCommerce answers, 53 of 72 Magento answers, and all 63 SearchAction answers and the 1 OpenSearch answer. Magento GraphQL is the route `respect` would cost most (19 of 72 answers).
