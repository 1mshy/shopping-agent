import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'regional-url',
  status: 'pending',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; reference copy not yet confirmed by the owner)',
    'pricewatch/src/pricewatch/stores/base.py (StoreAdapter.storefront, regional_url)',
    'pricewatch/src/pricewatch/stores/bigbox.py (AmazonAdapter.regional_url, ASIN_RE)',
    'pricewatch/src/pricewatch/web_discovery.py (regional_url, pick_candidates)',
    'pricewatch/src/pricewatch/service.py (_fetch_for_tracking)',
    'pricewatch/tests/test_amazon.py, test_preferences.py, test_web_discovery.py (storefront and link assertions)',
  ],
  cases,
});
