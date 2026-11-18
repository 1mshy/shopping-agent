import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import type { ReferenceCase, ReferenceInput, ReferenceListing } from '../contract.ts';

const T = 'pricewatch/tests/test_service.py';
const I = 'pricewatch/tests/test_watch_intake.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_REF = {
  how: 'spec',
  ref: 'S§5.8 Reference price: "the median of verified exact listings or a user-confirmed price, never the first match. A refurb, open-box or marketplace listing never becomes the baseline when a new first-party one exists. One URL belongs to one product\'s history."',
} as const;
const SPEC_ADOPT = {
  how: 'spec',
  ref: 'S§5.8 Intake: "The baseline and currency are adopted only from the first real read."',
} as const;

const money = (amountMinor: number, currency: MinorUnitCurrency = 'CAD'): Money => ({
  amountMinor,
  currency,
});
const READ_AT = '2026-11-17T09:00:00.000Z';

/** A verified exact, new, first-party retail listing of product 1, read at `price`. */
function listing(
  listingId: number,
  price: number,
  more: Partial<Omit<ReferenceListing, 'listingId'>> = {},
  currency: MinorUnitCurrency = 'CAD',
): ReferenceListing {
  return {
    listingId,
    productId: 1,
    channel: 'retail',
    sellerKind: 'first_party',
    condition: 'new',
    relation: 'exact',
    identityVerified: true,
    latest: {
      kind: 'observation',
      observationId: 800 + listingId,
      observedAt: READ_AT,
      currency,
      price,
      availability: 'in',
    },
    ...more,
  };
}

function forWatch(
  listings: readonly ReferenceListing[],
  watch: Partial<ReferenceInput['watch']> = {},
): ReferenceInput {
  return {
    watch: {
      productId: 1,
      marketCurrency: 'CAD',
      currency: null,
      reference: null,
      userConfirmedPrice: null,
      ...watch,
    },
    listings,
  };
}

const median = (amountMinor: number, fromListings: number[], currency: MinorUnitCurrency = 'CAD') =>
  ({
    action: 'set',
    currency,
    price: money(amountMinor, currency),
    kind: 'median_verified',
    fromListings,
  }) as const;

