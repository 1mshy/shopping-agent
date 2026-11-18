import type { Money } from '@agentic-dasher/shared';
import type { ListingRead, ObservedRead, RestockCase, RestockInput } from '../contract.ts';

const T = 'pricewatch/tests/test_restock.py';
const S = 'pricewatch/src/pricewatch/service.py';
const SPEC_RESTOCK = {
  how: 'spec',
  ref: 'S§5.8 Alert rules: "A restock fires only on an out→in transition (first sighting is not one), with a watermark rather than a cooldown."',
} as const;
const PRED =
  'Predecessor listing: west3d, "Bambu Lab X1C", CAD Decimal("119") → 11900 CAD; restock watch in CAD.';

const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });

const at = (hhmm: string) => `2026-11-17T${hhmm}:00.000Z`;

function seen(
  observationId: number,
  hhmm: string,
  availability: ObservedRead['availability'],
  more: Partial<ObservedRead> = {},
): ObservedRead {
  return {
    kind: 'observation',
    observationId,
    observedAt: at(hhmm),
    currency: 'CAD',
    price: 11900,
    availability,
    readPath: 'platform_json',
    rung: 'api',
    ...more,
  };
}

const failed = (hhmm: string): ListingRead => ({ kind: 'failed', at: at(hhmm), rung: 'api' });

/** The restock rule has been on since the watch was made, the day before. */
const RULE_ON = '2026-11-16T12:00:00.000Z';

/** One CAD listing; `now` is its latest read unless given. */
function oneListing(
  reads: readonly ListingRead[],
  watch: Partial<RestockInput['watch']> = {},
  evaluatedAt?: string,
): RestockInput {
  const last = reads[reads.length - 1];
  const latest =
    last === undefined ? at('12:00') : last.kind === 'failed' ? last.at : last.observedAt;
  const now = evaluatedAt ?? latest;
  return {
    now,
    watch: {
      currency: 'CAD',
      targetPrice: null,
      restockRuleOnSince: RULE_ON,
      lastAcceptedRestockAt: null,
      ...watch,
    },
    listings: [{ listingId: 11, reads }],
  };
}

const OUT_IN = [seen(501, '08:00', 'out'), seen(502, '09:00', 'in')];

const back = (observationId: number, hhmm: string, more: { targetReached?: boolean } = {}) =>
  ({
    fire: true,
    listingId: 11,
    observationId,
    price: cad(11900),
    transitionAt: at(hhmm),
    targetReached: more.targetReached ?? false,
  }) as const;

