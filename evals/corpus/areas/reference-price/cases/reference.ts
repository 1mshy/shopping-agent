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

const OWNER = (ruling: string) =>
  ({
    how: 'ruling',
    ref: `Owner's ruling of 2026-11-23 (docs/progress.md, "Owner rulings on the Phase 1 questions"): "${ruling}"`,
  }) as const;
const RULING_USER_WINS = OWNER(
  "Reference price: the user's confirmed price wins over the observed median until the user changes it; otherwise the median of recent observations, recomputed as reads arrive.",
);
const RULING_UNKNOWN = OWNER(
  '`unknown` condition is shown with a flag, left out of the reference price, and never triggers a new-item alert.',
);
const SETTLED_MEDIAN = {
  how: 'ruling',
  ref: 'Settled by the orchestrator 2026-11-23, the owner may overrule (docs/progress.md): "an even-count median is the mean of the two middle values rounded half-up to the minor unit"',
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
      listing(2, 13999, { condition: 'new' }),
    ]),
    expected: median(13999, [2]),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:163 test_a_renewed_unit_never_becomes_the_tracking_baseline (best_price 139.99, only the 139.99 offer kept)`,
      },
      SPEC_REF,
    ],
    notes:
      'Predecessor: amazon CAD "114.99" (Renewed, extra condition="renewed") and "139.99" (no condition flag) → 11499 and 13999 CAD. The refurb exclusion is the spec\'s. The predecessor treated the unflagged listing as new (as_new = no condition flag); here it is given condition `new`, because under the owner\'s ruling of 2026-11-23 an `unknown` condition is left out of the reference (unknown-condition-is-left-out-of-the-reference), and this case is about the refurb.',
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
    input: forWatch([listing(1, 12999), listing(2, 13999)]),
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
      'Predecessor: amazon "129.99" and bestbuy "139.99", CAD, no condition flag → 12999 and 13999. The listings are given condition `new` here: the predecessor treated an unflagged listing as new, and under the owner\'s ruling of 2026-11-23 an `unknown` one would be left out. Median of two = (12999 + 13999) / 2 = 26998 / 2 = 13499, an exact integer, so the half-up rounding (even-count-median-rounds-half-up) does not apply.',
  },
  {
    id: 'even-count-median-rounds-half-up',
    what: 'The mean of two middle prices that ends in half a cent is rounded half up',
    input: forWatch([listing(1, 12999), listing(2, 14000)]),
    expected: median(13500, [1, 2]),
    from: [SPEC_REF, SETTLED_MEDIAN],
    specDerived: true,
    notes:
      'Added for the detail settled by the orchestrator on 2026-11-23. Two verified exact new first-party CAD listings: (12999 + 14000) / 2 = 26999 / 2 = 13499.5 → 13500 rounded half up (truncation would give 13499).',
  },
  {
    id: 'unknown-condition-is-left-out-of-the-reference',
    what: 'A cheaper listing whose condition is unknown is left out of the median',
    input: forWatch([listing(1, 9999, { condition: 'unknown' }), listing(2, 12999)]),
    expected: median(12999, [2]),
    from: [RULING_UNKNOWN, SPEC_REF],
    specDerived: true,
    divergence:
      'The predecessor treated a listing with no condition flag as new (as_new, service.py:533-542; asserted by test_service.py:184 test_listings_without_a_condition_flag_are_treated_as_new) and baselined on the cheapest, so it would have taken 9999. The owner ruled on 2026-11-23 that an `unknown` condition is left out of the reference price.',
    notes:
      'Added: an `unknown`-condition listing at 9999 beside a new one at 12999, both verified exact, first-party, CAD. Only 12999 is eligible.',
  },
  {
    id: 'only-unknown-condition-sets-no-reference',
    what: 'A watch whose only verified listing has an unknown condition has no observed reference',
    input: forWatch([listing(1, 13999, { condition: 'unknown' })]),
    expected: { action: 'none', why: 'no_eligible_listing' },
    from: [RULING_UNKNOWN],
    specDerived: true,
    divergence:
      'The predecessor treated a listing with no condition flag as new and would have baselined on it (13999). The owner ruled on 2026-11-23 that an `unknown` condition is left out of the reference price.',
    notes:
      'Added. The listing is still watched and shown with its flag; it is only kept out of the reference. A user-confirmed price would still be the reference.',
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
    id: 'median-reference-is-recomputed-as-reads-arrive',
    what: 'A median reference moves when a new read of its listing arrives',
    input: forWatch([listing(1, 9000)], {
      currency: 'CAD',
      reference: { price: money(10000), kind: 'median_verified' },
    }),
    expected: median(9000, [1]),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:326-328 _initial_baselines (a tracker with a baseline_price is skipped)`,
      },
      RULING_USER_WINS,
    ],
    divergence:
      'The predecessor kept a baseline once set and changed it only through reset_baseline (service.py:1588-1591), so it would have kept 10000. The owner ruled on 2026-11-23 that the median is recomputed as reads arrive.',
    notes:
      "Was `existing-reference-is-kept` (expected `keep`) before the ruling. The watch's reference was the median 10000; its one verified exact listing now reads 9000, so the median of the latest reads is 9000.",
  },
  {
    id: 'unchanged-median-reference-is-kept',
    what: 'A new read that leaves the median where it was keeps the reference',
    input: forWatch([listing(1, 11900), listing(2, 11900)], {
      currency: 'CAD',
      reference: { price: money(11900), kind: 'median_verified' },
    }),
    expected: { action: 'keep' },
    from: [RULING_USER_WINS],
    specDerived: true,
    notes:
      'Added: two verified exact new listings both reading 11900; median (11900 + 11900) / 2 = 11900, equal to the current reference of the same kind.',
  },
  {
    id: 'user-confirmed-price-wins-over-the-median',
    what: 'When the user confirmed a price and verified listings exist, the user price is the reference',
    input: forWatch([listing(1, 9999), listing(2, 10999)], {
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
    from: [RULING_USER_WINS, SPEC_REF],
    specDerived: true,
    notes:
      "Added for the owner's ruling of 2026-11-23. The median of the verified listings would be (9999 + 10999) / 2 = 10499; the user-confirmed CA$120.00 wins.",
  },
  {
    id: 'user-confirmed-reference-is-kept-as-reads-arrive',
    what: 'A user-confirmed reference stays while new reads arrive',
    input: forWatch([listing(1, 9000)], {
      currency: 'CAD',
      reference: { price: money(12000), kind: 'user_confirmed' },
      userConfirmedPrice: money(12000),
    }),
    expected: { action: 'keep' },
    from: [RULING_USER_WINS],
    specDerived: true,
    notes:
      'Added for the owner\'s ruling of 2026-11-23 ("until the user changes it"): a verified listing now reads 9000, but the user\'s CA$120.00 is unchanged, so it stays the reference.',
  },
  {
    id: 'user-changed-confirmed-price-replaces-the-reference',
    what: 'When the user changes the confirmed price, the new one is the reference',
    input: forWatch([listing(1, 9000)], {
      currency: 'CAD',
      reference: { price: money(12000), kind: 'user_confirmed' },
      userConfirmedPrice: money(11000),
    }),
    expected: {
      action: 'set',
      currency: 'CAD',
      price: money(11000),
      kind: 'user_confirmed',
      fromListings: [],
    },
    from: [RULING_USER_WINS],
    specDerived: true,
    notes:
      "Added for the owner's ruling of 2026-11-23: the user moved the price from 12000 to 11000.",
  },
  {
    id: 'cleared-user-price-falls-back-to-the-median',
    what: 'When the user clears the confirmed price, the observed median becomes the reference',
    input: forWatch([listing(1, 9999)], {
      currency: 'CAD',
      reference: { price: money(12000), kind: 'user_confirmed' },
      userConfirmedPrice: null,
    }),
    expected: median(9999, [1]),
    from: [RULING_USER_WINS],
    specDerived: true,
    notes:
      'Added for the owner\'s ruling of 2026-11-23 ("otherwise the median of recent observations"): with no user price left, the median of the one verified exact listing, 9999.',
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
      'Added: a watch whose currency was adopted (CAD) and whose only listing is exact but not verified, and a user-confirmed CA$120.00. Chosen so the open question does not apply: how a user price relates to "currency adopted only from the first real read". Which wins when both exist is the owner\'s ruling of 2026-11-23 (user-confirmed-price-wins-over-the-median).',
  },
];
