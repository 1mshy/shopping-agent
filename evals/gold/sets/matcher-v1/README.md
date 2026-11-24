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
| `labels/m1.json` | 174 second labels and 6 adjudicated rulings (`m1` = Claude Mythos 5.2, reviewing in the owner's place) | the review of 2026-11-23, below |
| `REVIEW.md` | The review sheet for the worklist (blind: no agent label shown), filled in | `capture/review-sheet.mjs`, then the review |
| `REVIEW-disagreements.md` | The sheet for the 97 snapshots where the two agent passes disagreed; the 25 flagged rows are ruled | `capture/review-sheet.mjs`, then the review |

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

The table and the counts above are the primary labels. The gold relation is the adjudicated label where one exists (next section).

## Review: second labels and rulings (2026-11-23)

The owner handed the review to Claude Mythos 5.2 (`claude-mythos-5-2`, handle `m1`) instead of doing it by hand. **No person has labelled this set.** The second labeller is another Claude model, so its errors are likely to be correlated with the primary labeller's, and the agreement below is weaker evidence than a person's labels would be.

**Blind second labels (n = 174).** Labelled from `REVIEW.md` alone and filed in `labels/m1.json` before `REVIEW-disagreements.md`, `agent-passes.json` or `labels/a1.json` were opened. `double-label.ts agreement`:

| | n | Raw agreement | Cohen's kappa |
|---|--:|--:|--:|
| Seven relations | 174 | 164/174 = 0.943 | 0.919 |
| Exact versus not exact | 174 | 174/174 = 1.000 | 1.000 |

The worklist holds 12 `exact` listings; both labellers named the same 12. The 10 disagreements are all between kinds of non-match: other_line / other_model 6, other_model / variant 2 (`braun-series-9-ca-s06`, `oneblade-ca-s18`), bundle / variant 2 (`raspberry-pi-5-s05` and `-s07`, kits built around a board of another memory size).

**Rulings on the 25 flagged disagreements.** 19 keep the tie-break (`ok` in the sheet); 6 differ and are `adjudicated` labels in `labels/m1.json`, each with its reason in `note`:

| Snapshot | Primary | Ruling | Reason |
|---|---|---|---|
| `braun-series-9-ca-s06` | other_model | variant | The 9677cc is the same Series 9 PRO+ shaver with another colour and accessory set |
| `breville-barista-express-ca-s16` | exact | unknown | Colour not stated; the MPN is an ASIN and the GTIN a marketplace code |
| `happybrush-de-s17` | variant | bundle | A value set is the toothbrush plus other items |
| `happybrush-de-s18` | variant | bundle | The same, in another colour; the set labels a kit around another variant as bundle |
| `ninja-af101-s01` | exact | unknown | MPN "AF100WM/AF101" names two models, and the set labels the AF100C other_model |
| `polyterra-pla-s13` | other_model | unknown | Panchroma Matte is the renamed PolyTerra, but this listing states neither the rename nor diameter or weight |

The three rulings to `unknown` follow one rule, which the set already applied elsewhere (`mx-master-3s-s02`, `sonicare-4100-s02`): `exact` needs the model and each must-have that tells the sold variants apart to be in the listing's own fields, or a matching identifier. A reseller's code (an ASIN, a `999…` marketplace GTIN) is not one.

**Gold relations after the rulings:** exact 114, variant 124, bundle 54, accessory_or_part 226, other_model 529, other_line 246, unknown 14. Hard negatives 933 of 1,307 (71.4%; dev 600 of 867, held-out 333 of 440). Exact listings: dev 77, held-out 37; every product still has at least one. The strict validator passes with 0 violations.

**Not reviewed.** The 72 unflagged disagreements (both passes say non-match) keep their tie-break. The 1,050 snapshots off the worklist where the passes agreed were not reviewed.

**Conventions the review found unsettled**, for the owner:

- *other_model versus other_line* has no rule that reproduces. The second labels used "same brand and same kind of product is other_model"; the tie-breaks mostly used "another named line is other_line" (Momentum versus HD, Anker Prime versus other Anker power banks). It does not affect exact versus not exact or the hard-negative share by more than a few listings, but the seven-relation labels on this boundary should not be read closely.
- *A kit around another variant of the target* (a Raspberry Pi 5 kit with the 2 GB board when the target is the 8 GB board) is `bundle` in the primary labels although the target itself is not in it.
- *A renamed product* (PolyTerra PLA became Panchroma Matte PLA): `polyterra-pla-s03` says "Formerly PolyTerra" in its title and is `exact`; `-s13` does not and is now `unknown`. Whether a rename the listing does not state may count as `exact` is the owner's call.

## Known limits

- **Few stores per product.** 31 of 61 products have listings from one store (often the brand's own Shopify store, or Best Buy Canada). Best Buy Canada supplies 295 of the 542 CA listings. Large US and German retailers wall plain HTTP and were not used.
- **Captured from Canada.** Every request came from one Canadian IP. US and DE listings are US and German stores as seen from Canada; two US stores showed CAD prices, recorded as currency `unknown`. Prices are context only and never used for labels.
- **Model labels only.** Primary labels, second labels and rulings all come from Claude models (Opus 5.5, then Mythos 5.2 in the owner's place). No person has labelled any snapshot.
- **Search-shaped negatives.** `other_model` dominates because brand-store search returns the brand's other models. Exact listings are 8.7% after the rulings: the held-out precision gate will rest on few exact listings (37) unless more are added.
