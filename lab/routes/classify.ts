// Outcome classifier. The payload validator decides success; this decides what a failure was.
//
// Wall rule (S§5.1 "does not match bare substrings"): a wall needs one of
//   1. an explicit mitigation header (`cf-mitigated: challenge`, `x-vercel-mitigated`,
//      `x-amzn-waf-action`), or
//   2. a non-404 response whose parsed <title>, whitespace-collapsed and lowercased, equals a
//      known interstitial title, or whose final URL is on a known challenge path or host, or
//   3. a 403/429/503 HTML document under 64 KiB carrying a bot-manager vendor's header or cookie.
// Body text is never searched, so "Just a moment" in a loader or "captcha" on a 404 is not a wall.
// A JSON body is never a wall. A plain Cloudflare 403 (cf-ray only) is `forbidden`.
//
// The classifier reads only an `Observed` view of the response (status, final URL, a fixed set
// of headers, cookie names, size, title and body markers). That view is stored with every result,
// so a result can be re-classified offline without another request (`reclassify.ts`).
import type { Outcome, Platform, Validation, WallVendor } from './outcome.ts';

export interface HttpResponse {
  status: number;
  headers: Headers;
  finalUrl: string;
  body: string;
  bytes: number;
}
export interface Wall {
  vendor: WallVendor;
  mode: 'challenge' | 'block';
  signals: string[];
}

/** Everything the classifier reads, small enough to store with each result. */
export interface Observed {
  status: number;
  finalUrl: string;
  /** The headers the classifier reads (names lowercased); `set-cookie` keeps cookie names only. */
  headers: Record<string, string>;
  bytes: number;
  /** Parsed <title>, whitespace-collapsed and lowercased. */
  title?: string;
  /** Platform evidence found in the body (see BODY_MARKERS). */
  markers: string[];
}

