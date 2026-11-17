# Test fixtures (hand-written)

Every file here was written by hand as **test input** for `../*.test.ts`. Each is shaped like the response the platform's documentation describes (sources cited in `../routes.ts`), or like a kind of page the classifier must handle. None was captured from a real shop, and none is evidence about how any real shop answers.

| File | Shaped like |
|---|---|
| `woo-products.json` | WooCommerce Store API `GET /wp-json/wc/store/v1/products` |
| `shopify-suggest.json` | Shopify Ajax API `GET /search/suggest.json` |
| `shopify-product.json` | Shopify Ajax API `GET /products/<handle>.js` |
| `magento-products.json` | Magento / Adobe Commerce GraphQL `products` query |
| `home.html` | A home page with a JSON-LD SearchAction and an OpenSearch link |
| `opensearch.xml` | An OpenSearch 1.1 description document |
| `challenge.html` | A bot-challenge interstitial returned with status 200 |