export const referenceCases: readonly ReferenceCase[] = [
  {
    id: 'renewed-unit-never-becomes-the-baseline',
    what: 'A cheaper renewed unit is passed over when a new first-party listing exists',
    input: forWatch([
      listing(1, 11499, { condition: 'refurbished' }),
      listing(2, 13999, { condition: 'unknown' }),
    ]),
    expected: median(13999, [2]),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:163 test_a_renewed_unit_never_becomes_the_tracking_baseline (best_price 139.99, only the 139.99 offer kept)`,
      },
      SPEC_REF,
    ],
    specSilent: true,
    notes:
      'Predecessor: amazon CAD "114.99" (Renewed, extra condition="renewed") and "139.99" (no condition flag) → 11499 and 13999 CAD. The refurb exclusion is the spec\'s; the spec is silent on whether a listing with no condition signal (`unknown`) counts as new, and the predecessor treated it as new (as_new = no condition flag), which this case ports.',
  },
  {
    id: 'refurb-only-is-still-the-baseline',
    what: 'When a renewed unit is all there is, it is the baseline',
    input: forWatch([listing(1, 11499, { condition: 'refurbished' })]),
    expected: median(11499, [1]),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:176 test_refurbs_are_still_tracked_when_nothing_else_is_listed (best_price 114.99)`,
      },
    ],
    specSilent: true,
    notes:
      'Predecessor: one amazon CAD "114.99" renewed listing → 11499. S§5.8 only says what happens when a new first-party listing exists.',
  },
  {
    id: 'two-listings-median-not-the-cheapest',
    what: 'With two new listings the reference is their median, not the cheaper one',
    input: forWatch([
      listing(1, 12999, { condition: 'unknown' }),
      listing(2, 13999, { condition: 'unknown' }),
    ]),
    expected: median(13499, [1, 2]),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:184 test_listings_without_a_condition_flag_are_treated_as_new (best_price 129.99, both kept)`,
      },
      SPEC_REF,
    ],
    divergence:
      'The predecessor baselined on the cheapest listing (min, service.py:331 and 555-557): 12999. S§5.8 takes the median of verified exact listings and "never the first match".',
    notes:
      'Predecessor: amazon "129.99" and bestbuy "139.99", CAD, no condition flag → 12999 and 13999. Median of two = (12999 + 13999) / 2 = 13499, an exact integer; how an odd half is rounded is open (report).',
  },
  {
    id: 'odd-count-median-not-the-first-match',
    what: 'Three verified listings give their middle price, whatever came first',
    input: forWatch([listing(1, 11900), listing(2, 13900), listing(3, 12500)]),
    expected: median(12500, [1, 2, 3]),
    from: [SPEC_REF],
    specDerived: true,
    notes:
      'Added: three verified exact new first-party CAD listings; the first match (and the cheapest) is 11900. Sorted 11900, 12500, 13900 → median 12500.',
  },
  {
    id: 'marketplace-seller-never-the-baseline-beside-first-party',
    what: 'A cheaper third-party marketplace seller is passed over when a first-party listing exists',
    input: forWatch([
      listing(1, 9999, { channel: 'marketplace', sellerKind: 'marketplace_seller' }),
      listing(2, 11900),
    ]),
    expected: median(11900, [2]),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:533-542 track_query (as_new excludes extra condition and extra marketplace; kept only when that is all there is)`,
      },
      SPEC_REF,
    ],
    notes:
      "The predecessor's marketplace flag came from bestbuy.ca third-party sellers (README.md:672-674).",
  },
  {
    id: 'listing-in-the-users-currency-sets-the-reference',
    what: "A cheaper USD listing does not set a CAD shopper's reference; the CAD listing does",
    input: forWatch([listing(1, 7999, {}, 'USD'), listing(2, 11900)]),
    expected: median(11900, [2]),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:311 test_track_query_baselines_on_a_listing_in_the_users_currency (currency CAD, west3d, 119.0; the USD listing still watched)`,
      },
      SPEC_REF,
    ],
    notes:
      'Predecessor: amazon USD "79.99", west3d CAD "119" with preference CAD → 7999 USD, 11900 CAD.',
  },
  {
    id: 'link-watch-adopts-the-currency-it-reads',
    what: 'A link that bills in USD gives the watch USD, even for a CAD shopper',
    input: forWatch([listing(1, 10000, {}, 'USD')]),
    expected: median(10000, [1], 'USD'),
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:155 test_url_adopts_actual_currency_including_after_restart (currency USD, baseline_price 100)`,
      },
      SPEC_ADOPT,
    ],
    notes: 'Predecessor: the link read USD "100" while the preferred currency was CAD → 10000 USD.',
  },
  {
    id: 'failed-first-read-sets-no-reference',
    what: 'A watch whose only lookup failed has no reference and no currency yet',
    input: forWatch([listing(1, 0, { latest: { kind: 'failed', at: READ_AT } })]),
    expected: { action: 'none', why: 'no_real_read' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:41 test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying (baseline_price None after "Retailer blocked request")`,
      },
      SPEC_ADOPT,
    ],
  },
  {
    id: 'first-real-read-sets-the-reference',
    what: 'The first successful read after failures sets the reference and the currency',
    input: forWatch([listing(1, 10000)]),
    expected: median(10000, [1]),
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:41 test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying (after the sweep: baseline_price 100, currency CAD)`,
      },
      SPEC_ADOPT,
    ],
    notes: 'Predecessor: the recovered read CAD "100" → 10000 CAD.',
  },
  {
    id: 'listing-of-another-product-is-not-used',
    what: "A listing whose URL belongs to another product's history never sets this reference",
    input: forWatch([listing(1, 9000, { productId: 2 }), listing(2, 11900)]),
    expected: median(11900, [2]),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:384-388 _discover_product ("An offer URL belongs to one product; never silently attach its price history to a second, unrelated product")`,
      },
      { how: 'function-reading', ref: `${S}:436-439 _attach_web_listings (same rule)` },
      SPEC_REF,
    ],
  },
  {
    id: 'existing-reference-is-kept',
    what: 'A watch that has its reference keeps it when a lower price is read',
    input: forWatch([listing(1, 9000)], {
      currency: 'CAD',
      reference: { price: money(10000), kind: 'median_verified' },
    }),
    expected: { action: 'keep' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:326-328 _initial_baselines (a tracker with a baseline_price is skipped)`,
      },
    ],
    specSilent: true,
    notes:
      "The predecessor changed a baseline only through reset_baseline (service.py:1588-1591). Whether S§5.8's median is recomputed as listings change is open (report).",
  },
  {
    id: 'unverified-or-variant-listing-is-not-in-the-median',
    what: 'A cheaper listing of another variant is left out of the median',
    input: forWatch([listing(1, 8999, { relation: 'variant' }), listing(2, 11900)]),
    expected: median(11900, [2]),
    from: [SPEC_REF],
    specDerived: true,
    notes:
      'Added: a verified listing whose relation is `variant` at 8999 beside an exact one at 11900. Only verified exact listings count.',
  },
  {
    id: 'user-confirmed-price-when-no-verified-listing',
    what: 'With no verified exact listing, the price the user confirmed is the reference',
    input: forWatch([listing(1, 9999, { identityVerified: false })], {
      currency: 'CAD',
      userConfirmedPrice: money(12000),
    }),
    expected: {
      action: 'set',
      currency: 'CAD',
      price: money(12000),
      kind: 'user_confirmed',
      fromListings: [],
    },
    from: [SPEC_REF],
    specDerived: true,
    notes:
      'Added: a watch whose currency was adopted (CAD) and whose only listing is exact but not verified, and a user-confirmed CA$120.00. Chosen so neither open question applies: which of the two wins when both exist, and how a user price relates to "currency adopted only from the first real read".',
  },
];
