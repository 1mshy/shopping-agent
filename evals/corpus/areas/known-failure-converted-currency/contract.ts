// Known failure: a converted currency (plan P0 workstream 3, "converted currency"). From a
// Canadian address amazon.com shows Amazon's conversion of its USD price, labelled CAD on one read
// and "$" on the next. Labelled USD both times, "$99.99" after "CAD 138.83" looked like a drop
// (tests/test_amazon.py test_com_keeps_the_currency_it_actually_displayed). Known since 2026-09-02;
// on 2026-10-15 web discovery read the amazon.com SUNLU listing at "CAD 17.45", about half of the
// CA$33.92 amazon.ca bills (reports/2026-10-14-web-discovery.md lines 135-142 and 289-303).
// Two functions get it right together: the link is moved to the user's storefront
// (`regional-url`), and a converted figure that is read anyway is refused (`currency-resolution`).
// The owner's ruling of 2026-11-23 confirms the refusal: a site's conversions are refused, while a
// Shopify Markets presentment price is the shop's own price for that market. Amazon's CAD figure on
// amazon.com is the former.
import type {
  CaseMeta,
  CurrencyEvidence,
  CurrencyExpected,
} from '../currency-resolution/contract.ts';
import type { ListingUrlInput, ListingUrlResult } from '../regional-url/contract.ts';

export type { CurrencyResolution, ResolveCurrency } from '../currency-resolution/contract.ts';
export { asExpected, evidence } from '../currency-resolution/contract.ts';
export type { RegionalListingUrl, Storefronts } from '../regional-url/contract.ts';

export type ConvertedCurrencyCase =
  | (CaseMeta & {
      readonly subject: 'regionalListingUrl';
      readonly input: ListingUrlInput;
      readonly expected: ListingUrlResult;
    })
  | (CaseMeta & {
      readonly subject: 'resolveCurrency';
      readonly input: CurrencyEvidence;
      readonly expected: CurrencyExpected;
    });
