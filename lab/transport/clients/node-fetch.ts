// Baseline: Node's own fetch (undici), no impersonation, the honest User-Agent of spike C.
import { USER_AGENT } from '../../routes/run.ts';
import {
  detailOf,
  errorCode,
  type HttpTransport,
  headerTuples,
  readCapped,
  type TransportRequest,
  type TransportResult,
} from '../transport.ts';

export { USER_AGENT };

export function nodeFetchTransport(): HttpTransport {
  return {
    info: {
      id: 'fetch',
      library: 'node',
      version: process.versions.node,
      profile: 'none',
      notes: `undici ${process.versions.undici ?? 'unknown'}; User-Agent "${USER_AGENT}"`,
    },
    async get(req: TransportRequest): Promise<TransportResult> {
      const deadline = Date.now() + req.timeoutMs;
      try {
        const res = await fetch(req.url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(req.timeoutMs),
          headers: { 'user-agent': USER_AGENT, ...req.headers },
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
        return { ok: false, error: errorCode(e), detail: detailOf(e) };
      }
    },
    async close() {},
  };
}
