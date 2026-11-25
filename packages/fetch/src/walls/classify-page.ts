// The wall classifier (S§5.1 "Wall classifier"): from a page's status, final URL, headers, title,
// visible text, markup signals and size, is it a wall (which vendor, which mode), an `empty`
// page, or neither. It does not match bare substrings: every rule below names where its marker
// must appear and, apart from explicit headers and a vendor's own redirect path, that the page is
// shaped like a block page (little visible text in a small document).
//
// Mode (the corpus contract's rule): `captcha` when the page sets a puzzle for a person (an image
// or text captcha, a captcha iframe, press-and-hold), whatever its wording; else `access_denied`
// when the page states that access is denied; else `challenge`. Vendor: named only by evidence
// (a header, a vendor's redirect, markup or title); a site's own wall names the site (`amazon`,
// `ebay`); a bare 403 names none unless a bot manager's own header is on it.
//
// What the status decides: a 404 or 410 is the store answering, whatever its body says. Wall
// evidence wins over every other status (a 503 or 429 challenge, a 401 with a captcha). A 403
// with no evidence is a wall whose vendor is unknown. Anything else is left to the status.
import { parseRetryAfter } from '../page/retry-after.ts';
import type { PageEvidence, PageOutcome, PageVerdict, Wall } from './evidence.ts';
import { MAX_SIGNALS, SIGNAL_MAX_CHARS, VISIBLE_TEXT_EXCERPT_CHARS } from './html.ts';
import { hostOf, siteLabel } from './site.ts';

type Mode = Wall['mode'];

/**
 * A block page shows little text. Cloudflare, DataDome, Akamai, PerimeterX and Amazon's walls
 * met in the Phase 0 labs show under 700 characters; a store's product page shows thousands.
 */
export const BLOCK_PAGE_MAX_VISIBLE_CHARS = 2_000;
/** A block page is a small document: the largest wall the labs saved was 25 KB. */
export const BLOCK_PAGE_MAX_BYTES = 256 * 1024;
/** Challenge copy (a phrase of visible text) counts only on a page this short. */
export const CHALLENGE_COPY_MAX_VISIBLE_CHARS = 1_000;
/**
 * `empty` (S§5.1): a 2xx page that came back with nothing to read, which is fewer than this many
 * characters of visible text in a document under `EMPTY_MAX_DOCUMENT_BYTES`. The numbers are the
 * Phase 0 browser lab's (`error:empty`); a page with less text but a larger document is a shell
 * the readers may still read (JSON-LD, inline data), so it is not called empty.
 */
export const EMPTY_MAX_VISIBLE_CHARS = 60;
export const EMPTY_MAX_DOCUMENT_BYTES = 5_000;

interface Finding {
  readonly vendor: string | null;
  readonly mode: Mode;
  /** A vendor taken from a generic page rather than the vendor's own marker. */
  readonly guessed?: true;
}

function finding(vendor: string | null, mode: Mode, guessed = false): Finding {
  return guessed ? { vendor, mode, guessed: true } : { vendor, mode };
}

/** Lower-cased, whitespace collapsed (NBSP included), typographic apostrophes made plain. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** No title a rule knows is longer; a longer one is compared as no title at all. */
const TITLE_COMPARED_MAX_CHARS = 512;

/** A title as compared: `norm`, then any trailing dots or ellipsis dropped. */
function normTitle(title: string): string {
  if (title.length > TITLE_COMPARED_MAX_CHARS) return '';
  const t = norm(title);
  let end = t.length;
  while (end > 0 && (t[end - 1] === '.' || t[end - 1] === '…' || t[end - 1] === ' ')) end--;
  return t.slice(0, end);
}

function isBlockShaped(page: PageEvidence): boolean {
  return (
    page.visibleChars <= BLOCK_PAGE_MAX_VISIBLE_CHARS && page.documentBytes <= BLOCK_PAGE_MAX_BYTES
  );
}

// --- headers -----------------------------------------------------------------------------------

