// Probes one host for the routes of one list, with the fewest requests: robots.txt first (it
// counts against the cap and settles the origin), then each route once.
//   woocommerce   robots + Store API search                                  = 2
//   magento       robots + GraphQL products search (GET)                     = 2
//   shopify       robots + suggest.json + products/<handle>.js               = 3
//                 (+ home page when suggest.json yields no handle)           = 4
//   searchaction  robots + home page + OpenSearch description if linked     <= 3
// Redirect hops and one retry after a network error also count; the cap stops the rest.
import { classify } from './classify.ts';
import {
  findOpenSearchLink,
  findProductHandle,
  validateOpenSearch,
  validateSearchAction,
} from './discover.ts';
import { answerEvidence } from './evidence.ts';
import { sameSite } from './guard.ts';
import { Budget, get, type HttpConfig, type HttpResult } from './http.ts';
import type {
  DomainResult,
  ListKind,
  Outcome,
  Platform,
  RouteKind,
  RouteResult,
  Validation,
} from './outcome.ts';
import { fetchRobots } from './robots.ts';
import {
  MAGENTO_PATH,
  productJsPath,
  SUGGEST_PATH,
  validateMagento,
  validateProductJs,
  validateSuggest,
  validateWoo,
  WOO_PATH,
} from './routes.ts';

export interface ProbeConfig extends HttpConfig {
  maxRequests: number;
  scheme: 'https' | 'http';
}

// Failures of robots.txt that every later request to the host would repeat: DNS and TLS
// certificate errors (the pilot spent a second request on each).
const HOST_LEVEL_ERROR = /^(ENOTFOUND|ENODATA)$|CERT|ERR_TLS_|SSL/;
const JSON_HEADERS = { accept: 'application/json' };
const HTML_HEADERS = { accept: 'text/html,application/xhtml+xml' };

function toResult(
  route: RouteKind,
  url: string,
  r: HttpResult,
  validate: (body: string) => Validation,
  platform: Platform,
  robots: RouteResult['robots'],
): Fetched {
  if (!r.ok) {
    const evidence = { finalUrl: r.finalUrl, signals: [], hops: r.hops, ms: r.ms };
    return { result: { route, url, outcome: r.outcome, evidence, robots, requests: r.requests } };
  }
  const v = validate(r.res.body);
  const c = classify(r.res, v, platform);
  const evidence = answerEvidence(r.res, v, { signals: c.signals, hops: r.hops, ms: r.ms });
  const result = { route, url, outcome: c.outcome, evidence, robots, requests: r.requests };
  return { result, v, body: r.res.body };
}

type Fetched = { result: RouteResult; v?: Validation; body?: string };

const notRequested = (
  route: RouteKind,
  url: string,
  outcome: Outcome,
  why: string,
): RouteResult => ({
  route,
  url,
  outcome,
  evidence: { signals: [why], hops: 0 },
  robots: 'unknown' as const,
  requests: 0,
});