export const restockCases: readonly RestockCase[] = [
  {
    id: 'first-sighting-in-stock-is-not-a-restock',
    what: 'A listing first seen in stock has not come back from anything',
    input: oneListing([seen(502, '09:00', 'in')]),
    expected: { fire: false, silence: 'first_sighting' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:52 test_upsert_records_a_restock_only_on_out_to_in (None→True leaves last_restocked_at None)`,
      },
      SPEC_RESTOCK,
    ],
    notes: PRED,
  },
  {
    id: 'still-sold-out-is-quiet',
    what: 'A listing that is still out of stock does not fire',
    input: oneListing([seen(501, '08:00', 'out')]),
    expected: { fire: false, silence: 'not_in_stock' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (still sold out)`,
      },
    ],
    notes: PRED,
  },
  {
    id: 'out-to-in-fires-and-names-the-listing',
    what: 'Out of stock then in stock fires, naming the listing and its price',
    input: oneListing(OUT_IN),
    expected: back(502, '09:00'),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (first return)`,
      },
      SPEC_RESTOCK,
    ],
    notes: `${PRED} The predecessor's alert said "back in stock at west3d — CA$119.00"; the text is formatting, the decision carries the listing and Money.`,
  },
  {
    id: 'same-in-state-after-the-alert-is-quiet',
    what: 'Still in stock after the restock alert was accepted: nothing new',
    input: oneListing([...OUT_IN, seen(503, '09:30', 'in')], {
      lastAcceptedRestockAt: at('09:01'),
    }),
    expected: { fire: false, silence: 'already_told' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (same state: quiet)`,
      },
    ],
    notes: `${PRED} The transition at 09:00 is not later than the watermark (accepted 09:01).`,
  },
  {
    id: 'sold-out-again-is-quiet',
    what: 'Going out of stock again does not fire',
    input: oneListing([...OUT_IN, seen(504, '10:00', 'out')], {
      lastAcceptedRestockAt: at('09:01'),
    }),
    expected: { fire: false, silence: 'not_in_stock' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (sold out again: quiet)`,
      },
    ],
    notes: PRED,
  },
  {
    id: 'second-return-fires-without-a-cooldown',
    what: 'The next out→in fires again, two hours after the last restock alert',
    input: oneListing([...OUT_IN, seen(504, '10:00', 'out'), seen(505, '11:00', 'in')], {
      lastAcceptedRestockAt: at('09:01'),
    }),
    expected: back(505, '11:00'),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:111 test_restock_fires_once_per_return_and_again_after_the_next_cycle (second return: fires)`,
      },
      SPEC_RESTOCK,
    ],
    notes: `${PRED} 11:00 is later than the watermark 09:01; 1 h 59 min after the last alert, well inside a 12 h cooldown, which restocks do not have.`,
  },
  {
    id: 'failed-read-between-out-and-in-keeps-the-restock',
    what: 'A walled read between sold out and back does not turn the return into a first sighting',
    input: oneListing([seen(501, '08:00', 'out'), failed('08:30'), seen(502, '09:00', 'in')]),
    expected: back(502, '09:00'),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:79 test_a_read_that_says_nothing_about_stock_keeps_the_last_known_state`,
      },
    ],
    notes: `${PRED} The test's middle read is StoreResult(error="bot challenge"); in_stock stayed False and the next in-stock read set last_restocked_at.`,
  },
  {
    id: 'unknown-stock-read-between-out-and-in-keeps-the-restock',
    what: 'A priced read that says nothing about stock leaves the sold-out state in place',
    input: oneListing([
      seen(501, '08:00', 'out'),
      seen(506, '08:30', 'unknown'),
      seen(502, '09:00', 'in'),
    ]),
    expected: back(502, '09:00'),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:729-738 _upsert_offer (stock changes only when result.in_stock is not None)`,
      },
    ],
    notes: PRED,
  },
  {
    id: 'foreign-listing-coming-back-never-fires',
    what: 'A USD listing returning does not fire a CAD watch',
    input: oneListing([
      seen(501, '08:00', 'out', { currency: 'USD', price: 9999 }),
      seen(502, '09:00', 'in', { currency: 'USD', price: 9999 }),
    ]),
    expected: { fire: false, silence: 'not_comparable' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:136 test_a_foreign_listing_coming_back_never_fires_a_cad_watch`,
      },
    ],
    notes: 'Predecessor: amazon USD Decimal("99.99") → 9999 USD on a CAD watch.',
  },
  {
    id: 'cheapest-returned-listing-is-named',
    what: 'When two listings come back, the cheaper one is named',
    input: {
      now: at('09:05'),
      watch: {
        currency: 'CAD',
        targetPrice: null,
        restockRuleOnSince: RULE_ON,
        lastAcceptedRestockAt: null,
      },
      listings: [
        {
          listingId: 11,
          reads: [
            seen(501, '08:00', 'out', { price: 12900 }),
            seen(502, '09:00', 'in', { price: 12900 }),
          ],
        },
        { listingId: 12, reads: [seen(511, '08:05', 'out'), seen(512, '09:05', 'in')] },
      ],
    },
    expected: {
      fire: true,
      listingId: 12,
      observationId: 512,
      price: cad(11900),
      transitionAt: at('09:05'),
      targetReached: false,
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:153 test_the_cheapest_returned_listing_is_the_one_named`,
      },
    ],
    specSilent: true,
    notes:
      'Predecessor: west3d 129 and bambulab 119, both out then in → 12900 and 11900 CAD; fired once naming bambulab 119.0. S§5.8 does not say which listing a restock names when several return; with per-listing scheduling they rarely return in one evaluation.',
  },
  {
    id: 'restock-also-reports-a-reached-target',
    what: 'A returned listing under the target says so in the restock alert',
    input: oneListing(OUT_IN, { targetPrice: cad(15000) }),
    expected: back(502, '09:00', { targetReached: true }),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:174 test_a_watch_with_a_target_and_a_restock_rule_reports_both`,
      },
    ],
    specSilent: true,
    notes: `${PRED} Target Decimal("150") → 15000 CAD. The predecessor's restock alert carried "at or below your target of CA$150.00" and a separate price alert fired too; that price alert is alert-price-rules' (target reached on an in-stock read).`,
  },
  {
    id: 'rule-switched-on-after-a-return-ignores-it',
    what: 'A return that happened before the rule was switched on is not news',
    input: oneListing(OUT_IN, { restockRuleOnSince: at('09:30') }, at('09:30')),
    expected: { fire: false, silence: 'already_told' },
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:263 test_enabling_the_rule_later_ignores_a_restock_that_already_happened (not fired)`,
      },
      {
        how: 'function-reading',
        ref: `${S}:1582-1586 set_tracker (switching the rule on sets last_restock_notified_at = utcnow())`,
      },
    ],
    notes: `${PRED} The listing went out and back before 09:30, when the user asked for restock alerts.`,
  },
  {
    id: 'rule-switched-on-later-fires-on-the-next-return',
    what: 'After the rule is switched on, the next out→in fires',
    input: oneListing([...OUT_IN, seen(504, '10:00', 'out'), seen(505, '11:00', 'in')], {
      restockRuleOnSince: at('09:30'),
    }),
    expected: back(505, '11:00'),
    from: [
      {
        how: 'test-assertion',
        ref: `${T}:263 test_enabling_the_rule_later_ignores_a_restock_that_already_happened (next return fires)`,
      },
    ],
    notes: PRED,
  },
  {
    id: 'restock-rule-off-never-fires',
    what: 'A watch without the restock rule does not fire on a return',
    input: oneListing(OUT_IN, { restockRuleOnSince: null }),
    expected: { fire: false, silence: 'rule_off' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1276 _evaluate_trackers (if tracker.alert_on_restock)`,
      },
    ],
    notes: PRED,
  },
  {
    id: 'return-followed-by-failed-read-does-not-fire',
    what: 'A listing that came back but whose latest read failed is not fired on',
    input: oneListing([...OUT_IN, failed('09:30')]),
    expected: { fire: false, silence: 'stale_read' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:1219-1225 _restocked_offer (requires not o.last_error)`,
      },
      { how: 'spec', ref: 'S§2 invariant 10: a failed read "never alerts"' },
    ],
    notes: PRED,
  },
];