/** A bot manager's explicit verdict in a response header: a wall at any size and status. */
function headerFindings(headers: PageEvidence['headers'], status: number): Finding[] {
  const out: Finding[] = [];
  const value = (name: string) => (headers[name] ?? '').trim().toLowerCase();
  if (value('cf-mitigated') === 'challenge') out.push(finding('cloudflare', 'challenge'));
  const vercel = value('x-vercel-mitigated');
  if (vercel === 'challenge') out.push(finding('vercel', 'challenge'));
  if (vercel === 'deny') out.push(finding('vercel', 'access_denied'));
  const waf = value('x-amzn-waf-action');
  if (waf === 'captcha') out.push(finding('aws_waf', 'captcha'));
  if (waf === 'challenge') out.push(finding('aws_waf', 'challenge'));
  // Kasada answers its challenge with a 429 and its own headers.
  if (status === 429 && Object.keys(headers).some((name) => name.startsWith('x-kpsdk-'))) {
    out.push(finding('kasada', 'challenge'));
  }
  return out;
}

/**
 * The bot manager a response's headers show is deployed (attribution, not a wall by itself).
 * Cloudflare's `cf-ray` and `server: cloudflare` are on every page it proxies, walled or not,
 * and in front of other bot managers (DataDome behind Cloudflare at rona.ca), so they name none.
 */
function headerVendor(headers: PageEvidence['headers']): string | null {
  const has = (name: string) => headers[name] !== undefined;
  const server = (headers.server ?? '').trim().toLowerCase();
  const names = Object.keys(headers);
  if (has('x-datadome') || has('x-dd-b') || has('x-datadome-cid')) return 'datadome';
  if (has('x-iinfo') || /incapsula/i.test(headers['x-cdn'] ?? '')) return 'imperva';
  if (names.some((name) => name.startsWith('x-kpsdk-'))) return 'kasada';
  if (has('x-amzn-waf-action')) return 'aws_waf';
  if (has('x-sucuri-id') || server.startsWith('sucuri')) return 'sucuri';
  if (server === 'ddos-guard') return 'ddos-guard';
  if (server === 'akamaighost' || has('akamai-grn')) return 'akamai';
  return null;
}

// --- final URL ---------------------------------------------------------------------------------

function parseUrl(url: string, base?: string): URL | null {
  try {
    return base === undefined ? new URL(url) : new URL(url, base);
  } catch {
    return null;
  }
}

/** A vendor's redirect target: the final URL's host and path, never a word anywhere in it. */
function urlFindings(page: PageEvidence, blockShaped: boolean): Finding[] {
  const url = parseUrl(page.finalUrl);
  if (url === null) return [];
  const host = hostOf(page.finalUrl) ?? '';
  const site = siteLabel(host);
  const path = url.pathname.toLowerCase();
  const out: Finding[] = [];
  // eBay's own challenge: a clean 200 whose only sign is where it ended (S§5.1).
  if (site === 'ebay') {
    if (path.startsWith('/splashui/challenge')) out.push(finding('ebay', 'challenge'));
    if (path.startsWith('/splashui/captcha')) out.push(finding('ebay', 'captcha'));
  }
  if (site === 'amazon' && /^\/errors(?:_page)?\/validatecaptcha\/?$/.test(path)) {
    out.push(finding('amazon', 'challenge'));
  }
  if (host === 'captcha-delivery.com' || host.endsWith('.captcha-delivery.com')) {
    out.push(finding('datadome', path.startsWith('/interstitial') ? 'challenge' : 'captcha'));
  }
  if (host === 'validate.perfdrive.com') out.push(finding('radware', 'challenge'));
  if (path.startsWith('/cdn-cgi/challenge-platform/')) out.push(finding('cloudflare', 'challenge'));
  if (path.startsWith('/.well-known/sgcaptcha')) out.push(finding('siteground', 'challenge'));
  // A redirect to a page whose whole path is /blocked; PerimeterX's carries the asked URL in `url`.
  if (blockShaped && path.replace(/\/+$/, '') === '/blocked') {
    out.push(finding(url.searchParams.has('url') ? 'perimeterx' : null, 'challenge'));
  }
  return out;
}

// --- markup ------------------------------------------------------------------------------------

const CLOUDFLARE_IDS = new Set([
  'challenge-running',
  'challenge-stage',
  'challenge-form',
  'challenge-body-text',
  'challenge-error-text',
  'cf-challenge-running',
]);

