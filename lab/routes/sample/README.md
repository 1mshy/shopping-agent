# Spike C domain sample

Four lists, one host per line (after `#`: the URL signatures that selected the host):

| File | Hosts | Population |
|---|---|---|
| `shopify.txt` | 200 | Hosts with Shopify storefront URLs in Common Crawl whose DNS resolves into Shopify's 23.227.38.0/24 |
| `woocommerce.txt` | 200 | Hosts with WooCommerce URLs in Common Crawl |
| `magento.txt` | 200 | Hosts with Magento URLs in Common Crawl |
| `searchaction.txt` | 200 | Other shop-like hosts in Common Crawl (for SearchAction / OpenSearch discovery) |

## How they were built

Source: the **Common Crawl URL index** (CDX) of crawl **CC-MAIN-2026-43** (captures 2026-10-05 to 2026-10-18), read over HTTPS from `data.commoncrawl.org`. It is public and free: no account, no key, no paid list. Built on **2026-11-17** with:

```sh
node lab/routes/sample/build-sample.ts --crawl CC-MAIN-2026-43 --chunks 60 --chunk-blocks 300 --seed 20261117 --per-list 200
```

Steps (all in `build-sample.ts`):

1. Read the index's `cluster.idx` (886,601 gzip blocks of about 3,000 captures each, sorted by reversed host name).
2. With a seeded PRNG (mulberry32, seed 20261117), pick 60 random starting blocks and read each with up to 299 following blocks of the same shard file in one range request: 16,551 blocks, about 50 million captures, 1.9% of the index. Random single blocks were the first design; Common Crawl throttles per request (HTTP 503), so the draw is clustered instead. Downloads are retried with back-off, and per-chunk results are cached under `lab/out/routes/cc/` so an interrupted build resumes.
3. Keep status-200 captures. Drop IP hosts, hosts with a port, and `*.myshopify.com` (those redirect to the shop's own domain). Treat `www.x` and `x` as one host, written as `www.x` when Common Crawl saw that form.
4. Mark each host with the path signatures its captured URLs match (an optional `/xx` or `/xx-yy` locale prefix is allowed):
   - **woocommerce**: WooCommerce's default permalink bases `/product-category/` and `/product-tag/`, an `add-to-cart=<id>` link, or `/wp-content/plugins/woocommerce/`.
   - **magento**: Magento controller routes (`/customer/account/login|create|forgotpassword`, `/customer/section/load`, `/catalogsearch/result|advanced`, `/catalog/product|category/view/id/`, `/catalog/product_compare/`, `/wishlist/index/add/`, `/review/product/list/id/`, `/sendfriend/product/`, `/newsletter/subscriber/new`, `/stores/store/switch|redirect/`, `/checkout/cart/add/uenc/`), the Magento 2 static path `/static/version<n>/frontend/`, or the `___store`, `___from_store`, `___SID` parameters.
   - **shopify**: `/products/<x>` or `/collections/<x>`.
   - **shop**: a path segment `product(s)`, `shop`, `store`, `cart`, `basket`, `checkout` or a localised cart word.
   A host with both the Woo and the Magento signature is dropped from both pools as ambiguous.
5. Draw 200 at random (seeded) from the Woo pool and from the Magento pool. For Shopify, walk the shuffled Shopify-signature pool and keep a host only if a DNS lookup puts it in 23.227.38.0/24 (Shopify's storefront range), until 200 are kept.
6. The SearchAction list is 200 random hosts from every remaining signature host (any of the above), so it is a general shop-like population that does not overlap the platform lists.

Pool sizes: WooCommerce 11,363 hosts; Magento 217; Shopify-signature candidates 13,347, of which 380 were looked up in DNS to keep 200; other shop-like hosts 55,620.

**Requests to shops while building: none.** The builder talks to `data.commoncrawl.org` and makes 380 DNS lookups through the local resolver for Shopify candidates. It never connects to a shop's web server.

Reproducing: the same command gives the same lists while Common Crawl serves the same index and DNS answers the same way; a second build on 2026-11-17 gave identical lists. The Shopify list depends on DNS on the day it is rebuilt; the others depend only on the index and the seed. A build takes about 25 minutes, most of it waiting out 503s.

## Bias (read before quoting a rate)

- **Common Crawl's view of the web.** CCBot follows links from its frontier and favours well-linked hosts. It also obeys robots.txt: hosts that block CCBot, or block the paths the signatures look for, cannot be in these lists. **The sample is therefore tilted towards robots-permissive hosts, so the robots `respect` counterfactual measured on it is a lower bound on what `respect` would refuse.** Large retailers that block crawlers are under-represented.
- **Clustered draw.** Each chunk covers a narrow range of reversed host names (one TLD, alphabetically adjacent names), so only 60 clusters stand behind each list and the effective sample size is smaller than 200. Top TLDs: Shopify `.com` 105, `.au` 24, `.us` 10, `.fr` 9; Woo `.com` 82, `.au` 17, `.il` 16, `.net` 12, `.gr` 10; Magento `.com` 53, `.de` 23, `.nl` 20, `.ch` 14, `.gr` 12; SearchAction `.com` 92, `.au` 19, `.net` 16, `.ru` 8. A TLD that happens to fall in a chunk is over-represented, and hosts with many captured URLs are more likely to be picked (bigger catalogues are favoured).
- **Signature precision.** Woo hosts are found only if they kept the default permalink bases or expose add-to-cart links. The Magento signature matches Magento 1 (end of life, no GraphQL) as well as Magento 2, so some GraphQL `not_found`/`not_platform` is "Magento 1", not "GraphQL disabled". Shopify hosts are confirmed by DNS, which misses stores fronted by their own CDN. The probe's `not_platform` outcome measures how often a list's platform guess was wrong.
- **Shop-like is loose.** The SearchAction population includes some sites with `/shop/` or `/store/` paths that sell nothing.
- **Magento is rare.** Magento signature hosts are about 1 in 50 of the Woo ones (217 against 11,363), and that set the size of the draw: 60 chunks was the smallest round number giving a Magento pool above 200. The Magento list is 200 of only 217 candidates, so it is nearly the whole pool rather than a draw from a large one.
