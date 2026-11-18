# Test fixtures (spike A)

Hand-written for the tests in `lab/transport/`. None is a copy of a real shop's page and none is evidence about any shop.

| File | Stands for |
|---|---|
| `product-jsonld.html` | A product page with a JSON-LD `Product` and a typed `Offer` (readable) |
| `no-price.html` | A product page whose price is only in visible text (served, not readable) |
| `captcha-form.html` | A small page whose form posts to a captcha validation path, the shape the classification review found on one host (the body rule in `result.ts`) |
| `challenge.html` | A challenge interstitial (the wall itself is signalled by the test server's `cf-mitigated` header, as spike C's rule requires) |
