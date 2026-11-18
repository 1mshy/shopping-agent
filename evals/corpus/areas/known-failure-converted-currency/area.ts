import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'known-failure-converted-currency',
  status: 'pending',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; reference copy not yet confirmed by the owner)',
    'reports/2026-10-14-web-discovery.md (SUNLU amazon.com "CAD 17.45", fix item 6)',
    'pricewatch/src/pricewatch/stores/bigbox.py (AmazonAdapter._parse converted_from, regional_url)',
    'pricewatch/src/pricewatch/web_discovery.py (regional_url, converted, failure_kind)',
    'pricewatch/tests/test_amazon.py, test_web_discovery.py (converted and regional-link assertions)',
  ],
  cases,
});
