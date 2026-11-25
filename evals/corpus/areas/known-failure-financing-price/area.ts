import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'known-failure-financing-price',
  status: 'implemented',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'reports/2026-10-18-pre-explorer-fixes.md (B1; lines 1669-1670: Affirm 19 / 13 / 14 at Rona and SportChek, Walmart 124.50 financing-options-v2)',
    'pricewatch/src/pricewatch/money.py (parse_price)',
    'pricewatch/src/pricewatch/extract.py (_OTHER_MONEY, _NOT_A_UNITS_PRICE)',
    'pricewatch/tests/test_retail_reliability.py, test_displayed_price.py, test_figures_offered.py (financing assertions)',
  ],
  cases,
});
