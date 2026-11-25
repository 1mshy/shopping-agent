// impit (Apify; Rust reqwest + patched rustls). The only module that imports `impit`.
// Profile as shipped: `chrome151`, the plan's profile. No headers, no TLS option, no cookie jar
// (impit stores no cookies without one), HTTP/3 off (the default).
import { Impit } from 'impit';
import {
  detailOf,
  errorCode,
  type HttpTransport,
  headerTuples,
  readCapped,
  type TransportRequest,
  type TransportResult,
} from '../transport.ts';
import { installedVersion } from './version.ts';

export const IMPIT_PROFILE = 'chrome151';

/** `ignoreTlsErrors` exists only for the local fingerprint capture, never for a shop. */
export function impitTransport(opts: { ignoreTlsErrors?: boolean } = {}): HttpTransport {
  const client = new Impit({
    browser: IMPIT_PROFILE,
    ...(opts.ignoreTlsErrors ? { ignoreTlsErrors: true } : {}),
  });
  return {
    info: {
      id: 'impit',
      library: 'impit',
      version: installedVersion('impit'),
      profile: IMPIT_PROFILE,
      notes: 'profile claims Windows (its own User-Agent and client hints); HTTP/3 off (default)',
    },
    async get(req: TransportRequest): Promise<TransportResult> {
      const deadline = Date.now() + req.timeoutMs;
      try {
        const res = await client.fetch(req.url, {
          method: 'GET',
          redirect: 'manual',
          timeout: req.timeoutMs,
          signal: AbortSignal.timeout(req.timeoutMs),
          ...(req.headers ? { headers: req.headers } : {}),
        });
        const read = await readCapped(res.body, req.maxBytes, deadline);
        if ('error' in read) return { ok: false, error: read.error, detail: read.error };
        return {
          ok: true,
          response: {
            status: res.status,
            headers: headerTuples(res.headers),
            url: req.url,
            body: read.body,
            facts: {},
          },
        };
      } catch (e) {
        // impit's own timer can fire before ours, and its error then carries no timeout word
        // (seen in CI on Linux as `GenericFailure`). Any failure at or after the deadline is a
        // timeout, whichever of the three timers won.
        const error = Date.now() >= deadline ? 'timeout' : errorCode(e);
        return { ok: false, error, detail: detailOf(e) };
      }
    },
    async close() {},
  };
}
