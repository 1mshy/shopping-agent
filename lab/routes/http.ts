// One guarded, paced GET with manual redirects, a timeout and a body cap, on Node's own fetch
// (a plain client: no TLS or header impersonation; that is spike A's question).
import type { HttpResponse } from './classify.ts';
import { checkUrl, type GuardOptions, sameSite } from './guard.ts';
import type { Outcome } from './outcome.ts';
import type { Pacer } from './pacer.ts';

/** Per-domain request cap. Every HTTP request counts: robots.txt, redirect hops and a retry. */
export class Budget {
  used = 0;
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

export interface HttpConfig {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  maxHops: number;
  guard: GuardOptions;
  pacer: Pacer;
}

export type HttpResult = { requests: number; hops: number; ms: number } & (
  | { ok: true; res: HttpResponse }
  | { ok: false; outcome: Outcome; finalUrl: string }
);

const RETRYABLE = new Set([
  'timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const MAX_RETRY_AFTER_MS = 60_000;

function errorCode(e: unknown): string {
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  return err.cause?.code ?? err.code ?? err.cause?.name ?? err.name ?? 'unknown';
}

type Once = { status: number; headers: Headers; body: string; bytes: number } | { error: string };

async function once(url: URL, cfg: HttpConfig, headers: Record<string, string>): Promise<Once> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs),
      headers: { 'user-agent': cfg.userAgent, ...headers },
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > cfg.maxBytes) {
          await reader.cancel().catch(() => {});
          return { error: 'body_cap' };
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return { status: res.status, headers: res.headers, body, bytes };
  } catch (e) {
    return { error: errorCode(e) };
  }
}

export async function get(
  start: string,
  cfg: HttpConfig,
  budget: Budget,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const t0 = performance.now();
  let url = new URL(start);
  let hops = 0;
  let requests = 0;
  let retried = false;
  const fail = (outcome: Outcome): HttpResult => ({
    ok: false,
    outcome,
    finalUrl: url.href,
    requests,
    hops,
    ms: Math.round(performance.now() - t0),
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
    if (!budget.take()) return fail({ kind: 'skipped', reason: 'request_cap' });
    requests++;
    const target = url;
    const r = await cfg.pacer.run(target.host, () => once(target, cfg, headers));
    if ('error' in r) {
      if (r.error === 'body_cap') return fail({ kind: 'refused_by_policy', reason: 'body_cap' });
      if (!retried && RETRYABLE.has(r.error)) {
        retried = true;
        continue;
      }
      return fail({ kind: 'network_error', code: r.error });
    }
    const location = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && location) {
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
    if (r.status === 429 || r.status === 503) {
      const after = Number(r.headers.get('retry-after'));
      if (after > 0) cfg.pacer.defer(url.host, Math.min(after * 1000, MAX_RETRY_AFTER_MS));
    }
    return {
      ok: true,
      res: {
        status: r.status,
        headers: r.headers,
        finalUrl: url.href,
        body: r.body,
        bytes: r.bytes,
      },
      requests,
      hops,
      ms: Math.round(performance.now() - t0),
    };
  }
}
