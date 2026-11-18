// Fingerprint check of spike A's clients. Makes requests: run it only on purpose.
//   node lab/transport/fingerprint/run.ts --out lab/out/transport/fingerprint [--echo]
// 1. Local: a self-signed certificate (openssl), the capture server on loopback, and one GET of
//    https://localhost:<port>/ per client. Certificate checking is switched off for this request
//    only (impit `ignoreTlsErrors`, wreq-js `insecure`, NODE_TLS_REJECT_UNAUTHORIZED for fetch),
//    the one TLS option the lab ever sets, and only against its own loopback server.
// 2. With --echo: one GET per client of https://tls.peet.ws/api/all (the service the predecessor's
//    reference captures came from), with certificate checking on, so local and remote can be
//    compared and the client compared with the reference through the same tool.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { impitTransport } from '../clients/impit.ts';
import { nodeFetchTransport } from '../clients/node-fetch.ts';
import { wreqTransport } from '../clients/wreq.ts';
import type { HttpTransport } from '../transport.ts';
import { startCapture } from './capture.ts';
import { ja3, ja4 } from './clienthello.ts';

const ECHO = 'https://tls.peet.ws/api/all';

interface Reference {
  cell: string;
  major: number;
  ja4: string;
  akamai: string;
  browser: string;
  capturedAt: string;
  file: string;
}

async function viaFetchInsecure(t: HttpTransport, url: string) {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await t.get({ url, timeoutMs: 10_000, maxBytes: 1_000_000 });
  } finally {
    if (before === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = before;
  }
}

/**
 * The echo answer without anything about the caller: address fields, the TCP/IP block (the
 * machine's addresses and its OS's TCP fingerprint), and any string that holds an IPv4 or IPv6
 * address.
 */
export function scrub(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(scrub);
  if (typeof x === 'string') {
    return /\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){4,7}\b/i.test(x) &&
      !/Chrome\/|^\d+\.0\.0\.0$/.test(x)
      ? '[address removed]'
      : x;
  }
  if (!x || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x)) {
    if (/(^|_)ip($|_)|^tcpip$|addr|country|donate/i.test(k)) continue;
    out[k] = scrub(v);
  }
  return out;
}

async function main(): Promise<void> {
  const { values: a } = parseArgs({
    options: {
      out: { type: 'string', default: 'lab/out/transport/fingerprint' },
      echo: { type: 'boolean', default: false },
    },
  });
  mkdirSync(a.out, { recursive: true });
  const key = join(a.out, 'key.pem');
  const cert = join(a.out, 'cert.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ]);
  const server = await startCapture({ key: readFileSync(key), cert: readFileSync(cert) }, [
    '127.0.0.1',
    '::1',
  ]);
  const local: HttpTransport[] = [
    nodeFetchTransport(),
    impitTransport({ ignoreTlsErrors: true }),
    wreqTransport({ insecure: true }),
  ];
  const results: Record<string, unknown> = {};
  for (const t of local) {
    const before = server.captures.length;
    const url = `https://localhost:${server.port}/fingerprint`;
    const r =
      t.info.id === 'fetch'
        ? await viaFetchInsecure(t, url)
        : await t.get({ url, timeoutMs: 10_000, maxBytes: 1_000_000 });
    const caps = server.captures.slice(before);
    const cap = caps.find((c) => c.clientHello) ?? caps[0];
    const hello = cap?.clientHello;
    results[t.info.id] = {
      info: t.info,
      answer: r.ok ? r.response.status : `${r.error}: ${r.detail}`,
      connections: caps.length,
      local: hello
        ? {
            sni: hello.sni ?? null,
            alpnOffered: hello.alpn,
            alpnNegotiated: cap?.alpn ?? null,
            ...ja4(hello),
            ...ja3(hello),
            extensions: hello.extensions.map((e) => e.type),
            h2: cap?.h2 ?? null,
            h1: cap?.h1 ?? null,
            clientHelloHex: cap?.clientHelloHex,
          }
        : { error: cap?.error ?? 'no capture' },
    };
  }
  await server.close();
  if (a.echo) {
    const remote: HttpTransport[] = [nodeFetchTransport(), impitTransport(), wreqTransport()];
    for (const t of remote) {
      const r = await t.get({ url: ECHO, timeoutMs: 15_000, maxBytes: 1_000_000 });
      const entry = results[t.info.id] as Record<string, unknown>;
      if (!r.ok) {
        entry.echo = { error: `${r.error}: ${r.detail}` };
        continue;
      }
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(new TextDecoder().decode(r.response.body)) as Record<string, unknown>;
      } catch {
        entry.echo = { status: r.response.status, error: 'not JSON' };
        continue;
      }
      const tls = (json.tls ?? {}) as Record<string, unknown>;
      const h2 = (json.http2 ?? {}) as Record<string, unknown>;
      entry.echo = {
        service: ECHO,
        status: r.response.status,
        httpVersion: json.http_version,
        userAgent: json.user_agent,
        ja4: tls.ja4,
        ja4r: tls.ja4_r,
        ja3Hash: tls.ja3_hash,
        peetprintHash: tls.peetprint_hash,
        akamai: h2.akamai_fingerprint ?? null,
        raw: scrub(json),
      };
    }
  }
  const refs = (
    JSON.parse(readFileSync(new URL('./reference.json', import.meta.url), 'utf8')) as {
      captures: Reference[];
    }
  ).captures;
  const claim: Record<string, number | null> = { fetch: null, impit: 151, wreq: 149 };
  for (const [id, v] of Object.entries(results)) {
    const entry = v as Record<string, unknown>;
    const major = claim[id];
    const ref = refs.find((r) => r.major === major);
    entry.reference = ref
      ? { cell: ref.cell, file: ref.file, browser: ref.browser, ja4: ref.ja4, akamai: ref.akamai }
      : major
        ? `no capture of Chrome ${major} in the predecessor's fingerprints/`
        : 'not an impersonating client';
  }
  const file = join(a.out, 'fingerprints.json');
  writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
  for (const [id, v] of Object.entries(results)) {
    const e = v as {
      local?: { ja4?: string; h2?: { akamai?: string } | null; alpnNegotiated?: unknown };
      echo?: { ja4?: string; akamai?: string };
    };
    console.info(
      `${id}: local ja4=${e.local?.ja4} h2=${e.local?.h2?.akamai ?? `(alpn ${String(e.local?.alpnNegotiated)})`} | echo ja4=${e.echo?.ja4 ?? '-'} h2=${e.echo?.akamai ?? '-'}`,
    );
  }
  console.info(`written to ${file}`);
}

if (import.meta.main) await main();
