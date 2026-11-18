// wreq-js (Rust wreq + BoringSSL). The only module that imports `wreq-js`.
// Profile as shipped: the newest Chrome profile it has, `chrome_149` (no `chrome_151`), with the
// library's default OS (`macos`). No headers, no TLS option. A standalone `fetch` call is an
// ephemeral session, so no cookie outlives one request.
import { fetch as wreqFetch } from 'wreq-js';
import {
  detailOf,
  errorCode,
  type HttpTransport,
  readCapped,
  type TransportRequest,
  type TransportResult,
} from '../transport.ts';
import { installedVersion } from './version.ts';

export const WREQ_PROFILE = 'chrome_149';

/** `insecure` exists only for the local fingerprint capture, never for a shop. */
export function wreqTransport(opts: { insecure?: boolean } = {}): HttpTransport {
  return {
    info: {
      id: 'wreq',
      library: 'wreq-js',
      version: installedVersion('wreq-js'),
      profile: WREQ_PROFILE,
      notes: 'newest Chrome profile shipped (no chrome_151); OS left at the default, macos',
    },
    async get(req: TransportRequest): Promise<TransportResult> {
      const deadline = Date.now() + req.timeoutMs;
      try {
        const res = await wreqFetch(req.url, {
          method: 'GET',
          browser: WREQ_PROFILE,
          redirect: 'manual',
          timeout: req.timeoutMs,
          signal: AbortSignal.timeout(req.timeoutMs),
          captureDiagnostics: true,
          ...(opts.insecure ? { insecure: true } : {}),
          ...(req.headers ? { headers: req.headers } : {}),
        });
        const read = await readCapped(
          res.body as ReadableStream<Uint8Array> | null,
          req.maxBytes,
          deadline,
        );
        if ('error' in read) return { ok: false, error: read.error, detail: read.error };
        const facts: Record<string, string | number | boolean> = {};
        const d = res.diagnostics;
        if (d?.remoteAddr) facts.remoteAddr = d.remoteAddr;
        if (d?.tlsPeerCertificatePresent !== undefined) {
          facts.tlsPeerCertificate = d.tlsPeerCertificatePresent;
        }
        if (d?.tlsPeerCertificateChainLength !== undefined) {
          facts.tlsChainLength = d.tlsPeerCertificateChainLength;
        }
        return {
          ok: true,
          response: {
            status: res.status,
            headers: res.headers.toTuples().map(([k, v]) => [k.toLowerCase(), v]),
            url: req.url,
            body: read.body,
            facts,
          },
        };
      } catch (e) {
        return { ok: false, error: errorCode(e), detail: detailOf(e) };
      }
    },
    async close() {},
  };
}