/** DataDome's inline configuration: `var dd={'rt':'c',...}` (c: captcha, i: interstitial). */
const DATADOME_CONFIG = /\bdd\s*=\s*\{[^}]{0,400}?['"]rt['"]\s*:\s*['"]([a-z])['"]/;

/** Hosts of captcha widgets: a puzzle for a person on a page already judged a wall. */
function isCaptchaWidget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  return (
    ((under('google.com') || under('recaptcha.net')) && path.startsWith('/recaptcha/')) ||
    under('hcaptcha.com') ||
    under('arkoselabs.com') ||
    under('funcaptcha.com') ||
    under('geetest.com')
  );
}

interface MarkupResult {
  readonly findings: Finding[];
  /** A captcha widget is on the page. */
  readonly puzzle: boolean;
}

function markupFindings(page: PageEvidence): MarkupResult {
  const findings: Finding[] = [];
  let puzzle = false;
  const site = siteLabel(hostOf(page.finalUrl) ?? '');
  // Bounded on hostile evidence: as many signals and characters as a reader keeps, no more.
  for (const signal of page.markup.slice(0, MAX_SIGNALS)) {
    const value = signal.value.slice(0, SIGNAL_MAX_CHARS).toLowerCase();
    switch (signal.in) {
      case 'iframe_src':
      case 'script_src': {
        const url = parseUrl(value, page.finalUrl);
        if (url === null) break;
        const host = url.hostname.toLowerCase();
        const path = url.pathname.toLowerCase();
        if (host === 'captcha-delivery.com' || host.endsWith('.captcha-delivery.com')) {
          // tags.js is DataDome deployed on a page, not a wall; the rest is its block page.
          if (signal.in === 'iframe_src' && path.startsWith('/captcha')) {
            findings.push(finding('datadome', 'captcha'));
          } else if (signal.in === 'iframe_src' && path.startsWith('/interstitial')) {
            findings.push(finding('datadome', 'challenge'));
          } else if (path === '/c.js') findings.push(finding('datadome', 'captcha'));
          else if (path === '/i.js') findings.push(finding('datadome', 'challenge'));
        } else if (path.startsWith('/_incapsula_resource')) {
          findings.push(finding('imperva', 'challenge'));
        } else if (
          path.startsWith('/cdn-cgi/challenge-platform/h/') ||
          path.startsWith('/cdn-cgi/challenge-platform/orchestrate/')
        ) {
          findings.push(finding('cloudflare', 'challenge'));
        } else if (path.startsWith('/_sec/cp_challenge/')) {
          findings.push(finding('akamai', 'challenge'));
        } else if (host.endsWith('.awswaf.com') && path.endsWith('/captcha.js')) {
          findings.push(finding('aws_waf', 'captcha'));
        } else if (host.endsWith('.awswaf.com') && path.endsWith('/challenge.js')) {
          findings.push(finding('aws_waf', 'challenge'));
        } else if (isCaptchaWidget(url)) {
          puzzle = true;
        }
        break;
      }
      case 'form_action': {
        const url = parseUrl(value, page.finalUrl);
        if (url !== null && /^\/errors(?:_page)?\/validatecaptcha\/?$/.test(url.pathname)) {
          findings.push(finding(site === 'amazon' ? 'amazon' : null, 'challenge'));
        }
        break;
      }
      case 'element_id':
        if (value === 'px-captcha') findings.push(finding('perimeterx', 'captcha'));
        else if (CLOUDFLARE_IDS.has(value)) findings.push(finding('cloudflare', 'challenge'));
        else if (value === 'sec-if-cpt-container') findings.push(finding('akamai', 'challenge'));
        break;
      case 'inline_script': {
        const dd = DATADOME_CONFIG.exec(value);
        if (dd) findings.push(finding('datadome', dd[1] === 'c' ? 'captcha' : 'challenge'));
        else if (/\b_cf_chl_opt\b/.test(value)) findings.push(finding('cloudflare', 'challenge'));
        else if (/\bbm-verify\b/.test(value)) findings.push(finding('akamai', 'challenge'));
        break;
      }
    }
  }
  return { findings, puzzle };
}

// --- title -------------------------------------------------------------------------------------

