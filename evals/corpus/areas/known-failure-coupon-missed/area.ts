import { defineArea } from '../../harness.ts';
import { cases } from './cases/cases.ts';

export const area = defineArea({
  id: 'known-failure-coupon-missed',
  status: 'implemented',
  sources: [
    'hermes-shopping at ~/Documents/GitHub/hermes-shopping, branch browser-agent, commit 51db126, read as the working tree stood on 2026-11-18 (uncommitted files present; confirmed by the owner as the reference copy on 2026-11-23)',
    'pricewatch/src/pricewatch/stores/bigbox.py (coupon_in_text, find_coupon, _region_text, AmazonAdapter._parse; incident comment lines 60-63)',
    'pricewatch/tests/test_amazon.py (coupon tests, from line 327)',
    'pricewatch/tests/fixtures/amazon_pdp_coupon.html (hand-built amazon.ca page; no personal data)',
    'commit 9678053 (2026-09-06) "made amazon hook aware of coupons"',
    'docs/progress.md 2026-11-23 "Owner rulings on the Phase 1 questions" (alert price; clip and code coupons) and "Settled by the orchestrator" (percentage coupons round half up)',
  ],
  cases,
});
