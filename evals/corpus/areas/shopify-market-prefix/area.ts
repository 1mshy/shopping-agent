import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'shopify-market-prefix',
  status: 'implemented',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/stores/shopify.py (_locale_prefix, _locale_market, _locale_candidates, _EXTRA_LOCALES, preferred_market, ShopifyAdapter.search)',
    'pricewatch/tests/test_shopify.py (market prefix and search assertions)',
  ],
  cases,
});