const TITLES: Array<[RegExp, WallVendor, Wall['mode']]> = [
  [/^just a moment\.*$/, 'cloudflare', 'challenge'],
  [/^attention required! \| cloudflare$/, 'cloudflare', 'block'],
  [/^access denied$/, 'unknown', 'block'],
  [/^pardon our interruption\.*$/, 'imperva', 'challenge'],
  [/^ddos-guard$/, 'ddos-guard', 'challenge'],
  [
    /^(one moment, please|please wait|checking your browser|verifying your browser)\.*$/,
    'unknown',
    'challenge',
  ],
  [
    /^(please verify you are a human|human verification|are you a robot\??|robot or human\??|security check)$/,
    'unknown',
    'challenge',
  ],
];
const URLS: Array<[RegExp, WallVendor]> = [
  [/\/cdn-cgi\/challenge-platform\//, 'cloudflare'],
  [/^https?:\/\/[^/]*captcha-delivery\.com\//, 'datadome'],
  [/\/\.well-known\/sgcaptcha\//, 'siteground'],
  [/^https?:\/\/validate\.perfdrive\.com\//, 'radware'],
];
const SMALL = 64 * 1024;

/** Headers read by `vendorOf`, `detectWall` and `platformSignals` (plus prefixes below). */
const KEPT_HEADERS = [
  'content-type',
  'server',
  'cf-mitigated',
  'cf-ray',
  'x-vercel-mitigated',
  'x-amzn-waf-action',
  'x-datadome',
  'x-dd-b',
  'x-iinfo',
  'x-sucuri-id',
  'akamai-grn',
  'powered-by',
  'link',
  'x-wp-total',
  'x-shopid',
  'x-sorting-hat-shopid',
  'retry-after',
];
const KEPT_PREFIXES = ['x-kpsdk', 'x-shopify', 'x-magento'];
const MAX_HEADER = 1000;

export function pageTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, SMALL));
  if (!m?.[1]) return undefined;
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Platform evidence in the body: in HTML pages the platform's own asset paths and script types
// (a 404 page of the platform carries them too; added after the pilot, where Magento and
// WordPress 404 pages often had no telling header), and the WordPress REST error shape.
// Magento's error processor (pub/errors) serves its 404, report and maintenance pages with
// <base href=".../errors/<skin>/"> (`default` unless the shop has its own skin), often
// HTML-escaped (added after the spike C review).
const HTML_MARKERS: Array<[Exclude<Platform, 'any'>, RegExp]> = [
  ['shopify', /\/\/cdn\.shopify\.com\/|\bShopify\.shop\s*=/],
  ['woocommerce', /\/wp-content\/(?:themes|plugins|uploads)\/|\/wp-includes\//],
  [
    'magento',
    /type=["']text\/x-magento-init["']|\/static\/version\d+\/frontend\/|\/skin\/frontend\/|\bMage\.Cookies\b|<base\s+href=["'][^"']*errors(?:\/|&#x2F;)[a-z0-9_-]+(?:\/|&#x2F;)["']/i,
  ],
];

/** Body markers (`html:<platform>`, `body:wp_rest_error`) in a body, or in a stored prefix of it. */
export function bodyMarkers(contentType: string, body: string): string[] {
  const html = contentType.includes('html') ? body.slice(0, 512 * 1024) : '';
  const out: string[] = [];
  for (const [p, re] of HTML_MARKERS) if (re.test(html)) out.push(`html:${p}`);
  if (/^\s*\{\s*"code"\s*:\s*"rest_/.test(body.slice(0, 200))) out.push('body:wp_rest_error');
  return out;
}

/** The stored view of a response: what the classifier reads, and nothing else. */
export function observe(r: HttpResponse): Observed {
  const headers: Record<string, string> = {};
  for (const [k, v] of r.headers) {
    if (k === 'set-cookie') continue;
    if (KEPT_HEADERS.includes(k) || KEPT_PREFIXES.some((p) => k.startsWith(p))) {
      headers[k] = v.slice(0, MAX_HEADER);
    }
  }
  const cookies = r.headers.getSetCookie().map((c) => `${(c.split('=')[0] ?? '').trim()}=`);
  if (cookies.length > 0) headers['set-cookie'] = cookies.join(', ').slice(0, MAX_HEADER);
  const markers = bodyMarkers(headers['content-type'] ?? '', r.body);
  const title = pageTitle(r.body);
  return {
    status: r.status,
    finalUrl: r.finalUrl,
    headers,
    bytes: r.bytes,
    ...(title ? { title } : {}),
    markers,
  };
}

const header = (o: Observed, name: string) => o.headers[name];

/** Bot-manager vendor from headers and cookie names (attribution, not proof of a wall). */
function vendorOf(o: Observed): WallVendor | undefined {
  const cookie = header(o, 'set-cookie') ?? '';
  const server = (header(o, 'server') ?? '').toLowerCase();
  const keys = Object.keys(o.headers);
  if (header(o, 'x-datadome') !== undefined || header(o, 'x-dd-b') !== undefined) return 'datadome';
  if (/(^|[\s,])datadome=/i.test(cookie)) return 'datadome';
  if (header(o, 'x-iinfo') !== undefined || /incap_ses_|visid_incap_/i.test(cookie)) {
    return 'imperva';
  }
  if (/(^|[\s,])_px\w*=/i.test(cookie)) return 'perimeterx';
  if (keys.some((k) => k.startsWith('x-kpsdk'))) return 'kasada';
  if (header(o, 'x-amzn-waf-action') !== undefined) return 'aws_waf';
  if (header(o, 'x-sucuri-id') !== undefined || server.includes('sucuri')) return 'sucuri';
  if (server.includes('ddos-guard')) return 'ddos-guard';
  if (server.includes('akamaighost') || header(o, 'akamai-grn') !== undefined) return 'akamai';
  if (server === 'cloudflare' || header(o, 'cf-ray') !== undefined) return 'cloudflare';
  return undefined;
}

export function detectWallObserved(o: Observed): Wall | undefined {
  const vendor = vendorOf(o);
  if (header(o, 'cf-mitigated') === 'challenge') {
    return { vendor: 'cloudflare', mode: 'challenge', signals: ['header:cf-mitigated'] };
  }
  if (header(o, 'x-vercel-mitigated') === 'challenge') {
    return { vendor: 'vercel', mode: 'challenge', signals: ['header:x-vercel-mitigated'] };
  }
  const waf = header(o, 'x-amzn-waf-action');
  if (waf === 'captcha' || waf === 'challenge') {
    return { vendor: 'aws_waf', mode: 'challenge', signals: [`header:x-amzn-waf-action=${waf}`] };
  }
  if (o.status === 404 || o.status === 410) return undefined;
  if ((header(o, 'content-type') ?? '').includes('json')) return undefined;
  for (const [re, v] of URLS) {
    if (re.test(o.finalUrl)) return { vendor: v, mode: 'challenge', signals: [`final_url:${v}`] };
  }
  const title = o.title;
  for (const [re, v, mode] of TITLES) {
    if (title && re.test(title)) {
      return { vendor: v === 'unknown' ? (vendor ?? v) : v, mode, signals: [`title:${title}`] };
    }
  }
  if ([403, 429, 503].includes(o.status) && o.bytes < SMALL && vendor && vendor !== 'cloudflare') {
    return { vendor, mode: 'block', signals: [`status:${o.status}`, `vendor:${vendor}`] };
  }
  return undefined;
}

export const detectWall = (r: HttpResponse) => detectWallObserved(observe(r));

/** Which platforms the response shows. `woocommerce` here means WordPress is present. */
export function platformSignalsObserved(o: Observed): Array<Exclude<Platform, 'any'>> {
  const keys = Object.keys(o.headers);
  const out = new Set<Exclude<Platform, 'any'>>();
  if (
    keys.some(
      (k) => k.startsWith('x-shopify') || k === 'x-shopid' || k === 'x-sorting-hat-shopid',
    ) ||
    /shopify/i.test(header(o, 'powered-by') ?? '')
  ) {
    out.add('shopify');
  }
  if (
    (header(o, 'link') ?? '').includes('api.w.org') ||
    header(o, 'x-wp-total') !== undefined ||
    o.markers.includes('body:wp_rest_error')
  ) {
    out.add('woocommerce');
  }
  if (
    keys.some((k) => k.startsWith('x-magento')) ||
    /X-Magento-Vary|mage-cache-sessid/i.test(header(o, 'set-cookie') ?? '')
  ) {
    out.add('magento');
  }
  for (const [p] of HTML_MARKERS) if (o.markers.includes(`html:${p}`)) out.add(p);
  return [...out];
}

export const platformSignals = (r: HttpResponse) => platformSignalsObserved(observe(r));

const SIGNAL_NAME = { shopify: 'shopify', woocommerce: 'wordpress', magento: 'magento' } as const;

// A Magento customer login page as the final URL (a store or locale prefix allowed).
const LOGIN_PATH = /\/customer\/account\/login\/?$/;
// A GraphQL error of category `internal`, or Magento's "Internal server error" message.
const GRAPHQL_INTERNAL = /^graphql_error:(?:internal:|[^:]*:Internal server error)/;

/**
 * `host` lists the platforms seen on other answers from the same host (its robots.txt): a bare
 * 404 on a host that shows the platform elsewhere is `not_found`, not `not_platform`.
 */
export function classifyObserved(
  o: Observed,
  v: Validation,
  platform: Platform,
  host: Array<Exclude<Platform, 'any'>> = [],
): { outcome: Outcome; signals: string[] } {
  const seen = platformSignalsObserved(o);
  const signals = seen.map((p) => `platform:${SIGNAL_NAME[p]}`);
  const done = (outcome: Outcome, extra: string[] = []) => ({
    outcome,
    signals: [...signals, ...extra],
  });
  if (v.valid) return done({ kind: v.items > 0 ? 'ok' : 'empty' });
  const wall = detectWallObserved(o);
  if (wall) return done({ kind: 'wall', vendor: wall.vendor, mode: wall.mode }, wall.signals);
  if (o.status === 429) return done({ kind: 'rate_limited' });
  if (o.status === 401) return done({ kind: 'login_required' });
  if (o.status === 402) return done({ kind: 'payment_required' });
  if (o.status === 403) return done({ kind: 'forbidden' });
  const path = new URL(o.finalUrl).pathname;
  if (path === '/password') return done({ kind: 'login_required' }, ['final_url:/password']);
  if (LOGIN_PATH.test(path)) return done({ kind: 'login_required' }, ['final_url:login']);
  if (o.status === 404 || o.status === 410) {
    if (platform === 'any' || seen.includes(platform)) return done({ kind: 'not_found' });
    if (host.includes(platform)) {
      return done({ kind: 'not_found' }, [`host:platform:${SIGNAL_NAME[platform]}`]);
    }
    return done({ kind: 'not_platform' });
  }
  if (o.status >= 500) return done({ kind: 'server_error' });
  if (o.status >= 400) return done({ kind: 'client_error' });
  if (v.reason === 'absent') return done({ kind: 'not_found' });
  if (v.reason.startsWith('graphql_error:graphql-authorization')) {
    return done({ kind: 'login_required' });
  }
  if (GRAPHQL_INTERNAL.test(v.reason)) return done({ kind: 'server_error' }, ['graphql:internal']);
  return done({ kind: 'invalid_payload' });
}

export const classify = (
  r: HttpResponse,
  v: Validation,
  platform: Platform,
  host: Array<Exclude<Platform, 'any'>> = [],
) => classifyObserved(observe(r), v, platform, host);