/** Whole titles of block pages, compared after `normTitle`; never a word inside a title. */
const TITLES: ReadonlyMap<string, Finding> = new Map([
  ['just a moment', finding('cloudflare', 'challenge')],
  ['un instant', finding('cloudflare', 'challenge')],
  ['einen moment bitte', finding('cloudflare', 'challenge')],
  ['un momento', finding('cloudflare', 'challenge')],
  ['attention required! | cloudflare', finding('cloudflare', 'access_denied')],
  // Akamai's page (S§5.1 cases; the Phase 0 lab met it at Best Buy CA and Home Depot CA).
  ['access denied', finding('akamai', 'access_denied', true)],
  ['access to this page has been denied', finding('perimeterx', 'access_denied')],
  ['robot or human?', finding('perimeterx', 'challenge')],
  ['pardon our interruption', finding('imperva', 'challenge')],
  ['ddos-guard', finding('ddos-guard', 'challenge')],
  ['vercel security checkpoint', finding('vercel', 'challenge')],
  ['verify your identity', finding(null, 'challenge')],
  ['human verification', finding(null, 'challenge')],
  ['please verify you are a human', finding(null, 'challenge')],
]);

function titleFindings(title: string): Finding[] {
  const t = normTitle(title);
  if (t === '') return [];
  const known = TITLES.get(t);
  if (known !== undefined) return [known];
  if (/^access denied \| \S{1,253} used cloudflare to restrict access$/.test(t)) {
    return [finding('cloudflare', 'access_denied')];
  }
  if (/^checking your browser(?: before accessing \S{1,253})?$/.test(t)) {
    return [finding(null, 'challenge')];
  }
  return [];
}

// --- visible text ------------------------------------------------------------------------------

interface Copy {
  /** Every phrase must appear in the page's visible text. */
  readonly all: readonly string[];
  readonly vendor: string | null | 'site:amazon';
  readonly mode: Mode;
}

/** Block-page copy, checked only on a page with at most CHALLENGE_COPY_MAX_VISIBLE_CHARS. */
const COPY: readonly Copy[] = [
  { all: ['enter the characters you see below'], vendor: 'site:amazon', mode: 'captcha' },
  { all: ['type the characters you see in this image'], vendor: 'site:amazon', mode: 'captcha' },
  {
    all: ['click the button below to continue shopping'],
    vendor: 'site:amazon',
    mode: 'challenge',
  },
  { all: ['press & hold', 'human'], vendor: 'perimeterx', mode: 'captcha' },
  { all: ['press and hold', 'human'], vendor: 'perimeterx', mode: 'captcha' },
  { all: ['powered and protected by akamai'], vendor: 'akamai', mode: 'challenge' },
  { all: ['powered and protected by'], vendor: null, mode: 'challenge' },
  {
    all: ["you don't have permission to access", 'on this server', 'reference #'],
    vendor: 'akamai',
    mode: 'access_denied',
  },
  {
    all: ['sorry, you have been blocked', 'cloudflare'],
    vendor: 'cloudflare',
    mode: 'access_denied',
  },
  { all: ['checking your browser before accessing'], vendor: 'cloudflare', mode: 'challenge' },
  { all: ['checking if the site connection is secure'], vendor: 'cloudflare', mode: 'challenge' },
  {
    all: ['verify you are human by completing the action below'],
    vendor: 'cloudflare',
    mode: 'challenge',
  },
  { all: ['please enable js and disable any ad blocker'], vendor: 'datadome', mode: 'challenge' },
  { all: ['request unsuccessful. incapsula incident id'], vendor: 'imperva', mode: 'challenge' },
  { all: ['are you a robot'], vendor: null, mode: 'challenge' },
  { all: ['are you a human'], vendor: null, mode: 'challenge' },
  { all: ['verify you are a human'], vendor: null, mode: 'challenge' },
  { all: ['unusual traffic from your computer network'], vendor: null, mode: 'challenge' },
  { all: ['complete the security check to access'], vendor: null, mode: 'challenge' },
];

