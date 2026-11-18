import type { Money } from '@agentic-dasher/shared';
import type { IntakeCase, IntakeDecision, IntakeInput, IntakeRules } from '../contract.ts';

const I = 'pricewatch/tests/test_watch_intake.py';
const R = 'pricewatch/tests/test_restock.py';
const S = 'pricewatch/src/pricewatch/service.py';
const RUN = 'offline run of service.py:161 _watch_input';
const SPEC_INTAKE = {
  how: 'spec',
  ref: 'S§5.8 Intake: "Save first (Invariant 9). URL normalisation strips tracking parameters and keeps variant parameters. … The baseline and currency are adopted only from the first real read. The default rule is a 5% drop."',
} as const;

const cad = (amountMinor: number): Money => ({ amountMinor, currency: 'CAD' });

const NO_RULES: IntakeRules = {
  targetPrice: null,
  dropBasisPoints: null,
  restock: false,
  cooldownSeconds: null,
};
type SavedRules = Extract<IntakeDecision, { action: 'create' }>['rules'];
const DEFAULT_SAVED: SavedRules = {
  targetPrice: null,
  dropBasisPoints: 500,
  restock: false,
  cooldownSeconds: 43200,
};
const SAVED = { currency: null, referencePrice: null, lookup: 'queued' } as const;

function given(
  input: string,
  rules: Partial<IntakeRules> = {},
  existing: IntakeInput['existing'] = [],
): IntakeInput {
  return { input, rules: { ...NO_RULES, ...rules }, existing };
}

function createLink(link: string, rules = DEFAULT_SAVED): IntakeDecision {
  return {
    ok: true,
    action: 'create',
    kind: 'product',
    normalised: link,
    key: `url:${link}`,
    rules,
    saved: SAVED,
  };
}

const BLUE = 'https://shop.example/products/printer?variant=blue';

