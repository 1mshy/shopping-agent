# Spike B: Shopify Global Catalog

Plan P0 workstream 5, spike B · sources read 2026-11-17, functional check run 2026-11-23 · harness `lab/catalog/` · status: **stopped at the profile host; host to be chosen again**

## Question

S§5.3 makes Shopify's keyless Global Catalog (`search_catalog` over JSON-RPC at `catalog.shopify.com/api/ucp/mcp`) a lead source for user-initiated searches, sending an agent-profile URL with every request. Part 1 (`lab/catalog/SOURCES.md`) checked every S§5.3 claim against Shopify's and UCP's documentation. Part 2 asks the live questions: **does Shopify accept the project's published profile, and do keyless results come back usable: priced offers in the requested currency, with attribution parameters on the links?**

Part 2 was cut down on 2026-11-23. The owner accepted Shopify's API License and Terms of Use. The orchestrator replaced the planned 60-query measurement with a small functional check, because the terms forbid using the API "for any similar benchmarking purposes": at most 6 requests, sequential, at least 2 s apart, no retries, stopping at the first 429. No latency is recorded or reported.

## Method

- **Profile:** `lab/catalog/agent-profile.json`, published from `main` at `https://raw.githubusercontent.com/1mshy/shopping-agent/main/lab/catalog/agent-profile.json` (S§9 #3 as decided on 2026-11-23). Just before the run, that URL answered HTTP 200 over HTTPS with no redirect, `content-type: text/plain; charset=utf-8`, `cache-control: max-age=300` (no `public`), an `etag`, and a body identical to the committed file.
- **Runner:** `node lab/catalog/run.ts ... --owner-approved --functional-check`, using the part 1 client (`client.ts`, raw `fetch` on Node 22.22.0, User-Agent `agentic-dasher-lab/0.1`, no `Authorization` header, so the anonymous tier). The list had 6 rows: 2 generic queries × CA/CAD, US/USD and DE/EUR, `limit` 20, no ships-to filter. The runner stops at the first 429 and, new in this part, at the first profile rejection.
- **Output:** one record per request in `lab/out/catalog/2026-11-23T16-30-56-623Z/` (not committed): status, error, rate-limit headers, counts. No titles, prices or URLs are written anywhere, because the terms cap price caching at 10 minutes and forbid a standing product database.

## Result

**One request was sent, and Shopify refused the profile.** n = 1 of the 6 planned; country CA, currency CAD; 2026-11-23 at about 16:30:56Z.

| | Value |
|---|---|
| HTTP status | 422 |
| Content type | `application/json` (not SSE) |
| JSON-RPC error | `code: -32001`, `message: "UCP discovery failed"` |
| `error.data` | `code: "profile_malformed"`, `content: "Unable to fetch agent profile: Invalid content type"` |
| Headers | `shopify-complexity-score: 340`; no `Retry-After` or rate-limit headers |
| Products / offers | none (0 / 0); currency match and attribution parameters not observable |

The runner stopped after this reply, as designed. The other 5 requests (US and DE, and the second query) were not sent, because every later request would be refused the same way. No other profile host was tried.

What this does and does not show:

- **Shopify fetches the profile and checks its content type.** It refuses `text/plain`. The status, code and error placement match UCP's table for `profile_malformed` (422 / `-32001`, SOURCES.md §3). None of the documentation passages quoted in part 1 states a content-type rule, and Shopify's own profile guide ([GSP]) names "GitHub raw" as an example host, which this result contradicts for `.json` files on `raw.githubusercontent.com`.
- **The request shape was not refused.** `tools/call`, `search_catalog`, `meta["ucp-agent"].profile` and `catalog.context` got as far as profile discovery with no invalid-params error. Whether the server validates the rest of the request before or after discovery is not known.
- **Not known:** whether Shopify also enforces UCP's `Cache-Control: public` rule (raw sends `max-age=300` without `public`, and the content-type check failed first); whether keyless results come back at all; their currency; their attribution parameters.

## What a fallback host needs

The documented rules ([UCP-OV] Hosting, SOURCES.md §3) plus what Shopify enforced here:

1. HTTPS, a stable public URL, and **no 3xx redirect**.
2. **`Content-Type: application/json`**, enforced by Shopify on 2026-11-23. Whether a `charset` parameter is accepted is untested.
3. **`Cache-Control` with `public` and `max-age` of at least 60**, without `private`, `no-store` or `no-cache`. UCP says MUST; Shopify's enforcement is unknown, so a host that cannot set this would risk the next refusal.
4. An `ETag` or `Last-Modified` header (UCP: SHOULD).
5. No personal data: the profile has no contact field, so any host that serves the committed file as-is will do.

Candidates. Only the first was header-checked, and none has been sent to Shopify:

- **jsDelivr's mirror of this repository:** `https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@main/lab/catalog/agent-profile.json`. One GET on 2026-11-23 (headers only read, nothing sent to Shopify) gave HTTP 200, `content-type: application/json; charset=utf-8`, `cache-control: public, max-age=604800, s-maxage=43200` and an `etag`, which meets every rule above. It needs no setup. Its drawbacks: it is a third-party CDN rather than a "project-owned" URL (S§5.3's wording), and a branch URL is cached for up to 7 days, so a profile change needs a purge or a URL pinned to a tag or commit.
- **GitHub Pages for this repository:** needs Pages to be enabled. Its headers were not checked.
- **A static host with a headers file** (for example Cloudflare Pages or Netlify), or an own domain. These need an account and setup, and give full control of the headers.

## Limits

- n = 1. This is one reply from one IP, on one day, on the anonymous tier. It establishes a refusal reason, not a rate or a distribution.
- The refusal names only the first check that failed. Other profile problems, if there are any, are hidden behind it.
- No search result was seen, so none of the result-side claims of S§5.3 (currency handling, attribution, re-reading hits at the shop) moved from documentation to live evidence.

## Decision

1. **GitHub raw cannot host the profile.** Shopify refuses its `text/plain`. S§9 #3 has to be chosen again. This is for the orchestrator or the owner. My recommendation is the jsDelivr URL pinned to a tag (it meets every documented rule with no account), or GitHub Pages if a project-owned URL matters more.
2. **Re-run the same functional check once the new host is published:** the same 6 rows, the same limits, `--functional-check`. That run answers the open questions (results, currency, attribution). Until then the keyless Catalog stays on by default as decided on 2026-11-23, but it is not shown to work.
3. **A profile rejection is a configuration error, not a search failure.** The product should switch the Catalog source off with a settings error naming the code, instead of sending (and failing) every search.

## Changes

- `lab/catalog/run.ts`:
  - New `--functional-check` flag. It caps the list at 6 rows, records `latencyMs: null` and leaves latency out of the summary and console.
  - Every run now stops at the first profile rejection (MCP `-32001` or a `profile_*` code).
  - Each record now carries the UCP version, the UCP message codes, and counts of offers with a link or a checkout URL (not the links themselves).
  - Tests are in `run.test.ts`.
- `lab/catalog/README.md` and `SOURCES.md` §8.5: the live result and the content-type requirement.
- `docs/spec.md`:
  - S§5.3: the [verify] note now says the live search was refused at the profile. The hosting sentence adds `Content-Type: application/json` (confirmed live) and marks `Cache-Control: public` as UCP's rule whose enforcement is unknown. It also adds the rule that a profile rejection switches the source off. The keyless default is recorded as decided.
  - S§9 #3: records the refusal; the host must be chosen again.
  - The [verify] mark stays on S§5.3, because no result-side claim was confirmed.
