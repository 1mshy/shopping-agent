import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as shared from '../src/index.ts';

// Each vocabulary is checked against the values written in docs/spec.md (S§n), in the spec's order.
// The lists here are copied from the spec text, not from the source, so a drift in either shows.
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
});