export async function probeDomain(
  domain: string,
  list: ListKind,
  cfg: ProbeConfig,
): Promise<DomainResult> {
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  const budget = new Budget(cfg.maxRequests);
  const robots = await fetchRobots(`${cfg.scheme}://${domain}`, cfg, budget);
  const origin = robots.origin;
  const routes: RouteResult[] = [];

  const fetchRoute = async (
    route: RouteKind,
    path: string,
    validate: (body: string) => Validation,
    platform: Platform,
    headers: Record<string, string> = JSON_HEADERS,
  ): Promise<Fetched> => {
    const url = `${origin}${path}`;
    // A host that failed the guard, DNS or TLS for robots.txt fails again; spend nothing.
    const f = robots.failure;
    if (
      f &&
      (f.kind === 'refused_by_policy' ||
        (f.kind === 'network_error' && HOST_LEVEL_ERROR.test(f.code)))
    ) {
      return {
        result: { ...notRequested(route, url, f, 'inherited:robots'), robots: robots.verdict(url) },
      };
    }
    const r = await get(url, cfg, budget, headers);
    return toResult(route, url, r, validate, platform, robots.verdict(url));
  };

  if (list === 'woocommerce') {
    routes.push(
      (await fetchRoute('woo_store_search', WOO_PATH, validateWoo, 'woocommerce')).result,
    );
  } else if (list === 'magento') {
    const headers = { ...JSON_HEADERS, 'content-type': 'application/json' };
    routes.push(
      (await fetchRoute('magento_graphql', MAGENTO_PATH, validateMagento, 'magento', headers))
        .result,
    );
  } else if (list === 'shopify') {
    const suggest = await fetchRoute('shopify_suggest', SUGGEST_PATH, validateSuggest, 'shopify');
    routes.push(suggest.result);
    let handle = suggest.v && 'handle' in suggest.v ? (suggest.v.handle as string) : undefined;
    let handleSource: RouteResult['handleSource'] = handle ? 'suggest' : undefined;
    let extra = 0;
    let discovery: RouteResult['discovery'];
    if (
      !handle &&
      budget.used < budget.max &&
      !suggest.result.evidence.signals.includes('inherited:robots')
    ) {
      const home = await get(`${origin}/`, cfg, budget, HTML_HEADERS);
      extra = home.requests;
      if (home.ok && home.res.status < 300) handle = findProductHandle(home.res.body);
      if (handle) handleSource = 'home';
      discovery = home.ok
        ? answerEvidence(
            home.res,
            handle
              ? { valid: true, items: 1, note: handle }
              : { valid: false, reason: 'no_handle' },
            { signals: [], hops: home.hops, ms: home.ms },
          )
        : { finalUrl: home.finalUrl, signals: [home.outcome.kind], hops: home.hops, ms: home.ms };
    }
    const found = discovery ? { discovery } : {};
    if (handle) {
      const p = await fetchRoute(
        'shopify_product_js',
        productJsPath(handle),
        validateProductJs,
        'shopify',
      );
      routes.push({ ...p.result, requests: p.result.requests + extra, handleSource, ...found });
    } else if (suggest.result.evidence.signals.includes('inherited:robots')) {
      const url = `${origin}/products/?.js`;
      routes.push(
        notRequested('shopify_product_js', url, suggest.result.outcome, 'inherited:robots'),
      );
    } else {
      const reason = budget.used >= budget.max ? 'request_cap' : 'no_handle';
      routes.push({
        ...notRequested(
          'shopify_product_js',
          `${origin}/products/?.js`,
          { kind: 'skipped', reason },
          reason,
        ),
        requests: extra,
        ...found,
      });
    }
  } else {
    const home = await fetchRoute(
      'home_searchaction',
      '/',
      validateSearchAction,
      'any',
      HTML_HEADERS,
    );
    routes.push(home.result);
    const page = home.result.evidence;
    const fetched = home.body !== undefined && page.status !== undefined && page.status < 300;
    const link = fetched ? findOpenSearchLink(home.body ?? '', page.finalUrl ?? origin) : undefined;
    if (!fetched) {
      routes.push(notRequested('opensearch', `${origin}/`, home.result.outcome, 'inherited:home'));
    } else if (!link) {
      // Decided by discovery, not by the classifier: keep the page's facts, but no `valid`, so
      // reclassify.ts leaves it alone.
      const { valid: _valid, items: _items, snippet: _snippet, ...facts } = page;
      routes.push({
        ...notRequested('opensearch', `${origin}/`, { kind: 'not_found' }, 'no_link'),
        robots: robots.verdict(`${origin}/`),
        evidence: { ...facts, validation: 'absent', signals: ['no_link'] },
      });
    } else if (!sameSite(new URL(origin).hostname, new URL(link).hostname)) {
      const outcome: Outcome = { kind: 'refused_by_policy', reason: 'off_site_descriptor' };
      routes.push(notRequested('opensearch', link, outcome, 'off_site_descriptor'));
    } else {
      const r = await get(link, cfg, budget, { accept: 'application/opensearchdescription+xml' });
      routes.push(
        toResult('opensearch', link, r, validateOpenSearch, 'any', robots.verdict(link)).result,
      );
    }
  }

  return {
    v: 2,
    list,
    domain,
    userAgent: cfg.userAgent,
    startedAt,
    ms: Math.round(performance.now() - t0),
    origin,
    requests: budget.used,
    robots: robots.record,
    routes,
  };
}
