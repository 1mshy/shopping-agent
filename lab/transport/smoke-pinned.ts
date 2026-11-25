// Manual smoke of the Phase 1 HTTP transport (unit P1-1b): real, guarded, pinned requests through
// `fetchPage` on the real network (node:dns, the pinning proxy, impit `chrome151`). Not part of
// the test suite. Only https://example.com/ and https://www.iana.org/ are asked for; every request
// on the wire (each redirect hop counts) starts at least 3.5 s after the one before, and the
// script refuses to send an eleventh.
//
// Usage: node lab/transport/smoke-pinned.ts
import {
  CookieJars,
  createHttpNetwork,
  fetchPage,
  type HttpNetwork,
  type PageRequest,
} from '../../packages/fetch/src/index.ts';

const MAX_REQUESTS = 10;
const GAP_MS = 3_500;
const DEADLINE_MS = 20_000;

let sent = 0;
let lastStart = 0;
const real = createHttpNetwork();

/** The real network, logged and paced; still handed only to the guard by fetchPage. */
const network: HttpNetwork = {
  open(context) {
    const net = real.open(context);
    return {
      async lookup(host) {
        const addresses = await net.lookup(host);
        console.info(`  lookup ${host} -> ${addresses.join(', ')}`);
        return addresses;
      },
      async exchange(address, port, url) {
        if (sent >= MAX_REQUESTS) throw new Error('smoke request allowance spent');
        const wait = lastStart + GAP_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastStart = Date.now();
        sent++;
        const headers = context.headersFor(url);
        console.info(
          `  request ${sent}: GET ${url} dialled at ${address}:${port}` +
            (headers.length > 0 ? ` with ${headers.map(([k]) => k).join(', ')}` : ''),
        );
        try {
          const response = await net.exchange(address, port, url);
          console.info(
            `    -> ${response.status}${response.location ? ` Location: ${response.location}` : ''}`,
          );
          return response;
        } catch (error) {
          console.info(`    -> failed: ${(error as { code?: string }).code ?? String(error)}`);
          throw error;
        }
      },
    };
  },
};

const jars = new CookieJars();
const requests: PageRequest[] = [
  {
    rung: 'http',
    url: 'https://example.com/',
    deadline: 0,
    signal: AbortSignal.timeout(DEADLINE_MS),
  },
  {
    rung: 'http',
    url: 'https://www.iana.org/',
    referer: 'https://www.iana.org/domains/reserved',
    deadline: 0,
    signal: AbortSignal.timeout(DEADLINE_MS),
  },
  {
    rung: 'api',
    url: 'https://example.com/',
    deadline: 0,
    signal: AbortSignal.timeout(DEADLINE_MS),
  },
];

for (const request of requests) {
  const timed = { ...request, deadline: Date.now() + DEADLINE_MS };
  console.info(`${request.rung} ${request.url}`);
  const started = Date.now();
  const { outcome, response } = await fetchPage(timed, { network, jars });
  console.info(`  outcome ${JSON.stringify(outcome)} in ${Date.now() - started} ms`);
  if (response !== null) {
    const title = /<title>([^<]*)<\/title>/i.exec(response.text)?.[1]?.trim();
    console.info(
      `  final ${response.finalUrl}, status ${response.status}, ${response.body.byteLength} bytes, ` +
        `content-type ${response.contentType}, title ${JSON.stringify(title)}, ` +
        `set-cookie ${response.setCookies.length}`,
    );
  }
}
console.info(`requests on the wire: ${sent}`);
process.exit(0);
