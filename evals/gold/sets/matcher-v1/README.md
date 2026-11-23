# Gold set matcher-v1

The matcher gold set v1 (S§5.16, ledger unit P0-4c), built 2026-11-23. Formats, validators, split and double-label tooling are in `evals/gold/README.md`; how the listings were captured is in `evals/gold/capture/README.md`.

| File | What | Written by |
|---|---|---|
| `products.json` | 61 products: identity (brand, model, MPN and GTIN where findable, must-have attributes), category, country, one-line description | `capture/build-set.mjs` from `capture/identities.mjs` |
| `snapshots/<product>.json` | 1,307 frozen listings, 17-23 per product | `capture/capture.mjs` |
| `labels/a1.json` | Primary labels of record (`a1` = the Claude Opus 5.5 agent labeller) | `agent-label.ts` |
| `agent-passes.json` | Both agent passes per snapshot with their evidence, the tie-break where they disagreed, and the prompt | `agent-label.ts` |
| `split.json` | 41 dev, 20 held-out, seed `matcher-v1-2026-11-23` | `split.ts assign` |
| `double-label.json` | Blind second-label worklist: 174 snapshots (`ceil(10%)` per product) | `double-label.ts pick` |
| `REVIEW.md` | The owner's sheet for the worklist (blind: no agent label shown) | `capture/review-sheet.mjs` |
| `REVIEW-disagreements.md` | The owner's sheet for the 97 snapshots where the two agent passes disagreed | `capture/review-sheet.mjs` |

## Products

Six categories (owner decision 2026-11-23) by country:

| Category | CA | US | DE | Total |
|---|--:|--:|--:|--:|
| 3d-printing | 4 | 4 | 4 | 12 |
| computing | 4 | 4 | 4 | 12 |
| audio | 4 | 4 | 2 | 10 |
| kitchen-appliances | 6 | 2 | 2 | 10 |
| personal-care | 4 | 2 | 3 | 9 |
| power-tools | 3 | 2 | 3 | 8 |
| **Total** | **25** | **18** | **18** | **61** |

Of the predecessor's 20 products, 19 are kept with their ids (16 captured in Canada as before; `k1c` in Germany; `sunlu-pla-plus` and `raspberry-pi-5` in the US), and the Anycubic Kobra 3 Combo became `kobra-3-max-v2-combo-de` (below). The identities are new: the predecessor's products were query strings only. The predecessor's `tech` and `household` categories were split into the owner's six. Three products were retargeted after the first labelling showed no `exact` listing in the stores searched: Kobra 3 Combo to Kobra 3 Max V2 Combo (German stores sell only the Max V2), Milwaukee 2853-20 to its successor 2953-20, Soundcore Liberty 4 NC (DE) to Liberty 4 Pro (the German store offered only Liberty 4 NC parts); their listings are unchanged and were relabelled. Two pairs of products are the same item in two countries (Sony WH-1000XM5 CA/US, Raspberry Pi 5 8 GB US/DE); the split's leakage guard put each pair on one side (both held-out).

Identities: 50 of 61 products have a GTIN and 38 an MPN, taken from an exact listing (Best Buy Canada's UPC and model number, a Shopify barcode, a JSON-LD `gtin13`); 7 have neither and are identified by brand, model and must-have attributes (filaments, and brand stores that publish no barcode). A GTIN or MPN in an identity is as the store published it and was not checked against the manufacturer.

## Labels (agent, primary)

Claude Opus 5.5 (`claude-opus-5-5`, native Anthropic API, effort `low`, structured output, prompt `gold-label.v1` in `agent-label.ts`). Two independent passes per product: pass A shows the product first and the listings in id order, pass B the listings first in reverse order and the product after. Where they agree (1,210 of 1,307, 92.6%) that is the primary label; where they disagree (97), a third call sees both readings and decides. Every pass keeps a one-sentence evidence string quoting the fields that decided it.

| Relation | n | share |
|---|--:|--:|
| exact | 116 | 8.9% |
| variant | 125 | 9.6% |
| bundle | 52 | 4.0% |
| accessory_or_part | 226 | 17.3% |
| other_model | 531 | 40.6% |
| other_line | 246 | 18.8% |
| unknown | 11 | 0.8% |
| **Total** | **1,307** | |

Hard negatives (`variant`, `bundle`, `accessory_or_part`, `other_model`): 934 of 1,307 (71.5%); dev 600 of 867, held-out 334 of 440. Every product has at least one `exact` listing (held-out: 38 exact listings over 20 products).

Disagreements between the passes (n = 97): other_line / other_model 45, accessory_or_part / other_line 26, other_model / variant 18, bundle / variant 3, exact / unknown 3, other_model / unknown 1, unknown / variant 1. Only 3 involve `exact`.

## Known limits

- **Few stores per product.** 31 of 61 products have listings from one store (often the brand's own Shopify store, or Best Buy Canada). Best Buy Canada supplies 295 of the 542 CA listings. Large US and German retailers wall plain HTTP and were not used.
- **Captured from Canada.** Every request came from one Canadian IP. US and DE listings are US and German stores as seen from Canada; two US stores showed CAD prices, recorded as currency `unknown`. Prices are context only and never used for labels.
- **Agent labels, owner not yet involved.** Until the owner labels the worklist, `double_labelled` is short and the strict validator fails on it alone.
- **Search-shaped negatives.** `other_model` dominates because brand-store search returns the brand's other models. Exact listings are 8.9%: the held-out precision gate will rest on few exact listings (38) unless more are added.
