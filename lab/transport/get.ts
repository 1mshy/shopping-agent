// One guarded, paced GET through an HttpTransport, with redirects followed by hand. The rules are
// spike C's (lab/routes/http.ts), reused by import where they are exported: the URL guard and the
// same-site test (guard.ts), the request budget (http.ts `Budget`) and the pacer (pacer.ts).
// `routes/http.ts#get` itself is wired to Node's fetch, so the loop is written here once more
// against the seam: guard each hop, refuse an off-site redirect, at most `maxHops` hops, one retry
// after a retryable network error, a Retry-After on 429/503 defers the host.
import type { HttpResponse } from '../routes/classify.ts';
import { checkUrl, type GuardOptions, sameSite } from '../routes/guard.ts';
import type { Budget } from '../routes/http.ts';
import type { Outcome } from '../routes/outcome.ts';
import type { Pacer } from '../routes/pacer.ts';
import { type HttpTransport, RETRYABLE } from './transport.ts';

export interface GetConfig {
  timeoutMs: number;
  maxBytes: number;
  maxHops: number;
  guard: GuardOptions;
  pacer: Pacer;
}

/** One request on the wire (a redirect hop or a retry is its own entry). */
export interface Hop {
  url: string;
  status?: number;
  location?: string;
  error?: string;
  detail?: string;
  ms: number;
}

export type GetResult = {
  requests: number;
  hops: number;
  ms: number;
  chain: Hop[];
  facts: Record<string, string | number | boolean>;
} & (
  | { ok: true; res: HttpResponse; raw: Uint8Array }
  | { ok: false; outcome: Outcome; finalUrl: string }
);

const MAX_RETRY_AFTER_MS = 60_000;

/** Takes one request from every budget, or none if any is spent. */
function take(budgets: Budget[]): boolean {
  if (budgets.some((b) => b.used >= b.max)) return false;
  for (const b of budgets) b.take();
  return true;
}

export async function guardedGet(
  start: string,
  transport: HttpTransport,
  cfg: GetConfig,
  budgets: Budget[],
): Promise<GetResult> {
  const t0 = performance.now();
  let url = new URL(start);
  let hops = 0;
  let requests = 0;
  let retried = false;
  let facts: Record<string, string | number | boolean> = {};
  const chain: Hop[] = [];
  const base = () => ({
    requests,
    hops,
    chain,
    facts,
    ms: Math.round(performance.now() - t0),
  });
  const fail = (outcome: Outcome): GetResult => ({
    ok: false,
    outcome,
    finalUrl: url.href,
    ...base(),
  });
  for (;;) {
    const g = await checkUrl(url, cfg.guard);
    if (!g.ok) {
      return fail(
        g.reason === 'dns'
          ? { kind: 'network_error', code: g.code ?? 'EDNS' }
          : { kind: 'refused_by_policy', reason: g.reason },
      );
    }
    // Checked after the guard, so a redirect to a private address reports the refusal.
    if (!sameSite(new URL(start).hostname, url.hostname)) {
      return fail({ kind: 'off_site_redirect', to: url.origin });
    }
    if (!take(budgets)) return fail({ kind: 'skipped', reason: 'request_cap' });
    requests++;
    const target = url;
    const h0 = performance.now();
    const r = await cfg.pacer.run(target.host, () =>
      transport.get({ url: target.href, timeoutMs: cfg.timeoutMs, maxBytes: cfg.maxBytes }),
    );
    const ms = Math.round(performance.now() - h0);
    if (!r.ok) {
      chain.push({ url: target.href, error: r.error, detail: r.detail, ms });
      if (r.error === 'body_cap') return fail({ kind: 'refused_by_policy', reason: 'body_cap' });
      if (!retried && RETRYABLE.has(r.error)) {
        retried = true;
        continue;
      }
      return fail({ kind: 'network_error', code: r.error });
    }
    const res = r.response;
    facts = res.facts;
    const location = res.headers.find(([k]) => k === 'location')?.[1];
    chain.push({
      url: target.href,
      status: res.status,
      ...(location ? { location } : {}),
      ms,
    });
    if (res.status >= 300 && res.status < 400 && location) {
      if (++hops > cfg.maxHops) {
        return fail({ kind: 'refused_by_policy', reason: 'too_many_redirects' });
      }
      try {
        url = new URL(location, url);
      } catch {
        return fail({ kind: 'refused_by_policy', reason: 'bad_location' });
      }
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const after = Number(res.headers.find(([k]) => k === 'retry-after')?.[1]);
      if (after > 0) cfg.pacer.defer(url.host, Math.min(after * 1000, MAX_RETRY_AFTER_MS));
    }
    const headers = new Headers();
    for (const [k, v] of res.headers) {
      try {
        headers.append(k, v);
      } catch {
        // A header value Node's Headers refuses (invalid characters) is left out of the view.
      }
    }
    return {
      ok: true,
      res: {
        status: res.status,
        headers,
        finalUrl: url.href,
        body: new TextDecoder().decode(res.body),
        bytes: res.body.byteLength,
      },
      raw: res.body,
      ...base(),
    };
  }
}
