import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'price-text-parsing',
  status: 'pending',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/money.py (parse_price, _trim)',
    'pricewatch/src/pricewatch/extract.py (_OTHER_MONEY, _PER_MEASURE, _other_money)',
    'pricewatch/src/pricewatch/recipes.py (find_price.located: currency_mismatch)',
    'pricewatch/tests/test_money.py',
    'pricewatch/tests/test_displayed_price.py (price shapes only)',
    'reports/2026-10-18-pre-explorer-fixes.md (section 1)',
    'docs/progress.md 2026-11-23 "Owner rulings on the Phase 1 questions" ("1.299 €" by the shop\'s locale)',
  ],
  cases,
});
