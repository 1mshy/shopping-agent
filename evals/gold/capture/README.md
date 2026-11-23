# evals/gold/capture

The scripts that built gold set v1 (`../sets/matcher-v1/`, ledger unit P0-4c) on 2026-11-23: shop probing, search, listing capture and the product identities. They are kept so the set can be audited and extended; they are lab scripts (plain `.mjs`, run with Node 26), not product code, and nothing imports them.

| File | What |
|---|---|
| `http.mjs` | Paced GET: one request in flight per host, at least 1.2 s (plus 0-0.3 s jitter) between request starts to a host, User-Agent `agentic-dasher-lab/0.1 (gold-set snapshot capture)`. A host that answers 403, 429 or 503 is not contacted again in that process; `www.alternate.de` (429 during the DE capture) and `www.kmstools.com` (429 on a probe) are on a permanent stop list |
| `src.mjs` | Source adapters through a disk cache of raw responses: Shopify predictive search plus `<product>.json` and `/cart.js` (currency), WooCommerce Store API, Magento 2 GraphQL, Best Buy Canada's public JSON search and product endpoints |
| `links.mjs`, `ldjson.mjs` | HTML search pages (alternate.de, 3djake.de, berrybase.de): product links, then the product page's JSON-LD `Product` (name, brand, MPN, GTIN, offer) |
| `probe.mjs` | Which platform search endpoint a host answers (used to choose the shops) |
| `products-*.mjs` | Per product: country, category, the searches per shop, a title filter, and which Shopify variant to prefer |
| `capture.mjs` | Runs the searches, keeps results whose title passes the filter, round-robins across shops reading details until about 22 listings, and writes `snapshots/<product>.json` |
| `identities.mjs` | Product identities (brand, model, MPN, GTIN, must-have attributes, a one-line description) |
| `build-set.mjs` | Writes `products.json` from the identities and copies the snapshot files into the set |
| `review-sheet.mjs` | Writes the owner's review sheets `REVIEW.md` (blind worklist) and `REVIEW-disagreements.md` from the set |
| `hints.mjs` | Shows a product's listings that match a pattern (used to pick identities) |

## How the set was captured

1. **Shops.** 237 hosts were probed for a Shopify, WooCommerce or Magento search endpoint or a readable HTML search page. 47 hosts gave usable listings: Canadian independents and brand stores, Best Buy Canada's JSON API, US brand and specialist Shopify stores, German brand stores, toolnation.de (Magento, German store view `toolnation_de`), alternate.de, 3djake.de, berrybase.de and buyzero.de. Most large retailers wall plain HTTP (403 or a challenge page: Staples, Newegg, Memory Express, Micro Center, Home Depot, MediaMarkt, Saturn, Kaufland, Conrad, Rona and others); none of them was retried.
2. **Search, not selection.** Each product's listings are what the shops' own search returned for a few queries (the product name, the family, an accessory word), filtered only by a loose title pattern (`relevant`), so exact matches and the store's padding (variants, bundles, parts, other models) both appear. A Shopify product with several variants gives the preferred variant and, for some products, one other variant as a second snapshot with its `?variant=` URL.
3. **Fields.** `listing` holds what the source states: the title, the vendor or brand field, an MPN only where the store's SKU is the manufacturer's part number (Best Buy's `modelNumber`, the brand stores listed in `SKU_IS_MPN`), a GTIN from the barcode, UPC or JSON-LD field (not validated), the Shopify variant options, a condition from the source or the title (open box, refurbished), and the seller kind (Best Buy marketplace sellers are `marketplace_seller`). `context` keeps the price as the source wrote it and its currency.
4. **Country.** All requests came from one machine whose IP geolocates to Canada (a Shopify store's `browsing_context_suggestions.json` said `CA`). The US and DE snapshots are therefore US and German stores seen from Canada. Two US Shopify stores (store.sunlu.com, instantpot.com) localised to CAD for this IP; their price currency is recorded as `unknown`, because the `.json` variant price may be in the shop's base currency. No country was faked.
5. **Load.** About 1,810 requests to 237 hosts on 2026-11-23 (16:20-17:10 UTC), at most one in flight per host. The busiest host was Best Buy Canada (about 400 requests, at 1.2 s or more apart). One 429 (alternate.de, after 45 requests): the host was stopped and the DE products that needed it were re-captured from other shops. robots.txt was not read (owner decision 4: `ignore`).
6. **No personal data.** Responses are public product data; the raw response cache stays outside the repository (it is in the scratch area of the session that built the set).

Reproducing exactly is not possible (shops change); re-running `capture.mjs` gives a new capture of the same searches.
