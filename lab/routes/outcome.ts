// The lab's own typed outcome for one route on one host. Names follow S§5.1 `FetchOutcome`
// (ok | not_found | wall | rate_limited | payment_required | login_required | empty |
// server_error | network_error | refused_by_policy) so they can be aligned when the product
// type exists. Lab-only additions: forbidden, client_error, not_platform, off_site_redirect,
// invalid_payload and skipped.

export type ListKind = 'shopify' | 'woocommerce' | 'magento' | 'searchaction';
export type Platform = 'shopify' | 'woocommerce' | 'magento' | 'any';
export type RouteKind =
  | 'woo_store_search'
  | 'shopify_suggest'
  | 'shopify_product_js'
  | 'magento_graphql'
  | 'home_searchaction'
  | 'opensearch';

export type WallVendor =
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'imperva'
  | 'perimeterx'
  | 'kasada'
  | 'sucuri'
  | 'aws_waf'
  | 'vercel'
  | 'siteground'
  | 'ddos-guard'
  | 'radware'
  | 'unknown';

export type Outcome =
  | { kind: 'ok' } // valid payload of the expected shape with at least one item
  | { kind: 'empty' } // valid shape, zero items: the route answers
  | { kind: 'login_required' } // 401, a GraphQL authorization error, or a store password page
  | { kind: 'payment_required' } // 402 (e.g. a closed Shopify store)
  | { kind: 'forbidden' } // 403 without wall evidence
  | { kind: 'client_error' } // other 4xx: the route refused this request
  | { kind: 'wall'; vendor: WallVendor; mode: 'challenge' | 'block' }
  | { kind: 'rate_limited' }
  | { kind: 'not_found' } // 404/410 (or discovery target absent) on a host that shows the platform
  | { kind: 'not_platform' } // 404/410 and no sign of the expected platform anywhere
  | { kind: 'off_site_redirect'; to: string }
  | { kind: 'invalid_payload' } // 2xx with the wrong shape and no wall evidence
  | { kind: 'server_error' }
  | { kind: 'network_error'; code: string }
  | { kind: 'refused_by_policy'; reason: string }
  | { kind: 'skipped'; reason: string }; // not attempted (request cap, no product handle)

export type OutcomeKind = Outcome['kind'];

export type Validation =
  | { valid: true; items: number; note?: string }
  | { valid: false; reason: string };

/** What the outcome was decided on. */
export interface Evidence {
  status?: number;
  finalUrl?: string;
  contentType?: string;
  bytes?: number;
  /** Validator verdict: the reason it failed, or a short note on what passed. */
  validation?: string;
  /** The page <title> of an HTML answer that failed validation. */
  title?: string;
  /** First 300 characters of a small (< 16 KiB) answer that failed validation, for review. */
  snippet?: string;
  /** Classifier and platform signals that fired (e.g. `title:just a moment`, `platform:shopify`). */
  signals: string[];
  hops: number;
  ms?: number;
}

/** What `respect` would have done with this URL (S§5.1 robots setting). */
export type RobotsVerdict = 'allowed' | 'disallowed' | 'unknown';

export interface RouteResult {
  route: RouteKind;
  url: string;
  outcome: Outcome;
  evidence: Evidence;
  robots: RobotsVerdict;
  /** HTTP requests this route used, including redirect hops, a retry and handle discovery. */
  requests: number;
  handleSource?: 'suggest' | 'home';
}

export interface DomainResult {
  v: 1;
  list: ListKind;
  domain: string;
  userAgent: string;
  startedAt: string;
  ms: number;
  origin: string;
  requests: number;
  robots: {
    state: 'parsed' | 'absent' | 'unreachable' | 'unknown';
    status?: number;
    outcome: OutcomeKind;
  };
  routes: RouteResult[];
}
