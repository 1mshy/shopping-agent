// Enumerated vocabularies of the data model, with the spec's exact values and order. One source of
// truth for the Zod domain schemas and the Drizzle migration. Only values the spec states are here
// (in S§4, or in the S§5 sentence cited); a field with no such basis is left out on purpose.
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

// Workstream 2b: fields S§4 names without listing values, enumerated from the S§5 prose cited.

/**
 * How a price was read: the S§5.2 reader ladder (platform JSON → JSON-LD → microdata → OpenGraph)
 * plus a hand-written adapter (S§5.2, S§5.9). The browser is a rung, not a method: a rendered page
 * is read with the same methods. Used by store.read_route, price_observation.read_path and the
 * method of each raw candidate.
 */
export const READ_METHODS = [
  'platform_json',
  'json_ld',
  'microdata',
  'opengraph',
  'adapter',
] as const;
export const ReadMethod = z.enum(READ_METHODS);
export type ReadMethod = z.infer<typeof ReadMethod>;

/** store.identifiers_offered: GTIN and MPN (identity tier 1, S§5.4), SKU (listing key, S§5.3). */
export const IDENTIFIER_KINDS = ['gtin', 'mpn', 'sku'] as const;
export const IdentifierKind = z.enum(IDENTIFIER_KINDS);
export type IdentifierKind = z.infer<typeof IdentifierKind>;

/** The kinds of a typed `FetchOutcome` (S§5.1). */
export const FETCH_OUTCOME_KINDS = [
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
] as const;
export const FetchOutcomeKind = z.enum(FETCH_OUTCOME_KINDS);
export type FetchOutcomeKind = z.infer<typeof FetchOutcomeKind>;

/** host_access.last_outcome: "Only ok, wall and empty may change the playbook" (S§5.1). */
export const PLAYBOOK_OUTCOME_KINDS = ['ok', 'wall', 'empty'] as const;
export const PlaybookOutcomeKind = z.enum(PLAYBOOK_OUTCOME_KINDS);
export type PlaybookOutcomeKind = z.infer<typeof PlaybookOutcomeKind>;

/** price_observation.missing_components: the amount fields a delivered total needs (S§5.5). */
export const PRICE_COMPONENTS = ['sticker', 'shipping', 'tax', 'duty_estimate'] as const;
export const PriceComponent = z.enum(PRICE_COMPONENTS);
export type PriceComponent = z.infer<typeof PriceComponent>;

/** watch_listing.added_by: the user (paste box, "Watch this") or code discovery (S§5.3, S§5.8). */
export const WATCH_LISTING_ADDED_BY = ['user', 'discovery'] as const;
export const WatchListingAddedBy = z.enum(WATCH_LISTING_ADDED_BY);
export type WatchListingAddedBy = z.infer<typeof WatchListingAddedBy>;

/** search_run.status. Saved first (S§2.9), then run; cancellation keeps partial results (S§6). */
export const SEARCH_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
] as const;
export const SearchRunStatus = z.enum(SEARCH_RUN_STATUSES);
export type SearchRunStatus = z.infer<typeof SearchRunStatus>;

/** run.status (harness runs). A run that hits a budget completes with its hits recorded (S§5.6). */
export const RUN_STATUSES = ['running', 'completed', 'cancelled', 'failed'] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

/** job_run.status; health reports skipped runs (S§5.8). */
export const JOB_RUN_STATUSES = ['running', 'completed', 'failed', 'skipped'] as const;
export const JobRunStatus = z.enum(JOB_RUN_STATUSES);
export type JobRunStatus = z.infer<typeof JobRunStatus>;

/** The four required run budgets: maxTurns, deadline, maxInputTokens, maxSpend (S§2.6, S§5.7). */
export const BUDGET_KINDS = ['turns', 'deadline', 'input_tokens', 'spend'] as const;
export const BudgetKind = z.enum(BUDGET_KINDS);
export type BudgetKind = z.infer<typeof BudgetKind>;

/** delivery.state. Only `accepted` may stamp a cooldown or "notified" (S§2.11). */
export const DELIVERY_STATES = ['pending', 'accepted', 'failed'] as const;
export const DeliveryState = z.enum(DELIVERY_STATES);
export type DeliveryState = z.infer<typeof DeliveryState>;

/** delivery.outcome of the last attempt: accepted, retry (transport, 408/425/429/5xx), failed (auth, payload) (S§5.11). */
export const DELIVERY_OUTCOMES = ['accepted', 'retry', 'failed'] as const;
export const DeliveryOutcome = z.enum(DELIVERY_OUTCOMES);
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;

/** channel.type: the channels in the core (S§5.11). Matrix, Signal and Apprise come with their adapters. */
export const CHANNEL_TYPES = [
  'in_app',
  'web_push',
  'ntfy',
  'telegram',
  'discord',
  'webhook',
] as const;
export const ChannelType = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof ChannelType>;

/** Where an effective setting came from: the DB, the environment, or the built-in default (S§5.13). */
export const SETTING_SOURCES = ['db', 'env', 'default'] as const;
export const SettingSource = z.enum(SETTING_SOURCES);
export type SettingSource = z.infer<typeof SettingSource>;

/** SearchIntent: "exact item or needs-based search" (S§5.4). */
export const INTENT_KINDS = ['exact', 'needs'] as const;
export const IntentKind = z.enum(INTENT_KINDS);
export type IntentKind = z.infer<typeof IntentKind>;

/** SearchIntent: "delivery or pickup" (S§5.4). */
export const FULFILMENTS = ['delivery', 'pickup'] as const;
export const Fulfilment = z.enum(FULFILMENTS);
export type Fulfilment = z.infer<typeof Fulfilment>;

// Open-ended by nature, so validated strings rather than lists.

/** host_access.wall_vendor: the bot manager the classifier names (S§5.1, S§5.16). New ones appear. */
export const WallVendor = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
export type WallVendor = z.infer<typeof WallVendor>;

/** fx_rate.source: the rate provider, shown in the "≈ in your currency (source, date)" hint (S§2.2). */
export const FxRateSource = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
export type FxRateSource = z.infer<typeof FxRateSource>;

/** price_observation.unit: the unit a unit price is per, as the page states it ("kg", "100 g"). */
export const PriceUnit = z.string().regex(/^\S(?:.{0,14}\S)?$/);
export type PriceUnit = z.infer<typeof PriceUnit>;
