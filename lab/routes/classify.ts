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

/** Bot-manager vendor from headers and cookie names (attribution, not proof of a wall). */
function vendorOf(h: Headers): WallVendor | undefined {
  const cookie = h.get('set-cookie') ?? '';
  const server = (h.get('server') ?? '').toLowerCase();
  if (h.has('x-datadome') || h.has('x-dd-b') || /(^|[\s,])datadome=/i.test(cookie))
    return 'datadome';
  if (h.has('x-iinfo') || /incap_ses_|visid_incap_/i.test(cookie)) return 'imperva';
  if (/(^|[\s,])_px\w*=/i.test(cookie)) return 'perimeterx';
  if ([...h.keys()].some((k) => k.startsWith('x-kpsdk'))) return 'kasada';
  if (h.has('x-amzn-waf-action')) return 'aws_waf';
  if (h.has('x-sucuri-id') || server.includes('sucuri')) return 'sucuri';
  if (server.includes('ddos-guard')) return 'ddos-guard';
  if (server.includes('akamaighost') || h.has('akamai-grn')) return 'akamai';
  if (server === 'cloudflare' || h.has('cf-ray')) return 'cloudflare';
  return undefined;
}

export function detectWall(r: HttpResponse): Wall | undefined {
  const h = r.headers;
  const vendor = vendorOf(h);
  if (h.get('cf-mitigated') === 'challenge') {
    return { vendor: 'cloudflare', mode: 'challenge', signals: ['header:cf-mitigated'] };
  }
  if (h.get('x-vercel-mitigated') === 'challenge') {
    return { vendor: 'vercel', mode: 'challenge', signals: ['header:x-vercel-mitigated'] };
  }
  const waf = h.get('x-amzn-waf-action');
  if (waf === 'captcha' || waf === 'challenge') {
    return { vendor: 'aws_waf', mode: 'challenge', signals: [`header:x-amzn-waf-action=${waf}`] };
  }
  if (r.status === 404 || r.status === 410) return undefined;
  if ((h.get('content-type') ?? '').includes('json')) return undefined;
  for (const [re, v] of URLS) {
    if (re.test(r.finalUrl)) return { vendor: v, mode: 'challenge', signals: [`final_url:${v}`] };
  }
  const title = pageTitle(r.body);
  for (const [re, v, mode] of TITLES) {
    if (title && re.test(title)) {
      return { vendor: v === 'unknown' ? (vendor ?? v) : v, mode, signals: [`title:${title}`] };
    }
  }
  if ([403, 429, 503].includes(r.status) && r.bytes < SMALL && vendor && vendor !== 'cloudflare') {
    return { vendor, mode: 'block', signals: [`status:${r.status}`, `vendor:${vendor}`] };
  }
  return undefined;
}

// Platform evidence (not wall evidence): headers, error-body shapes, and in HTML pages the
// platform's own asset paths and script types, which a 404 page of the platform carries too.
// Added after the pilot, where Magento and WordPress 404 pages often had no telling header.
const HTML_MARKERS: Array<[Exclude<Platform, 'any'>, RegExp]> = [
  ['shopify', /\/\/cdn\.shopify\.com\/|\bShopify\.shop\s*=/],
  ['woocommerce', /\/wp-content\/(?:themes|plugins|uploads)\/|\/wp-includes\//],
  [
    'magento',
    /type=["']text\/x-magento-init["']|\/static\/version\d+\/frontend\/|\/skin\/frontend\/|\bMage\.Cookies\b/,
  ],
];

/** Which platforms the response shows. `woocommerce` here means WordPress is present. */
export function platformSignals(r: HttpResponse): Array<Exclude<Platform, 'any'>> {
  const h = r.headers;
  const keys = [...h.keys()];
  const html = (h.get('content-type') ?? '').includes('html') ? r.body.slice(0, 512 * 1024) : '';
  const out = new Set<Exclude<Platform, 'any'>>();
  if (
    keys.some(
      (k) => k.startsWith('x-shopify') || k === 'x-shopid' || k === 'x-sorting-hat-shopid',
    ) ||
    /shopify/i.test(h.get('powered-by') ?? '')
  ) {
    out.add('shopify');
  }
  if (
    (h.get('link') ?? '').includes('api.w.org') ||
    h.has('x-wp-total') ||
    /^\s*\{\s*"code"\s*:\s*"rest_/.test(r.body.slice(0, 200))
  ) {
    out.add('woocommerce');
  }
  if (
    keys.some((k) => k.startsWith('x-magento')) ||
    /X-Magento-Vary|mage-cache-sessid/i.test(h.get('set-cookie') ?? '')
  ) {
    out.add('magento');
  }
  for (const [p, re] of HTML_MARKERS) if (re.test(html)) out.add(p);
  return [...out];
}

const SIGNAL_NAME = { shopify: 'shopify', woocommerce: 'wordpress', magento: 'magento' } as const;

export function classify(
  r: HttpResponse,
  v: Validation,
  platform: Platform,
): { outcome: Outcome; signals: string[] } {
  const seen = platformSignals(r);
  const signals = seen.map((p) => `platform:${SIGNAL_NAME[p]}`);
  const done = (outcome: Outcome, extra: string[] = []) => ({
    outcome,
    signals: [...signals, ...extra],
  });
  if (v.valid) return done({ kind: v.items > 0 ? 'ok' : 'empty' });
  const wall = detectWall(r);
  if (wall) return done({ kind: 'wall', vendor: wall.vendor, mode: wall.mode }, wall.signals);
  if (r.status === 429) return done({ kind: 'rate_limited' });
  if (r.status === 401) return done({ kind: 'login_required' });
  if (r.status === 402) return done({ kind: 'payment_required' });
  if (r.status === 403) return done({ kind: 'forbidden' });
  if (new URL(r.finalUrl).pathname === '/password') {
    return done({ kind: 'login_required' }, ['final_url:/password']);
  }
  if (r.status === 404 || r.status === 410) {
    const shows = platform === 'any' || seen.includes(platform);
    return done({ kind: shows ? 'not_found' : 'not_platform' });
  }
  if (r.status >= 500) return done({ kind: 'server_error' });
  if (r.status >= 400) return done({ kind: 'client_error' });
  if (v.reason === 'absent') return done({ kind: 'not_found' });
  if (v.reason.startsWith('graphql_error:graphql-authorization')) {
    return done({ kind: 'login_required' });
  }
  return done({ kind: 'invalid_payload' });
}
