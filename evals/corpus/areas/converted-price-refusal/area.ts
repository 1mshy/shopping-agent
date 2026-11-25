import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'converted-price-refusal',
  status: 'implemented',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/stores/bigbox.py (AmazonAdapter._parse, _currency_for, _TLD_CURRENCY)',
    'pricewatch/src/pricewatch/web_discovery.py (converted, usable, failure_kind)',
    'pricewatch/src/pricewatch/recipes.py (find_price.located, _refuse_conflict)',
    'pricewatch/tests/test_amazon.py, test_retail_reliability.py, test_recipes.py (converted and conflict assertions)',
  ],
  cases,
});
