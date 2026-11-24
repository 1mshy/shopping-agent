import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as shared from '../src/index.ts';

// Each vocabulary is pinned to the values and order written here, which match docs/spec.md at the
// section cited. The test catches a change to the source that is not also made here; it cannot show
// that the spec is right, and where the spec text was written together with a list (workstream 2b),
// the two are not independent. Keeping the spec in step is a review duty (CONTRIBUTING rule 4).
const SPEC: [list: string, schema: string, where: string, values: string[]][] = [
  [
    'STORE_PLATFORMS',
    'StorePlatform',
    'S§4.1 store.platform',
    ['shopify', 'woo', 'magento', 'wix', 'bigcommerce', 'other', 'unknown'],
  ],
  [
    'SEARCH_ROUTES',
    'SearchRoute',
    'S§4.1 store.search_route',
    [
      'shopify_ucp',
      'shopify_suggest',
      'woo_store_api',
      'magento_graphql',
      'search_action',
      'opensearch',
      'web_site_search',
      'adapter',
      'none',
    ],
  ],
  ['IS_SHOP_VALUES', 'IsShop', 'S§4.1 store.is_shop', ['yes', 'no', 'unknown']],
  [
    'TRUST_TIERS',
    'TrustTier',
    'S§4.1 store.trust_tier, S§5.5',
    ['known', 'unverified', 'caution', 'blocked'],
  ],
  [
    'STORE_SOURCES',
    'StoreSource',
    'S§4.1 store.source',
    ['read', 'pasted', 'import', 'deal_feed', 'country_pack'],
  ],
  ['PAGE_KINDS', 'PageKind', 'S§4.1 host_access.page_kind', ['product', 'search', 'api']],
  ['RUNGS', 'Rung', 'S§5.1, S§8', ['api', 'http', 'browser', 'remote', 'person']],
  ['LISTING_CHANNELS', 'ListingChannel', 'S§4.1 listing.channel', ['retail', 'marketplace']],
  [
    'SELLER_KINDS',
    'SellerKind',
    'S§4.1 listing.seller_kind',
    ['first_party', 'marketplace_seller', 'private'],
  ],
  [
    'CONDITIONS',
    'Condition',
    'S§4.1 listing.condition',
    [
      'new',
      'open_box',
      'refurbished',
      'used_like_new',
      'used_good',
      'used_fair',
      'for_parts',
      'unknown',
    ],
  ],
  [
    'AVAILABILITIES',
    'Availability',
    'S§4.1 price_observation.availability, S§2.10',
    ['in', 'out', 'unknown'],
  ],
  [
    'SHIPPING_STATUSES',
    'ShippingStatus',
    'S§2.10, S§4.1 price_observation.shipping_status',
    ['known', 'estimated', 'conditional', 'unknown'],
  ],
  [
    'MATCH_RELATIONS',
    'MatchRelation',
    'S§4.1 match_verdict.relation',
    ['exact', 'variant', 'bundle', 'accessory_or_part', 'other_model', 'other_line', 'unknown'],
  ],
  [
    'DECIDED_BY_VALUES',
    'DecidedBy',
    'S§4.1 match_verdict.decided_by',
    ['identifier', 'rules', 'model', 'person'],
  ],
  ['WATCH_KINDS', 'WatchKind', 'S§4.2 watch.kind', ['product', 'query', 'saved_search']],
  [
    'REFERENCE_KINDS',
    'ReferenceKind',
    'S§4.2 watch.reference_kind',
    ['median_verified', 'user_confirmed'],
  ],
  [
    'WATCH_LISTING_ROLES',
    'WatchListingRole',
    'S§4.2 watch_listing.role',
    ['tracked', 'candidate', 'excluded'],
  ],
  ['SEARCH_MODES', 'SearchMode', 'S§4.2 search_run.mode', ['fast', 'deep']],
  [
    'PROFILE_FACT_SOURCES',
    'ProfileFactSource',
    'S§4.3 profile_fact.source',
    ['user', 'interview', 'import', 'inferred'],
  ],
  [
    'PROFILE_FACT_STATUSES',
    'ProfileFactStatus',
    'S§4.3 profile_fact.status',
    ['active', 'proposed', 'rejected', 'retired'],
  ],
  [
    'EVENT_KINDS',
    'EventKind',
    'S§4.3 event',
    [
      'view',
      'click',
      'dismiss',
      'not_interested',
      'already_own',
      'wrong_match',
      'less_like_this',
      'search',
      'watch',
    ],
  ],
  [
    'NOTIFICATION_KINDS',
    'NotificationKind',
    'S§4.4 notification_event.kind',
    ['price_drop', 'restock', 'new_listing', 'recommendation', 'agent', 'system'],
  ],
  [
    'LLM_ENDPOINT_ROLES',
    'LlmEndpointRole',
    'S§4.4 llm_endpoint.role, S§5.7',
    ['planner', 'judge', 'chat', 'browse'],
  ],
  ['COST_SOURCES', 'CostSource', 'S§4.4 run.cost_source', ['provider', 'settings', 'none']],
  // Workstream 2b: vocabularies the S§4 tables name and S§5 prose enumerates.
  [
    'READ_METHODS',
    'ReadMethod',
    'S§5.2 reader ladder, S§4.1 store.read_route, price_observation.read_path',
    ['platform_json', 'json_ld', 'microdata', 'opengraph', 'adapter'],
  ],
  ['IDENTIFIER_KINDS', 'IdentifierKind', 'S§5.4 tier 1, S§5.3', ['gtin', 'mpn', 'sku']],
  [
    'FETCH_OUTCOME_KINDS',
    'FetchOutcomeKind',
    'S§5.1 typed outcome',
    [
      'ok',
      'not_found',
      'wall',
      'rate_limited',
      'payment_required',
      'login_required',
      'empty',
      'server_error',
      'network_error',
      'refused_by_policy',
    ],
  ],
  ['PLAYBOOK_OUTCOME_KINDS', 'PlaybookOutcomeKind', 'S§5.1', ['ok', 'wall', 'empty']],
  [
    'PRICE_COMPONENTS',
    'PriceComponent',
    'S§5.5, S§4.1',
    ['sticker', 'shipping', 'tax', 'duty_estimate'],
  ],
  ['WATCH_LISTING_ADDED_BY', 'WatchListingAddedBy', 'S§4.2', ['user', 'discovery']],
  [
    'SEARCH_RUN_STATUSES',
    'SearchRunStatus',
    'S§4.2 search_run.status',
    ['queued', 'running', 'completed', 'cancelled', 'failed'],
  ],
  ['RUN_STATUSES', 'RunStatus', 'S§4.4 run', ['running', 'completed', 'cancelled', 'failed']],
  [
    'RUN_TYPES',
    'RunType',
    'S§5.7 run types, S§4.4 run.type',
    ['fast_search', 'chat', 'store_run', 'deep_job', 'recommendation_job'],
  ],
  [
    'JOB_RUN_STATUSES',
    'JobRunStatus',
    'S§4.4 job_run',
    ['running', 'completed', 'failed', 'skipped', 'timed_out'],
  ],
  ['BUDGET_KINDS', 'BudgetKind', 'S§5.7', ['turns', 'deadline', 'input_tokens', 'spend']],
  ['DELIVERY_STATES', 'DeliveryState', 'S§4.4 delivery', ['pending', 'accepted', 'failed']],
  ['DELIVERY_OUTCOMES', 'DeliveryOutcome', 'S§5.11', ['accepted', 'retry', 'failed']],
  [
    'CHANNEL_TYPES',
    'ChannelType',
    'S§5.11 channels in the core',
    ['in_app', 'web_push', 'ntfy', 'telegram', 'discord', 'webhook'],
  ],
  ['SETTING_SOURCES', 'SettingSource', 'S§4.4 setting, S§5.13', ['db', 'env', 'default']],
  ['INTENT_KINDS', 'IntentKind', 'S§5.4 SearchIntent', ['exact', 'needs']],
  ['FULFILMENTS', 'Fulfilment', 'S§5.4 SearchIntent', ['delivery', 'pickup']],
  // Workstream 2b part B: transport and stream contracts.
  ['WALL_MODES', 'WallMode', 'S§5.1 browser rung', ['challenge', 'captcha', 'access_denied']],
  [
    'POLICY_REFUSAL_REASONS',
    'PolicyRefusalReason',
    'S§5.1 guard',
    ['scheme', 'url_form', 'private_address', 'body_size', 'robots', 'host_limit', 'budget'],
  ],
  [
    'MARKETPLACE_OUTCOME_KINDS',
    'MarketplaceOutcomeKind',
    'S§5.9',
    ['ok', 'blocked', 'rate_limited', 'needs_person', 'not_configured', 'parse_error'],
  ],
  ['ADAPTER_REQUIREMENTS', 'AdapterRequirement', 'S§5.9', ['browser', 'user_key', 'session']],
  [
    'COVERAGE_SOURCE_KINDS',
    'CoverageSourceKind',
    'S§5.6 step 2',
    ['catalog', 'web_search', 'store', 'marketplace'],
  ],
  [
    'STREAM_BLOCK_TYPES',
    'StreamBlockType',
    'S§5.6 progress stream',
    ['plan', 'store_read', 'candidate', 'verdict', 'summary', 'coverage'],
  ],
  ['STORE_READ_STATES', 'StoreReadState', 'S§5.6', ['reading', 'priced', 'no_price', 'walled']],
  [
    'DEAL_VERDICTS',
    'DealVerdictLabel',
    'S§5.5',
    ['lowest_seen', 'good_price', 'typical', 'high', 'cheapest_of_n'],
  ],
  ['RESULT_GROUPS', 'ResultGroup', 'S§5.4, S§5.12', ['exact', 'substitute', 'used']],
];

