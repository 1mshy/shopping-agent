import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'currency-resolution',
  status: 'implemented',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/money.py (currency_from_text, region_for_host, named_region_for_host, currency_for_host)',
    'pricewatch/src/pricewatch/stores/learned.py (bare_dollar, country_in_name, read_page)',
    'pricewatch/src/pricewatch/extract.py (extract, _declared_currency)',
    'pricewatch/src/pricewatch/stores/shopify.py (market_currency)',
    'pricewatch/tests/test_canada.py, test_money.py, test_preferences.py, test_recipes.py, test_shopify.py (currency assertions only)',
    'docs/spec.md S§5.2 (hreflang/og:locale step, which the predecessor did not have)',
    'docs/progress.md 2026-11-23 "Owner rulings on the Phase 1 questions" (Shopify Markets presentment price; "approx." figures) and "Settled by the orchestrator" (the ranking of currency evidence)',
  ],
  cases,
});