export const intakeCases: readonly IntakeCase[] = [
  {
    id: 'tracking-parameter-stripped-variant-kept',
    what: 'A pasted link loses utm_source, keeps variant, and gets https://',
    input: given('shop.example/products/printer?variant=blue&utm_source=email'),
    expected: createLink(BLUE),
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:114 test_url_tracking_parameters_deduplicate_but_variants_do_not`,
      },
      { how: 'offline-run', ref: `${RUN} → ("${BLUE}", "url:${BLUE}")` },
      SPEC_INTAKE,
    ],
  },
  {
    id: 'same-link-with-fragment-is-the-existing-watch',
    what: 'The same link with a fragment is the watch already saved, not a new one',
    input: given('https://shop.example/products/printer?variant=blue#details', {}, [
      { watchId: 1, key: `url:${BLUE}`, active: true },
    ]),
    expected: { ok: true, action: 'existing', watchId: 1, key: `url:${BLUE}`, status: 'active' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:114 test_url_tracking_parameters_deduplicate_but_variants_do_not (repeated["tracker_id"] == first["tracker_id"])`,
      },
      SPEC_INTAKE,
    ],
  },
  {
    id: 'other-variant-is-a-new-watch',
    what: 'The same product link with another variant parameter is a separate watch',
    input: given('https://shop.example/products/printer?variant=red', {}, [
      { watchId: 1, key: `url:${BLUE}`, active: true },
    ]),
    expected: createLink('https://shop.example/products/printer?variant=red'),
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:114 test_url_tracking_parameters_deduplicate_but_variants_do_not (other["tracker_id"] != first["tracker_id"])`,
      },
      SPEC_INTAKE,
    ],
  },
  {
    id: 'every-tracking-parameter-kind-is-stripped',
    what: 'utm_*, gclid, fbclid, ref, ref_ and tag go in any case; scheme and host are lower-cased; the path keeps its case',
    input: given(
      'HTTPS://Shop.Example/Products/Printer?utm_medium=x&color=red&gclid=1&Ref=abc&tag=foo&fbclid=z&ref_=nav#x',
    ),
    expected: createLink('https://shop.example/Products/Printer?color=red'),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:172-176 _watch_input (drops utm_* and fbclid, gclid, ref, ref_, tag by lower-cased name)`,
      },
      { how: 'offline-run', ref: `${RUN} → "https://shop.example/Products/Printer?color=red"` },
    ],
    notes:
      "Which parameters count as tracking is the predecessor's list; S§5.8 names none. `color` is a variant-style parameter and is kept.",
  },
  {
    id: 'parameters-sorted-blank-values-kept',
    what: 'Kept parameters are sorted, and a blank value is not dropped',
    input: given('https://shop.example/p?b=2&a=1&size='),
    expected: createLink('https://shop.example/p?a=1&b=2&size='),
    from: [{ how: 'offline-run', ref: `${RUN} → "https://shop.example/p?a=1&b=2&size="` }],
    specSilent: true,
    notes:
      'Sorting is how the predecessor made two orders of one link one key (urlencode(sorted(params))).',
  },
  {
    id: 'bare-link-gets-https-keeps-port',
    what: 'A link typed without a scheme gets https://, keeps its port, and loses an upper-case UTM_ parameter',
    input: given('www.shop.example:8443/p?UTM_Campaign=fall'),
    expected: createLink('https://www.shop.example:8443/p'),
    from: [{ how: 'offline-run', ref: `${RUN} → "https://www.shop.example:8443/p"` }],
  },
  {
    id: 'host-only-link-gets-root-path',
    what: 'A link with no path is saved with "/"',
    input: given('https://shop.example'),
    expected: createLink('https://shop.example/'),
    from: [{ how: 'offline-run', ref: `${RUN} → "https://shop.example/"` }],
    specSilent: true,
  },
  {
    id: 'name-whitespace-collapsed-key-casefolded',
    what: 'A typed name has its whitespace collapsed; its dedupe key is case-folded',
    input: given('  Example   Printer X1  ', { targetPrice: cad(8000) }),
    expected: {
      ok: true,
      action: 'create',
      kind: 'query',
      normalised: 'Example Printer X1',
      key: 'query:example printer x1',
      rules: {
        targetPrice: cad(8000),
        dropBasisPoints: null,
        restock: false,
        cooldownSeconds: 43200,
      },
      saved: SAVED,
    },
    from: [
      {
        how: 'offline-run',
        ref: `${RUN}("  example   printer x1  ") → ("example printer x1", "query:example printer x1"); ("Example Printer X1") → key "query:example printer x1"`,
      },
      {
        how: 'test-assertion',
        ref: `${I}:71 test_unmatched_name_survives_restart_and_is_discovered_by_sweep (target_price 80, drop_pct None)`,
      },
      SPEC_INTAKE,
    ],
    divergence:
      "The predecessor stamped a name watch with the user's preferred currency at save time (service.py:292-293: currency = preferred_currency() for query: keys). S§5.8 adopts the currency only from the first real read, so a name watch is saved with none.",
    notes: 'Predecessor target_price 80 → 8000 (the test patches the preferred currency to CAD).',
  },
  {
    id: 'duplicate-name-keeps-the-first-watch',
    what: 'A second request for the same name returns the existing watch and keeps its settings',
    input: given('  example   printer x1  ', { targetPrice: cad(2000) }, [
      { watchId: 7, key: 'query:example printer x1', active: true },
    ]),
    expected: {
      ok: true,
      action: 'existing',
      watchId: 7,
      key: 'query:example printer x1',
      status: 'active',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:98 test_concurrent_duplicates_keep_one_watch_and_preserve_settings (same tracker, target stays 80, existing True)`,
      },
    ],
    notes:
      "Predecessor: the second request asked for target_price 20 → 2000; the first watch's 80 is kept. That the two arrived concurrently is the intake lock's concern (Phase 1), not this decision's.",
  },
  {
    id: 'paused-duplicate-reports-paused',
    what: 'Asking again for a paused watch returns it as paused',
    input: given('Example Printer X1', {}, [
      { watchId: 7, key: 'query:example printer x1', active: false },
    ]),
    expected: {
      ok: true,
      action: 'existing',
      watchId: 7,
      key: 'query:example printer x1',
      status: 'paused',
    },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:98 test_concurrent_duplicates_keep_one_watch_and_preserve_settings (repeated["status"] == "paused")`,
      },
    ],
  },
  {
    id: 'link-without-rules-defaults-to-five-percent-drop',
    what: 'A watch given no rule gets the 5% drop rule and is saved with no currency or reference',
    input: given('https://shop.example/products/printer'),
    expected: createLink('https://shop.example/products/printer'),
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:41 test_saves_immediately_before_a_slow_failed_lookup_and_keeps_retrying (status pending, drop_pct 5, baseline_price None)`,
      },
      {
        how: 'test-assertion',
        ref: `${I}:126 test_api_needs_only_a_product_name_and_rejects_invalid_rules (drop_pct 5)`,
      },
      SPEC_INTAKE,
    ],
    notes:
      'Predecessor drop_pct 5.0 → 500 bp; cooldown_hours 12 → 43200 s. The save returned within 0.5 s while the lookup was still blocked.',
  },
  {
    id: 'conditionless-link-gets-the-default-rule-not-a-refusal',
    what: 'A link with no rule is saved with the default rule instead of being refused',
    input: given('https://west3d.example/p/x1c'),
    expected: createLink('https://west3d.example/p/x1c'),
    from: [
      {
        how: 'test-assertion',
        ref: `${R}:188 test_a_watch_with_no_condition_is_refused_before_any_store_is_read`,
      },
      { how: 'test-assertion', ref: `${R}:199 test_rest_refuses_a_conditionless_watch_with_422` },
      SPEC_INTAKE,
    ],
    divergence:
      'The predecessor\'s fetch-first entry points (track_url, track_query, POST /api/trackers/url) refused a watch with no condition ("a watch needs target_price, drop_pct, or alert_on_restock=true"), while its save-first add_watch defaulted to a 5% drop. S§5.8 has one save-first intake and "The default rule is a 5% drop."',
  },
  {
    id: 'restock-only-gets-no-default-drop',
    what: 'A restock-only watch is not given a drop rule',
    input: given('https://shop.example/products/printer', { restock: true }),
    expected: createLink('https://shop.example/products/printer', {
      targetPrice: null,
      dropBasisPoints: null,
      restock: true,
      cooldownSeconds: 43200,
    }),
    from: [
      {
        how: 'function-reading',
        ref: `${S}:265-266 add_watch (drop_pct = 5.0 only when no target, no drop and no restock rule)`,
      },
    ],
  },
  {
    id: 'blank-input-is-refused',
    what: 'Whitespace alone is not a watch',
    input: given(' '),
    expected: { ok: false, refusal: 'not_one_link_or_name' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:126 test_api_needs_only_a_product_name_and_rejects_invalid_rules ({"input": " "} → 422)`,
      },
      {
        how: 'offline-run',
        ref: `${RUN}(" ") → ValueError "Enter one product link or name (up to 1,000 characters)."`,
      },
    ],
    specSilent: true,
  },
  {
    id: 'multi-line-input-is-refused',
    what: 'Two lines are not one link or name',
    input: given('a\nb'),
    expected: { ok: false, refusal: 'not_one_link_or_name' },
    from: [
      {
        how: 'offline-run',
        ref: `${RUN}("a\\nb") → ValueError "Enter one product link or name …"`,
      },
    ],
    specSilent: true,
  },
  {
    id: 'input-of-1000-characters-is-accepted',
    what: 'A 1,000-character name is at the limit and accepted',
    input: given('x'.repeat(1000)),
    expected: {
      ok: true,
      action: 'create',
      kind: 'query',
      normalised: 'x'.repeat(1000),
      key: `query:${'x'.repeat(1000)}`,
      rules: DEFAULT_SAVED,
      saved: SAVED,
    },
    from: [{ how: 'offline-run', ref: `${RUN}("x" × 1000) → ("x" × 1000, "query:" + "x" × 1000)` }],
    specSilent: true,
  },
  {
    id: 'input-of-1001-characters-is-refused',
    what: 'One character over the limit is refused',
    input: given('x'.repeat(1001)),
    expected: { ok: false, refusal: 'not_one_link_or_name' },
    from: [
      { how: 'offline-run', ref: `${RUN}("x" × 1001) → ValueError "… (up to 1,000 characters)."` },
    ],
    specSilent: true,
  },
  {
    id: 'non-http-link-is-refused',
    what: 'An ftp link is refused',
    input: given('ftp://shop.example/x'),
    expected: { ok: false, refusal: 'not_an_http_link' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:126 test_api_needs_only_a_product_name_and_rejects_invalid_rules ({"input": "ftp://shop.example/x"} → 422)`,
      },
      {
        how: 'offline-run',
        ref: `${RUN} → ValueError "Use an http or https product link without login details."`,
      },
    ],
  },
  {
    id: 'link-with-login-details-is-refused',
    what: 'A link carrying a user name and password is refused',
    input: given('https://user:pass@shop.example/x'),
    expected: { ok: false, refusal: 'not_an_http_link' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:170 _watch_input (parts.username or parts.password → refused)`,
      },
      {
        how: 'offline-run',
        ref: `${RUN} → ValueError "Use an http or https product link without login details."`,
      },
    ],
    notes:
      'S§4.1 also says a canonical URL carries no user-info. The credentials in the input are obviously fictional.',
  },
  {
    id: 'zero-drop-is-refused',
    what: 'A 0% drop rule is refused',
    input: given('X1', { dropBasisPoints: 0 }),
    expected: { ok: false, refusal: 'drop_out_of_range' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:126 test_api_needs_only_a_product_name_and_rejects_invalid_rules ({"input": "X1", "drop_pct": 0} → 422)`,
      },
    ],
    specSilent: true,
  },
  {
    id: 'hundred-percent-drop-is-refused',
    what: 'A 100% drop rule is refused',
    input: given('X1', { dropBasisPoints: 10000 }),
    expected: { ok: false, refusal: 'drop_out_of_range' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:259 add_watch (not 0 < drop_pct < 100 → "Price drop must be greater than 0 and less than 100%.")`,
      },
    ],
    specSilent: true,
  },
  {
    id: 'negative-target-is-refused',
    what: 'A target price below zero is refused',
    input: given('X1', { targetPrice: cad(-100) }),
    expected: { ok: false, refusal: 'target_not_positive' },
    from: [
      {
        how: 'test-assertion',
        ref: `${I}:126 test_api_needs_only_a_product_name_and_rejects_invalid_rules ({"input": "X1", "target_price": -1} → 422)`,
      },
    ],
    specSilent: true,
    notes: 'Predecessor target_price -1 → −100 minor units.',
  },
  {
    id: 'cooldown-under-an-hour-is-refused',
    what: 'A cooldown shorter than one hour is refused',
    input: given('X1', { cooldownSeconds: 0 }),
    expected: { ok: false, refusal: 'cooldown_too_short' },
    from: [
      {
        how: 'function-reading',
        ref: `${S}:261 add_watch (cooldown_hours < 1 → "Alert cooldown must be at least one hour.")`,
      },
    ],
    specSilent: true,
    notes:
      'The predecessor counted the cooldown in whole hours, so 0 h is its nearest refused value; S§5.8 fixes the 12 h default, not a minimum.',
  },
];