const exports = shared as unknown as Record<string, unknown>;

describe('shared vocabularies', () => {
  it.each(SPEC)('%s matches the spec (%s, %s)', (list, schemaName, _where, values) => {
    expect(exports[list]).toEqual(values);
    const schema = exports[schemaName] as z.ZodType;
    for (const value of values) expect(schema.parse(value)).toBe(value);
    for (const bad of ['', 'UNKNOWN', `${values[0]} `, null]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it('keeps the playbook outcomes a subset of the fetch outcomes (S§5.1)', () => {
    for (const kind of shared.PLAYBOOK_OUTCOME_KINDS) {
      expect(shared.FETCH_OUTCOME_KINDS).toContain(kind);
    }
  });
});

describe('free-form but validated strings', () => {
  const cases: [name: string, schema: z.ZodType, good: string[], bad: unknown[]][] = [
    [
      'WallVendor',
      shared.WallVendor,
      ['cloudflare', 'akamai', 'perimeterx-hmn'],
      ['', 'Cloud Flare', 'x'.repeat(49), null],
    ],
    ['FxRateSource', shared.FxRateSource, ['ecb', 'frankfurter.app'], ['', 'ECB rates', null]],
    [
      'PriceUnit',
      shared.PriceUnit,
      ['kg', '100 g', 'l', 'each'],
      ['', ' kg', 'kg ', 'x'.repeat(17), 1],
    ],
  ];
  it.each(cases)('%s', (_name, schema, good, bad) => {
    for (const value of good) expect(schema.safeParse(value).success).toBe(true);
    for (const value of bad) expect(schema.safeParse(value).success).toBe(false);
  });
});
