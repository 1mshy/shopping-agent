# lab/catalog: Shopify Global Catalog probe (plan P0 spike B)

**Status: functional check stopped at the profile (2026-11-23).** The profile is published on GitHub raw (S§9 #3) and Shopify refused it: `profile_malformed`, "Invalid content type" (GitHub raw serves `text/plain`). One `search_catalog` request was sent; no search result has been seen. Report: `docs/spikes/b-shopify-catalog.md`.

| File | What |
|---|---|
| `SOURCES.md` | What Shopify's and UCP's docs and terms say, with quotes and dates, and a verdict for every S§5.3 claim. Read §8 first. |
| `agent-profile.json` | Agent profile, served from jsDelivr pinned to the tag `agent-profile-v1`: `https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@agent-profile-v1/lab/catalog/agent-profile.json` (accepted by Shopify 2026-11-23). GitHub raw is refused (`text/plain`). A change needs a new tag. |
| `client.ts` | `search_catalog` probe client: raw `fetch`, typed result or typed error, latency and rate-limit headers. |
| `run.ts` | Live runner; `--functional-check` is the run chosen on 2026-11-23. |
| `fixtures.ts` | **Synthetic** payloads for tests, shaped after documented examples. Not evidence of live behaviour. |
| `*.test.ts` | Vitest; no external network (a local server on 127.0.0.1). |

## The draft profile

It follows the documented structure (`ucp.version`, `ucp.services`, `ucp.payment_handlers`, plus the catalog capabilities Shopify asks for: `dev.ucp.shopping.catalog.search`, `dev.ucp.shopping.catalog.lookup`, `dev.shopify.catalog.global`, and `dev.shopify.catalog` for per-store search). It declares no cart or checkout capability (S§1.2). Every schema URL returned HTTP 200 on 2026-11-17.

The documented profile schema has **no contact, owner or name field**, so there is nothing personal to fill in. Before publishing, the owner must:

1. Choose the host (S§9 decision 3) and check its real response headers: HTTPS, **no redirect**, and `Cache-Control` with `public` and `max-age` of at least 60, without `private`, `no-store` or `no-cache` ([UCP-OV] Hosting), and **`Content-Type: application/json`**: Shopify refused GitHub raw's `text/plain` on 2026-11-23 (`profile_malformed`). Whether Shopify also enforces the `Cache-Control` rule is not known.
2. Accept the Shopify API License and Terms of Use (using the API means accepting them, [CAT]).
3. Decide whether the measurement is acceptable under the terms' benchmarking and "no bulk harvesting" clauses (SOURCES.md §8), or ask Shopify first.
4. Optionally create Dev Dashboard credentials (Token tier, 5 req/s per client). The probe does not use them yet.

## The one live request made (2026-11-17T17:31:23Z)

Exactly one request was sent to `https://catalog.shopify.com/api/ucp/mcp`: the profile-less `tools/list` body shown in [GC] (`{"jsonrpc":"2.0","method":"tools/list","id":1}`), User-Agent `agentic-dasher-lab/0.1`, no `Authorization` header, no profile.

- **HTTP 200**, `content-type: application/json` (not SSE), about 0.22 s, 37,819 bytes, header `x-shopify-ucp-mcp-api-version: 2026-08-25`, header `shopify-complexity-score: 18`. No `Retry-After` or rate-limit headers.
- Tools listed: `search_catalog`, `get_product`, `lookup_catalog`. Each input schema **requires** `meta` and `catalog`; `meta` requires `ucp-agent.profile` (`"format":"uri"`). `catalog.context` lists `address_country`, `address_region`, `postal_code`, `language`, `currency`, `intent`. Output schema: price `amount` is `"type":"integer"` ("minor currency units"); the error branch is `ucp.status: "error"` with `messages[]`.

A profile-less `search_catalog` was **not** sent: the docs say every request must carry the profile ([GC], [UCP-MCP]) and the live schema marks it required, so sending one would knowingly break a documented MUST. The expected answer is documented instead: `invalid_profile_url`, JSON-RPC `-32001` ([UCP-OV]).

## The live run

On 2026-11-23 the owner accepted the API terms and the orchestrator replaced the 60-query measurement with a **functional check** (the terms forbid benchmarking the API): at most 6 rows, e.g. 2 queries x CA, US, DE, and no latency recorded anywhere.

```sh
node lab/catalog/run.ts --profile <published https URL of agent-profile.json> \
  --products <list.json> --owner-approved --functional-check
```

Product list: a JSON array of rows `{"query": "...", "country": "CA", "currency": "CAD"}`, at most 6 with `--functional-check` (60 without). Every run stops at the first 429 and at the first profile rejection (MCP `-32001` or a `profile_*` code), since every later request would be refused the same way.

The full 60-query description below is kept for reference; it is not to be run without a new owner decision.

- 20 products x CA, US, DE = **60 `search_catalog` requests**, sequential, one every 2 s at least (`--interval-ms`, no lower than 2000), so about 2 minutes plus latency. No retries. The run **stops at the first 429** and records it.
- Options: `--limit` (default 20, as S§5.6), `--ships-to` (adds `filters.ships_to.country`), `--out` (default `lab/out/catalog`).
- It refuses to start without `--profile`, without `--owner-approved`, or with an `example`, placeholder, non-https or IP-literal profile URL.
- Output in `lab/out/catalog/<timestamp>/`: `records.jsonl` (per request: status, latency (null with `--functional-check`), rate-limit headers, error, UCP version and message codes, counts of products and offers by currency and with a link or checkout URL, attribution parameter names) and `summary.json` (n, latency p50/p95 by nearest rank (left out with `--functional-check`), hits per query, share of priced offers in the requested currency, errors by kind, profile rejections). **It writes no titles, prices or URLs**: the terms cap price caching at 10 minutes and forbid a standing product database, so raw Catalog payloads are not kept.
- Rate limiting is per IP for anonymous traffic plus one shared pool ([RL]), so this run cannot separate "by IP" from "by profile"; the docs already answer it.
