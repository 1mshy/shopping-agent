// S§5.4 tier 1 as far as the predecessor had it: the identifiers a listing states (MPN or model
// number, canonical URL path) against the model number in the query. The predecessor had no GTIN
// rule, so there is no GTIN case (see cases/identifiers.ts). A model number in the URL path is
// supporting evidence, never identity on its own (settled by the orchestrator 2026-11-23).
import { defineArea } from '../../harness.ts';
import { PREDECESSOR } from '../match-title-rules/evidence.ts';
import { identifiers } from './cases/identifiers.ts';
import type { MatchCase } from './contract.ts';

export const area = defineArea<MatchCase>({
  id: 'match-identifiers',
  status: 'implemented',
  sources: [
    PREDECESSOR,
    'pricewatch/src/pricewatch/recipes.py (_title_check, _names_the_product, _other_names, ' +
      '_own_designators, _model_numbers, near_miss, _variant_in)',
    'pricewatch/tests/test_title_check.py',
    'pricewatch/src/pricewatch/matching.py (model_tokens)',
  ],
  cases: identifiers,
});
