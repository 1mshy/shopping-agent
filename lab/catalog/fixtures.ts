// SYNTHETIC test inputs. Hand-written, shaped after the documented examples cited on each
// constant (see SOURCES.md for the keys). They are not recordings and are not evidence of
// what the live API returns.

// Shaped after [GC] `search_catalog` response and [PP] "Unauthorized response" variant URL.
// Deliberately includes: an offer in another currency, a variant without a price, a product
// without variants, an integer too large for a double, and a string amount.
export const SEARCH_OK_BODY = `{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "structuredContent": {
      "ucp": {
        "version": "2026-08-25",
        "capabilities": {
          "dev.ucp.shopping.catalog.search": [{"version": "2026-08-25"}],
          "dev.shopify.catalog.global": [{"version": "2026-08-25"}]
        }
      },
      "products": [
        {
          "id": "gid://shopify/p/synthetic1",
          "title": "Synthetic Runner",
          "url": "https://shop-a.example/products/runner",
          "variants": [
            {
              "id": "gid://shopify/ProductVariant/1",
              "title": "Black / 10",
              "price": {"amount": 8999, "currency": "CAD"},
              "url": "https://shop-a.example/products/runner?variant=1&_gsid=clk_x&utm_source=shopify&utm_medium=catalog",
              "checkout_url": "https://shop-a.example/cart/1:1",
              "availability": {"available": true},
              "seller": {"name": "Shop A", "id": "gid://shopify/Shop/1", "domain": "shop-a.example"}
            },
            {
              "id": "gid://shopify/ProductVariant/2",
              "title": "Blue / 10",
              "price": {"amount": 6599, "currency": "USD"},
              "availability": {"available": false},
              "seller": {"name": "Shop B", "domain": "shop-b.example"}
            },
            {
              "id": "gid://shopify/ProductVariant/3",
              "title": "Red / 10",
              "seller": {"name": "Shop A", "domain": "shop-a.example"}
            }
          ]
        },
        {
          "id": "gid://shopify/p/synthetic2",
          "title": "Synthetic Bundle",
          "url": "https://shop-c.example/products/bundle",
          "variants": [
            {
              "id": "gid://shopify/ProductVariant/4",
              "price": {"amount": 12345678901234567890, "currency": "CAD"},
              "seller": {"name": "Shop C"}
            },
            {
              "id": "gid://shopify/ProductVariant/5",
              "price": {"amount": "4500", "currency": "CAD"},
              "seller": {"name": "Shop C"}
            }
          ]
        },
        {"id": "gid://shopify/p/synthetic3", "title": "No Variants"}
      ],
      "pagination": {"cursor": "abc", "has_next_page": true, "total_count": 142},
      "messages": [{"type": "info", "code": "synthetic_note", "content": "synthetic"}]
    }
  }
}`;

// Shaped after [UCP-OV] "Discovery Failure (JSON-RPC error)".
export const DISCOVERY_FAILURE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  error: {
    code: -32001,
    message: 'UCP discovery failed',
    data: {
      code: 'profile_unreachable',
      content: 'Unable to fetch agent profile: connection timeout',
    },
  },
});

// Shaped after [RL] "Rate-limit responses" body (served with HTTP 429 and Retry-After).
export const RATE_LIMIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  error: {
    code: -32000,
    message: 'Rate limit exceeded',
    data: 'Too many requests, please retry after 30 seconds',
  },
});

// Shaped after [UCP-OV] "Capabilities Incompatible (JSON-RPC result)".
export const CAPABILITIES_INCOMPATIBLE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: {
    structuredContent: {
      ucp: { version: '2026-08-25', status: 'error' },
      messages: [
        {
          type: 'error',
          code: 'capabilities_incompatible',
          content: 'No compatible capabilities in the intersection',
          severity: 'unrecoverable',
        },
      ],
    },
  },
});
