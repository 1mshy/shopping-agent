# Platform reader fixtures

Test input for `../*.test.ts`. Each payload is trimmed to the fields the readers read; none holds a cookie, a token, a header or personal data. Hand-written files are shaped like the platform's documented answer and are not evidence of how any real shop answers; the two `real-*` files are.

| File | Where it came from |
|---|---|
| `shopify/pla-pro.js.json` | Hand-written: the predecessor's `tests/test_shopify.py` `_PRODUCT_JS` (two variants, 36.99 with a 42.99 compare-at, and a cheaper sold-out 34.99), in the shape of shopify.dev's Ajax API product reference |
| `shopify/pla-pro-us.js.json` | Hand-written: the predecessor's default-market answer for the same product (USD 25.99), from `test_fetch_offer_reads_the_market_the_url_points_at` |
| `shopify/ssd-capacity.js.json` | Hand-written: a capacity ladder (1, 2, 4 TB, with and without heatsink) for the cheapest-variant failure of S§5.2 |
| `shopify/single-variant.js.json` | Hand-written: `lab/routes/fixtures/shopify-product.json` (shopify.dev's example product) with the `Default Title` option |
| `shopify/jpy-earphones.js.json` | Hand-written: a zero-decimal product in hundredths of a yen (1650000 for ¥16,500) |
| `shopify/real-jpy.js.json` | Real: `GET https://shop.aviot.jp/products/te-v1r-ad2.js`, 2026-11-24, manual smoke (`lab/platform-readers/smoke.ts`); trimmed to the fields read. The answer set `cart_currency` |
| `shopify/real-jpy.json.json` | Real: `GET https://shop.aviot.jp/products/te-v1r-ad2.json`, the same session, right after; trimmed. Its `price` "22880" with `price_currency` "JPY" against the `.js` 2288000 is the evidence for the unit of the `.js` integers in a zero-decimal currency |
| `woo/pennant-by-slug.json` | Hand-written: `lab/routes/fixtures/woo-products.json` extended to developer.woocommerce.com's Store API product shape (a sale price under a regular price, GBP) |
| `woo/hoodie-by-slug.json` | Hand-written: a variable product (Color × Size) with the parent's `price_range`, in the Store API shape |
| `woo/hoodie-variation-102.json` | Hand-written: one variation of it, as `/products/<variation id>` returns it |
| `magento/jacket-simple.json` | Hand-written: `lab/routes/fixtures/magento-products.json` extended to the reader's query (final under regular price, base currency) per Adobe's GraphQL `products` reference |
| `magento/tee-configurable.json` | Hand-written: a configurable product (Color × Size) with three variants and the parent's range |
