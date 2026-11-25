// S§5.4 tier 2, the title rules: accessory and part rejects, model-token conflicts, variant words,
// as relation labels. Ported from the predecessor's matcher tests; the owner's rulings and the
// listing-identifier rules have their own areas (match-owner-rulings, match-identifiers).
import { defineArea } from '../../harness.ts';
import { accessories } from './cases/accessories.ts';
import { otherProducts } from './cases/other-products.ts';
import { theProduct } from './cases/the-product.ts';
import type { MatchCase } from './contract.ts';
import { PREDECESSOR } from './evidence.ts';

export const area = defineArea<MatchCase>({
  id: 'match-title-rules',
  status: 'implemented',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/matching.py (score, accessory_for, variant_words, _plus_terms, ' +
      '_number_designators)',
    'pricewatch/tests/test_matching.py (every test that asserts a matching decision)',
    'pricewatch/tests/test_recipes.py::test_near_miss_titles_are_caught',
    'pricewatch/tests/test_title_check.py (the title-only assertions)',
    'pricewatch/tests/test_amazon.py (the two accessory-ranking tests)',
    'scripts/eval/2026-10-23-phase5-review.json, scripts/eval/2026-10-23-matching-review.json',
    'reports/2026-10-23-matching.md, reports/2026-10-23-phase5-evaluation.md',
  ],
  cases: [...accessories, ...theProduct, ...otherProducts],
});
