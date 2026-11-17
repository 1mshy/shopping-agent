# lab/routes: platform route reachability (plan P0 spike C)

A model-free probe that asks, for sampled shops, whether the keyless routes S§5.2 plans to read through actually answer: the WooCommerce Store API, Shopify `suggest.json` and `/products/<handle>.js`, Magento GraphQL, and SearchAction / OpenSearch templates on the home page. The domain lists and how they were built are in [`sample/README.md`](sample/README.md).

**These numbers are for a plain client.** The probe uses Node's own `fetch` (undici) with no TLS or header impersonation. Which impersonating client the product uses is spike A; a wall rate measured here is an upper bound for that client, not a property of the shop.

## Running

```sh
# pilot: a seeded random 10 hosts per list (40 in total)
node lab/routes/run.ts --limit 10 --out lab/out/routes/pilot
# full run (every host in every list); resumable, re-run to continue
node lab/routes/run.ts --out lab/out/routes/full
# tables for the report
node lab/routes/summarise.ts lab/out/routes/full/*.jsonl
# rebuild the domain lists (touches Common Crawl and DNS only, never a shop)
node lab/routes/sample/build-sample.ts --chunks 60 --chunk-blocks 300 --seed 20261117
```

Raw results are JSON lines under `lab/out/` (git-ignored), one `DomainResult` per host: the outcome of each route with its evidence, the robots verdict, the number of requests and the User-Agent. Only the summarised tables go into `docs/spikes/`.

Every request sends one fixed User-Agent, `agentic-dasher-lab/0.1 (route reachability probe)`, which names the tool and carries nothing about the person running it.

## What one host costs

robots.txt is fetched first. It counts against the cap, and the origin it settles on after same-site redirects (for example `https://www.shop.example`) is used for the routes.

| List | Requests | Routes |
|---|---|---|
| woocommerce | 2 | robots, `GET /wp-json/wc/store/v1/products?search=a&per_page=1` |
| magento | 2 | robots, `GET /graphql?query={products(filter:{price:{from:"0"}},pageSize:1){…}}` |
| shopify | 3, or 4 | robots, `GET /search/suggest.json?q=a&resources[type]=product&resources[limit]=1`, `GET /products/<handle>.js`; the handle comes from the suggest answer, or else from the first `/products/<handle>` link on the home page (one more request, counted against the product route) |
| searchaction | 2, or 3 | robots, `GET /` (JSON-LD and microdata SearchAction), then the OpenSearch description only if the page links one on the same site |

Redirect hops and the single retry after a network error also count. **Hard cap: 5 requests per host**, so no host can cost more than 5 whatever it does. The sources for every path, parameter and response shape are cited in `routes.ts` and `discover.ts`.

Choices worth knowing when reading the numbers:

- Woo and Shopify search for `a`, which nearly every catalogue matches. Magento filters on `price >= 0` instead, because Magento refuses search terms shorter than 3 characters by default and no longer term is catalogue-neutral. A valid answer with zero items is `empty`; `ok + empty` is "the route answers".
- Magento GraphQL is sent as GET (the docs allow GET for queries; it is cacheable and needs no POST).
- Shopify routes use the root locale, without the market prefix the product will use (S§2 invariant 3).
- Only `https://` is tried. A host with no TLS shows as a network error.

## Limits enforced in code (S§5.1)

- `pacer.ts`: one request in flight per host; at least 2.5 s between request starts to the same host, multiplied by a 0.85-1.3 jitter and floored at 2.5 s (2.5-3.25 s); at most 12 requests, so 12 hosts, in flight. A `Retry-After` on 429/503 defers the next start to that host by up to 60 s.
- `http.ts`: 15 s timeout per request (body included), 3 MiB body cap, at most 3 redirect hops, each re-checked by the guard.
- `guard.ts`: http/https only, no credentials in the URL, DNS resolved and refused if any address is private, loopback, link-local, CGNAT, metadata, multicast or reserved (IPv4-mapped IPv6 included). Redirects are followed by hand, and a redirect to another site stops with `off_site_redirect` (same site = equal after `www.`, or a subdomain). Known gap: `fetch` resolves the name again, so the connection is not pinned to the checked address. The product guard (Phase 1) pins it.
- `run.ts`: resumable. A host with a line in `<out>/<list>.jsonl` is skipped.

## robots.txt in `report` mode

`robots.ts` fetches and parses robots.txt with `robots-parser`, probes anyway, and records per route what `respect` would have done for the token `agentic-dasher-lab` (in practice the `*` group). Fetch results map per RFC 9309 §2.3.1: 2xx is parsed; 4xx means no robots.txt (allow all); 5xx or a network error means unreachable (disallow all); a challenge page served as robots.txt, an off-site redirect or the cap give `unknown`. The summariser's counterfactual table shows, per route, how many answers `respect` would have given up. This feeds owner decision 4 (S§9).

## Outcomes and the classifier

`outcome.ts` names follow S§5.1 `FetchOutcome`, plus lab-only kinds:

| Outcome | Meaning |
|---|---|
| `ok` / `empty` | The payload has the documented shape, with / without items. Decided by the validator, never by the status code. |
| `wall {vendor, mode}` | A bot wall or challenge (rule below). |
| `rate_limited` | 429 without wall evidence. |
| `login_required` / `payment_required` | 401, a GraphQL authorization error, a Shopify `/password` page / 402. |
| `forbidden` / `client_error` | 403 without wall evidence / other 4xx. |
| `not_found` | 404/410 on a host that shows the platform (Shopify headers, the WordPress API `Link` header or a `rest_*` error, Magento headers or cookies), or a home page without the discovery target. |
| `not_platform` | 404/410 with no sign of the expected platform. It also measures how well the list method picked the platform. |
| `off_site_redirect` | A redirect to another site; not followed. |
| `invalid_payload` | 2xx with the wrong shape and no wall evidence (a soft 404, an older schema). |
| `server_error`, `network_error {code}`, `refused_by_policy {reason}`, `skipped {reason}` | 5xx; DNS/TCP/TLS/timeout; guard, body cap or hop limit; not attempted (cap, no handle, or the host already failed DNS). |

**Wall rule** (`classify.ts`). A wall needs one of: an explicit mitigation header (`cf-mitigated: challenge`, `x-vercel-mitigated`, `x-amzn-waf-action`); a non-404, non-JSON response whose parsed `<title>` equals a known interstitial title (`just a moment...`, `attention required! | cloudflare`, `access denied`, `pardon our interruption`, …) or whose final URL is a known challenge path or host (`/cdn-cgi/challenge-platform/`, `captcha-delivery.com`, `/.well-known/sgcaptcha/`); or a small (< 64 KiB) 403/429/503 HTML response carrying a bot-manager vendor's header or cookie (DataDome, Imperva, PerimeterX, Kasada, AWS WAF, Sucuri, DDoS-Guard, Akamai). Body text is never searched, so "Just a moment" in a loader or "captcha" on a 404 page is not a wall, and a Cloudflare 403 with only `cf-ray` is `forbidden`. The rule has not been checked against saved real pages (the ported wall fixtures of P0 workstream 3 are not in `main` yet), so the wall counts carry that caveat; every result keeps the signals it was classified on, so it can be re-checked.

## Tests

`*.test.ts` run in CI with no external network: the guard, the pacer with fake timers, the classifier, discovery parsing, the summariser's arithmetic, and the whole probe against an in-process server on 127.0.0.1 serving hand-written fixtures (`fixtures/README.md`). Fixtures are test inputs, not evidence about any shop.
