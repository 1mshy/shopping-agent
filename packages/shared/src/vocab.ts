// Enumerated vocabularies of the data model, with the spec's exact values and order. One source of
// truth for the Zod domain schemas and the Drizzle migration. Only fields whose values the spec
// lists in full are here; a field the spec names without listing values is left out on purpose.
import { z } from 'zod';

// S§4.1 store

export const STORE_PLATFORMS = [
  'shopify',
  'woo',
  'magento',
  'wix',
  'bigcommerce',
  'other',
  'unknown',
] as const;
export const StorePlatform = z.enum(STORE_PLATFORMS);
export type StorePlatform = z.infer<typeof StorePlatform>;

export const SEARCH_ROUTES = [
  'shopify_ucp',
  'shopify_suggest',
  'woo_store_api',
  'magento_graphql',
  'search_action',
  'opensearch',
  'web_site_search',
  'adapter',
  'none',
] as const;
export const SearchRoute = z.enum(SEARCH_ROUTES);
export type SearchRoute = z.infer<typeof SearchRoute>;

export const IS_SHOP_VALUES = ['yes', 'no', 'unknown'] as const;
export const IsShop = z.enum(IS_SHOP_VALUES);
export type IsShop = z.infer<typeof IsShop>;

/** Also the four store-trust tiers of S§5.5. */
export const TRUST_TIERS = ['known', 'unverified', 'caution', 'blocked'] as const;
export const TrustTier = z.enum(TRUST_TIERS);
export type TrustTier = z.infer<typeof TrustTier>;

export const STORE_SOURCES = ['read', 'pasted', 'import', 'deal_feed', 'country_pack'] as const;
export const StoreSource = z.enum(STORE_SOURCES);
export type StoreSource = z.infer<typeof StoreSource>;

// S§4.1 host_access; S§5.1 fetch ladder

export const PAGE_KINDS = ['product', 'search', 'api'] as const;
export const PageKind = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKind>;

/** Fetch-ladder rungs in ladder order (S§5.1, S§8). Used by host_access and price_observation. */
export const RUNGS = ['api', 'http', 'browser', 'remote', 'person'] as const;
export const Rung = z.enum(RUNGS);
export type Rung = z.infer<typeof Rung>;

// S§4.1 listing

export const LISTING_CHANNELS = ['retail', 'marketplace'] as const;
export const ListingChannel = z.enum(LISTING_CHANNELS);
export type ListingChannel = z.infer<typeof ListingChannel>;

export const SELLER_KINDS = ['first_party', 'marketplace_seller', 'private'] as const;
export const SellerKind = z.enum(SELLER_KINDS);
export type SellerKind = z.infer<typeof SellerKind>;

export const CONDITIONS = [
  'new',
  'open_box',
  'refurbished',
  'used_like_new',
  'used_good',
  'used_fair',
  'for_parts',
  'unknown',
] as const;
export const Condition = z.enum(CONDITIONS);
export type Condition = z.infer<typeof Condition>;

// S§4.1 price_observation; S§2.10 unknown is a value

/** Stock is tri-state (S§2.10). */
export const AVAILABILITIES = ['in', 'out', 'unknown'] as const;
export const Availability = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof Availability>;

export const SHIPPING_STATUSES = ['known', 'estimated', 'conditional', 'unknown'] as const;
export const ShippingStatus = z.enum(SHIPPING_STATUSES);
export type ShippingStatus = z.infer<typeof ShippingStatus>;

// S§4.1 match_verdict

export const MATCH_RELATIONS = [
  'exact',
  'variant',
  'bundle',
  'accessory_or_part',
  'other_model',
  'other_line',
  'unknown',
] as const;
export const MatchRelation = z.enum(MATCH_RELATIONS);
export type MatchRelation = z.infer<typeof MatchRelation>;

export const DECIDED_BY_VALUES = ['identifier', 'rules', 'model', 'person'] as const;
export const DecidedBy = z.enum(DECIDED_BY_VALUES);
export type DecidedBy = z.infer<typeof DecidedBy>;

// S§4.2 watch, watch_listing, search_run

export const WATCH_KINDS = ['product', 'query', 'saved_search'] as const;
export const WatchKind = z.enum(WATCH_KINDS);
export type WatchKind = z.infer<typeof WatchKind>;

export const REFERENCE_KINDS = ['median_verified', 'user_confirmed'] as const;
export const ReferenceKind = z.enum(REFERENCE_KINDS);
export type ReferenceKind = z.infer<typeof ReferenceKind>;

export const WATCH_LISTING_ROLES = ['tracked', 'candidate', 'excluded'] as const;
export const WatchListingRole = z.enum(WATCH_LISTING_ROLES);
export type WatchListingRole = z.infer<typeof WatchListingRole>;

export const SEARCH_MODES = ['fast', 'deep'] as const;
export const SearchMode = z.enum(SEARCH_MODES);
export type SearchMode = z.infer<typeof SearchMode>;

// S§4.3 personalisation

export const PROFILE_FACT_SOURCES = ['user', 'interview', 'import', 'inferred'] as const;
export const ProfileFactSource = z.enum(PROFILE_FACT_SOURCES);
export type ProfileFactSource = z.infer<typeof ProfileFactSource>;

export const PROFILE_FACT_STATUSES = ['active', 'proposed', 'rejected', 'retired'] as const;
export const ProfileFactStatus = z.enum(PROFILE_FACT_STATUSES);
export type ProfileFactStatus = z.infer<typeof ProfileFactStatus>;

/** In-app behaviour events (S§4.3; `less_like_this` is the feedback signal of S§5.10, S§5.12). */
export const EVENT_KINDS = [
  'view',
  'click',
  'dismiss',
  'not_interested',
  'already_own',
  'wrong_match',
  'less_like_this',
  'search',
  'watch',
] as const;
export const EventKind = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKind>;

// S§4.4 operations

export const NOTIFICATION_KINDS = [
  'price_drop',
  'restock',
  'new_listing',
  'recommendation',
  'agent',
  'system',
] as const;
export const NotificationKind = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const LLM_ENDPOINT_ROLES = ['planner', 'judge', 'chat', 'browse'] as const;
export const LlmEndpointRole = z.enum(LLM_ENDPOINT_ROLES);
export type LlmEndpointRole = z.infer<typeof LlmEndpointRole>;

/** Where a run's cost came from (S§4.4, S§5.7). `none` means unknown cost, never zero. */
export const COST_SOURCES = ['provider', 'settings', 'none'] as const;
export const CostSource = z.enum(COST_SOURCES);
export type CostSource = z.infer<typeof CostSource>;
