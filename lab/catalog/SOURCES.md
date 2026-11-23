# Shopify Global Catalog: what the sources say

Plan P0 spike B, part 1. Every point below was read on **2026-11-17** from the page named, using Shopify's Markdown copies of its docs (`<page>.md`) where they exist. Quotes are verbatim. Nothing here comes from memory; secondary sources are labelled as such and nothing depends on them.

Sources:

| Key | URL |
|---|---|
| [GC] | https://shopify.dev/docs/agents/catalog/global-catalog (same text at `/docs/agents/catalog/mcp`) |
| [CAT] | https://shopify.dev/docs/agents/catalog (About Catalogs, incl. "Usage guidelines") |
| [RL] | https://shopify.dev/docs/agents/profiles/auth-and-rate-limiting |
| [PROF] | https://shopify.dev/docs/agents/profiles |
| [GSP] | https://shopify.dev/docs/agents/get-started/profile |
| [AUTH] | https://shopify.dev/docs/agents/get-started/authentication |
| [GSS] | https://shopify.dev/docs/agents/get-started/search-catalog |
| [EXT] | https://shopify.dev/docs/agents/catalog/global-catalog-extension |
| [PP] | https://shopify.dev/docs/agents/catalog/promoted-placement |
| [DD] | https://shopify.dev/docs/apps/build/dev-dashboard/catalogs |
| [TERMS] | https://www.shopify.com/legal/api-terms ("Last updated on: October 7, 2026") |
| [UCP-OV] | https://ucp.dev/2026-08-25/specification/overview/ |
| [UCP-CAT] | https://ucp.dev/2026-08-25/specification/shopping/catalog/ |
| [UCP-MCP] | https://ucp.dev/2026-08-25/specification/shopping/catalog/mcp/ |
| [MCP-T] | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports |
| [HOSTED] | https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json (Shopify's hosted example profile) |

## 1. Endpoint and transport

- Endpoint: [CAT] table: "**Endpoint** | `https://catalog.shopify.com/api/ucp/mcp`". [GC] shows `POST https://catalog.shopify.com/api/ucp/mcp`.
- Transport: JSON-RPC 2.0 MCP `tools/call`. [GC] example body: `"jsonrpc": "2.0", "method": "tools/call", "id": 1, "params": {"name": "search_catalog", ...}`. [UCP-MCP] conformance: "Implement JSON-RPC 2.0 protocol correctly."
- [GC] shows `tools/list` sent directly, without an `initialize` call and without `meta`. No Shopify page shows an `initialize` handshake or a session header.
- MCP Streamable HTTP [MCP-T]: "The client **MUST** include an `Accept` header, listing both `application/json` and `text/event-stream` as supported content types." The server may answer with either; the probe accepts both.
- [CAT]: "**Endpoint URLs might change**: API URLs are subject to change."

## 2. `search_catalog` request shape

[GC]: "All parameters are wrapped in a `catalog` object." Documented fields: `catalog.query`, `catalog.catalog_id`, `catalog.like`, `catalog.context`, `catalog.filters.*` (`available`, `ships_to`, `ships_from`, `price`, `condition`, `shops`, `attributes`, `rating`, `price_tier`, `media`, `categories`), `catalog.pagination`.

- Context: [GC] "catalog.context•object  Buyer signals for relevance and localization (`address_country`, `address_region`, `postal_code`, `language`, `currency`, and `intent`)."
- [UCP-CAT] Context: "`address_country` ... The country, as a 2-letter ISO 3166-1 alpha-2 code" and "`currency` ... Preferred currency (ISO 4217, e.g., 'EUR', 'USD'). Businesses determine presentment currency from context and authoritative signals; this hint MAY inform selection in multi-currency markets." Also: "Businesses determine market assignment—including currency—based on context signals." and "Platforms MAY geo-detect context from request headers."
- Pagination: [GC] "Accepts `cursor` ... and `limit` (integer, min `1`, default `10`, max `50`)."
- Ships-to filter: [GC] "catalog.filters.ships\_to•object  Filter to products that ship to a given location. Accepts `country` (ISO 3166-1 alpha-2), `region`, and `postal_code`."
- Profile reference: [GC] "The `/api/ucp/mcp` endpoint requires an agent profile. Every request must include a `meta.ucp-agent.profile` URL pointing to your agent's UCP profile." In the example it sits at `params.arguments.meta["ucp-agent"].profile`, beside `params.arguments.catalog`. [UCP-MCP]: "The meta["ucp-agent"] field is required on all requests to enable version compatibility checking and capability negotiation."

Response: [GC] "Results ... conform to the UCP catalog search response", under `result.structuredContent` with `ucp`, `products[]`, `pagination`, optional `messages`. Prices: [UCP-CAT] Price "`amount` ... Amount in ISO 4217 minor units." and "`currency` ... ISO 4217 currency code"; [GC] "price range (minor units)". Example amounts are JSON integers (`{"amount": 8999, "currency": "USD"}`). Variant links: [GC] example has product `url` and variant `checkout_url`; [PP] shows a variant-level `url`.

## 3. Agent profile: contents and hosting

- Required members, [UCP-OV] "Profile Structure": "For both business and platform profiles, ucp.version, ucp.services, and ucp.payment_handlers are required. The services and payment_handlers registries MUST be present even when empty. ucp.capabilities is optional". Optional `keys[]` (JWKs) only when signing.
- Catalog capabilities, [GC]: "If you host your own profile, declare both the base UCP capabilities and Shopify's extensions ... For the Catalog, that means `dev.ucp.shopping.catalog.search` and `dev.ucp.shopping.catalog.lookup` plus `dev.shopify.catalog.global` (or `dev.shopify.catalog` on a merchant storefront)."
- [UCP-OV]: "A capability MUST declare a schema", and a schema URL's origin "MUST match the namespace authority in its name" (so `dev.ucp.*` → `ucp.dev`, `dev.shopify.*` → `shopify.dev`).
- **No contact, owner or name field exists in the profile schema** in any source read. The draft profile therefore needs no contact placeholder.
- Hosting, [UCP-OV] "Hosting": "Published artifacts MUST be served over HTTPS." / "Profile endpoints MUST NOT use redirects (3xx)." / "Published artifacts MUST include a Cache-Control header with public and max-age of at least 60 seconds, and MUST NOT be served with private, no-store, or no-cache directives." / "Published artifacts SHOULD include a validator (ETag or Last-Modified)".
- [GSP]: "Copy and host the file above at a public URL. * Use a static host (for example, GitHub raw, or your own domain)."
- [PROF]: "Shopify (the business) fetches and validates the profile." Failure codes [UCP-OV]: `invalid_profile_url` ("Profile URL is malformed, missing, or unresolvable", REST 400, MCP -32001), `profile_unreachable` (424 / -32001), `profile_malformed` (422 / -32001), `version_unsupported` (422 / -32001), `capabilities_incompatible` (200, in the result). [PROF] also names a `profile_too_large` error.

## 4. Keyless access, credentials, rate limits

- [CAT] table: "**Auth** | Agent profile (no API key needed)".
- [RL] tiers: Token (Dev Dashboard credential, "JWT passed with Bearer token authentication"), Signed (RFC 9421 HTTP signatures, key in the profile's `keys[]`), Anonymous ("No credentials or signatures provided. Send the request without an `Authorization` header or signature headers."). Catalog tools are available to all three.
- [RL]: "Rate limits scale with identification. The Token tier gets the highest limits, Signed gets lower limits, and Anonymous gets the lowest."
- [RL] Global Catalog: "Authenticated requests ... are rate limited for each API client. The default limit is 5 requests each second for each API client." `search_catalog`, `get_product` and `lookup_catalog` "share the same quota".
- [RL] **Keyless keying, answered by the docs**: "Unauthenticated requests are rate limited for each IP address and also share a single limit with all other unauthenticated traffic, so their throughput isn't guaranteed. Don't use unauthenticated requests for production traffic."
- [CAT]: "Keyless catalog access doesn't support rate limit increases."
- [RL] 429: "Shopify returns HTTP `429` with a `Retry-After` header." [UCP-OV]: "For MCP over HTTP, the HTTP status code is the primary signal" and "SHOULD include Retry-After header (REST) or error.data.retry_after (MCP)".
- Credentials [AUTH]: client ID and secret from Dev Dashboard → Catalogs → "Get an API key", exchanged at `https://api.shopify.com/auth/access_token` (`grant_type: client_credentials`); "The token expires after 60 minutes". [DD]: "In a Partner organization, Shopify might ask you to verify your identity first. Until you do, the page shows **Catalog search is locked**". [GSS] (tutorial) sends `Authorization: Bearer` to a saved-catalog URL copied from the Dev Dashboard; that is the Token path, not a contradiction of keyless access.

## 5. Usage terms

[CAT] "Usage guidelines": "By using either API, you agree to the Shopify API License and Terms of Use." Then:

- "**Use Catalog data only for shopper experiences**: Catalog results are provided to show products to buyers directly in your own agent or application and to help them buy."
- "**Caching limits**: ... Cache results only when necessary, and only within the following limits: **Product metadata**, such as titles, descriptions, and options: cache up to 24 hours. ... **Price and availability**: cache up to 10 minutes. **Commission values**: don't cache."
- "**Keep attribution intact**: Don't remove or change attribution parameters (`shcgid` and `shclid`), checkout URLs, or merchant attribution in Catalog results."
- "**No bulk harvesting**: Don't conduct any systematic or automated data collection activities, or request more than the minimum amount of data necessary."
- "**No use for training purposes**: Don't use Catalog results to develop, train, or fine-tune any ML or AI models, or to build a standing product database or commerce index, without Shopify's or the merchant's consent."
- "**No redistribution, resale, or bulk export**".

Attribution parameters [PP]: `utm_source=shopify`, `utm_medium=catalog`, `_gsid` apply to "All variant URLs"; `shclid` and `shcgid` to "All variant URLs in authorized responses" (a saved catalog enrolled in promoted placements). "Unauthorized responses are returned without these affiliate attribution parameters." So a keyless response is expected to carry `_gsid`/`utm_*` but not `shcgid`/`shclid`.

External offers (beta, opt-in via `catalog.sources`, enabled clients only) [EXT]: price is "Treat it as indicative. The merchant's page is authoritative." and stock "Confirm availability on the merchant's page".

[TERMS] (apply to all Shopify APIs, Catalog included):
- "not use or access the Shopify API or the Service in order to monitor the availability, performance, or functionality of the Shopify API, the Service or any portion thereof or for any similar benchmarking purposes;"
- "not use the Shopify API to conduct any systematic or automated data collection activities (including scraping, data mining, data extraction and data harvesting) or to build any commerce or product index, and, in any event, not request more than the minimum amount of data from a Shopify API needed by your Application to provide the intended Application functionality".

**Scheduled or automated use.** No page says "never call from scheduled jobs" in those words. The relevant texts are the shopper-experience rule, "No bulk harvesting" and the [TERMS] clause above. [RL]'s note that a scheduled Token-tier call fails without a buyer ("such as from a scheduled job, then the call fails") applies to merchant endpoints; [RL]: "Global Catalog requests don't need the header."

## 6. The 10- vs 15-minute question

[CAT], read 2026-11-17: "**Price and availability**: cache up to 10 minutes." No 15-minute figure appears on any Shopify or UCP page read. *Secondary* (web search, not relied on): the only 15-minute figure found concerns the CarrierService shipping-rate cache; two third-party blogs (retailgentic.com, junifia.ca) describe a blanket no-caching rule that the official page does not say.

## 7. Spec S§5.3 claims, one by one

| S§5.3 claim | Verdict | Evidence |
|---|---|---|
| Plain JSON-RPC 2.0 over HTTPS to `catalog.shopify.com/api/ucp/mcp` | **Confirmed** | [CAT] endpoint row; [GC] example. Note [MCP-T] Accept header and possible SSE reply. |
| Method `search_catalog` | **Confirmed, with a correction**: it is a *tool*, called with JSON-RPC method `tools/call` and `params.name: "search_catalog"` | [GC] example |
| "about 150 lines, no MCP SDK" | **Not found** (a project estimate). Docs show raw `fetch` with no SDK and no handshake ([GSS], [GC]) | |
| `context.address_country` and `context.currency` | **Confirmed**; both sit at `catalog.context` | [GC]; [UCP-CAT] |
| Offers in another currency are dropped | **Not found** (project rule). Relevant: currency is only a hint; "Businesses determine presentment currency"; every price carries its currency | [UCP-CAT] |
| Lead source for user-initiated searches only | **Consistent, not stated as such** | [CAT] "only for shopper experiences" |
| Price/availability held ≤10 minutes | **Confirmed** (10, not 15) | [CAT] |
| Metadata held ≤24 hours | **Confirmed** | [CAT] |
| No Catalog payload written to the product database | **Confirmed in substance**, stricter than the text: the docs allow time-limited caching but forbid "a standing product database or commerce index" | [CAT]; [TERMS] |
| Attribution parameters kept on outbound links | **Confirmed**; also checkout URLs and merchant attribution. Keyless results should carry `_gsid`/`utm_*`, not `shcgid`/`shclid` | [CAT]; [PP] |
| Never called from watches, sweeps or scheduled recommendation jobs | **Not found verbatim; strongly supported** by "No bulk harvesting" and [TERMS] | [CAT]; [TERMS] |
| Every hit re-read at the shop before shown as verified or stored | **Not found** (project rule); consistent with "checkout is authoritative" and "The merchant's page is authoritative" | [UCP-CAT]; [EXT] |
| The request needs a public agent-profile URL | **Confirmed** | [GC]; [UCP-MCP] |
| One static profile JSON at a project-owned HTTPS URL | **Confirmed as allowed**, with hosting rules: HTTPS, no 3xx, `Cache-Control: public, max-age>=60` | [GSP]; [UCP-OV] |
| Optional field for the user's own Shopify client credentials | **Confirmed that credentials exist**; they are a Dev Dashboard client ID/secret exchanged for a 60-minute Bearer JWT, sent as a header, never in the profile | [AUTH]; [RL] |
| (Plan) keyless access works | **Confirmed by the docs**, but: lowest tier, keyed per IP plus one shared pool, no increases, and "Don't use unauthenticated requests for production traffic" | [CAT]; [RL] |
| (Plan) rate limiting keyed by IP or by profile | **Answered by the docs**: anonymous by IP plus a global pool; Token by API client (5 req/s). Profile is not named as a key | [RL] |
| (S§5.6) Catalog limit 20 | **Allowed** (max 50) | [GC] |

## 8. Contradictions and risks the spec does not account for

1. **Production keyless use is discouraged.** S§5.3 makes the keyless Catalog a default lead source; [RL] says "Don't use unauthenticated requests for production traffic", and throughput is shared with all anonymous traffic.
2. **The live measurement itself may conflict with [TERMS]**: "monitor the availability, performance, or functionality ... or for any similar benchmarking purposes", and "No bulk harvesting". Measuring latency and hit counts over 60 scripted queries is close to both. The owner should decide (or ask Shopify) before the run.
3. **Using the API means accepting [TERMS]** ([CAT]: "By using either API, you agree"). The owner, not a contributor, should accept them.
4. **Persisting raw results** in `lab/out/` would exceed the 10-minute price cache. The runner therefore writes measurement records with no Catalog content (see `README.md`).
5. **Hosting rules may exclude a default static host.** The profile host must send `Cache-Control` with `public` and must not redirect. Check the chosen host's real headers before publishing; this was not verified here. **Seen live on 2026-11-23** (spike B part 2): Shopify refused the profile on GitHub raw, which serves `text/plain`, with HTTP 422, JSON-RPC `-32001`, `profile_malformed`, "Unable to fetch agent profile: Invalid content type". None of the passages quoted in this file names a content-type rule, and [GSP] names GitHub raw as a host example.