function textFindings(page: PageEvidence): Finding[] {
  if (page.visibleChars > CHALLENGE_COPY_MAX_VISIBLE_CHARS) return [];
  const text = norm(page.visibleText.slice(0, VISIBLE_TEXT_EXCERPT_CHARS));
  if (text === '') return [];
  const amazon = siteLabel(hostOf(page.finalUrl) ?? '') === 'amazon';
  const out: Finding[] = [];
  for (const copy of COPY) {
    if (!copy.all.every((phrase) => text.includes(phrase))) continue;
    const vendor = copy.vendor === 'site:amazon' ? (amazon ? 'amazon' : null) : copy.vendor;
    out.push(finding(vendor, copy.mode));
  }
  return out;
}

// --- the decision ------------------------------------------------------------------------------

function combine(findings: readonly Finding[], page: PageEvidence, puzzle: boolean): Wall {
  const mode: Mode =
    puzzle || findings.some((f) => f.mode === 'captcha')
      ? 'captcha'
      : findings.some((f) => f.mode === 'access_denied')
        ? 'access_denied'
        : 'challenge';
  const named = findings.find((f) => f.vendor !== null && f.guessed !== true)?.vendor;
  const guessed = findings.find((f) => f.vendor !== null)?.vendor;
  return { kind: 'wall', vendor: named ?? headerVendor(page.headers) ?? guessed ?? null, mode };
}

/** The wall evidence of a page, or null when there is none. Never throws. */
export function findWall(page: PageEvidence): Wall | null {
  try {
    if (page.status === 404 || page.status === 410) return null;
    const shaped = isBlockShaped(page);
    const markup = shaped ? markupFindings(page) : { findings: [], puzzle: false };
    const findings = [
      ...headerFindings(page.headers, page.status),
      ...urlFindings(page, shaped),
      ...markup.findings,
      ...(shaped ? titleFindings(page.title) : []),
      ...(shaped ? textFindings(page) : []),
    ];
    if (findings.length > 0) return combine(findings, page, markup.puzzle);
    if (page.status === 403) {
      // A bare 403 (S§5.1): a wall whose vendor is unknown, unless a bot manager's header names it.
      return {
        kind: 'wall',
        vendor: headerVendor(page.headers),
        mode: markup.puzzle ? 'captcha' : 'challenge',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** True for a 2xx page with nothing to read (see `EMPTY_MAX_VISIBLE_CHARS`). */
export function isEmptyPage(page: PageEvidence): boolean {
  return (
    page.status >= 200 &&
    page.status <= 299 &&
    page.visibleChars < EMPTY_MAX_VISIBLE_CHARS &&
    page.documentBytes < EMPTY_MAX_DOCUMENT_BYTES
  );
}

/**
 * The classifier's opinion: a wall, `empty`, or null when the status alone decides (the shape of
 * the `Classify` hook, and what the browser rung calls before mapping the status). Never throws.
 */
export function judgePage(page: PageEvidence): PageVerdict | null {
  const wall = findWall(page);
  if (wall !== null) return wall;
  return isEmptyPage(page) ? { kind: 'empty' } : null;
}

/**
 * The outcome of a loaded page (the corpus subject): `judgePage`, then the status. `now` (epoch
 * milliseconds) is needed only for a Retry-After given as a date; without it such a delay is null.
 * A status S§5.1 gives no kind of its own (a 3xx not followed, a 400, a 451) is `server_error`
 * here, because a page outcome cannot be a `network_error`; `fetchPage` reports those as
 * `network_error` with code `HTTP_<status>`, and the browser rung should map them the same way.
 */
export function classifyPage(page: PageEvidence, now?: number): PageOutcome {
  const { rung, status } = page;
  const verdict = judgePage(page);
  if (verdict !== null) return { ...verdict, rung };
  // `findWall` answers every 403; this holds even if it could not read the page.
  if (status === 403) return { kind: 'wall', rung, vendor: null, mode: 'challenge' };
  if (status >= 200 && status <= 299) return { kind: 'ok', rung };
  if (status === 404 || status === 410) return { kind: 'not_found', rung };
  if (status === 401) return { kind: 'login_required', rung };
  if (status === 402) return { kind: 'payment_required', rung };
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(page.headers['retry-after'], now ?? Number.NaN);
    return { kind: 'rate_limited', rung, retryAfterMs };
  }
  return { kind: 'server_error', rung };
}
