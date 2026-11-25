// The pinned transport with the real `impit` engine and the real pinning proxy, against servers
// started here on 127.0.0.1. The URLs name `shop.test`, a name that resolves nowhere (RFC 6761):
// a request that arrives proves the connection went to the pinned address without a lookup.
// Nothing leaves the machine and no DNS query is made.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECT_FAILURE_CODES, readCapped } from '../../src/guard/index.ts';
import { impitEngine } from '../../src/transport/impit.ts';
import { pinnedTransport } from '../../src/transport/pinned.ts';
import { PinningProxy } from '../../src/transport/socks-proxy.ts';
import {
  ABORT_CODE,
  type HeaderList,
  TIMEOUT_CODE,
  type TransportResponse,
} from '../../src/transport/types.ts';

interface Seen {
  readonly url: string;
  readonly host: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
}

const seen: Seen[] = [];
let connections = 0;
let plain: http.Server;
let plainPort: number;
let tls: https.Server;
let tlsPort: number;
const sni: (string | undefined)[] = [];
let tlsRequests = 0;
const proxy = new PinningProxy();
const engine = impitEngine();

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

beforeAll(async () => {
  plain = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', host: req.headers.host, headers: req.headers });
    switch (req.url) {
      case '/redirect':
        res.writeHead(302, { location: '/elsewhere' });
        res.end();
        return;
      case '/hang-body':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<html>');
        return;
      case '/hang-headers':
        return;
      case '/cookie':
        res.writeHead(200, { 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
        res.end('ok');
        return;
      default:
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`hello ${req.url}`);
    }
  });
  plain.on('connection', () => {
    connections++;
  });
  plainPort = await listen(plain);

  tls = https.createServer(
    {
      key: fixture('untrusted-shop.test.key.pem'),
      cert: fixture('untrusted-shop.test.cert.pem'),
      SNICallback: (servername, callback) => {
        sni.push(servername);
        callback(null);
      },
    },
    (_req, res) => {
      tlsRequests++;
      res.end('tls');
    },
  );
  tls.on('tlsClientError', () => {});
  tlsPort = await listen(tls);
});

afterAll(async () => {
  plain.closeAllConnections();
  tls.closeAllConnections();
  await Promise.all([
    new Promise<void>((resolve) => plain.close(() => resolve())),
    new Promise<void>((resolve) => tls.close(() => resolve())),
    proxy.close(),
  ]);
});

function transport(options: {
  deadlineMs?: number;
  signal?: AbortSignal;
  headers?: HeaderList;
  deadline?: number;
}) {
  return pinnedTransport({
    engine,
    proxy,
    now: Date.now,
    context: {
      deadline: options.deadline ?? Date.now() + (options.deadlineMs ?? 5_000),
      signal: options.signal ?? new AbortController().signal,
      headersFor: () => options.headers ?? [],
    },
  });
}

async function text(response: TransportResponse): Promise<string> {
  const read = await readCapped(response.body, 1 << 20, response.contentLength);
  if (read.kind !== 'ok') throw new Error(`body not read: ${JSON.stringify(read)}`);
  return new TextDecoder().decode(read.bytes);
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error('expected a rejection');
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('the pinned impit transport', () => {
  it('connects to the pinned address with the Host header from the URL, no lookup made', async () => {
    const before = seen.length;
    const url = `http://shop.test:${plainPort}/page?q=1`;
    const response = await transport({}).exchange('127.0.0.1', plainPort, url);
    expect(response.status).toBe(200);
    expect(await text(response)).toBe('hello /page?q=1');
    const request = seen.slice(before);
    expect(request).toHaveLength(1);
    expect(request[0]?.host).toBe(`shop.test:${plainPort}`);
    // The request arrives in origin form, with nothing of the proxy in it.
    expect(request[0]?.url).toBe('/page?q=1');
    expect(request[0]?.headers['proxy-authorization']).toBeUndefined();
  });

  it('sends the profile’s own User-Agent and client hints, and the caller’s headers', async () => {
    const before = seen.length;
    const response = await transport({
      headers: [
        ['accept', 'application/json'],
        ['cookie', 'a=1'],
      ],
    }).exchange('127.0.0.1', plainPort, `http://shop.test:${plainPort}/headers`);
    await text(response);
    const headers = seen[before]?.headers ?? {};
    expect(headers['user-agent']).toMatch(/Chrome\/151\./);
    expect(headers['sec-ch-ua']).toMatch(/"Google Chrome";v="151"/);
    expect(headers.accept).toBe('application/json');
    expect(headers.cookie).toBe('a=1');
  });

  it('refuses a header the profile owns', async () => {
    const error = await rejection(
      transport({ headers: [['user-agent', 'bot']] }).exchange(
        '127.0.0.1',
        plainPort,
        `http://shop.test:${plainPort}/`,
      ),
    );
    expect(error).toBeInstanceOf(TypeError);
  });

  it('returns a redirect as it is, without following it', async () => {
    const before = seen.length;
    const response = await transport({}).exchange(
      '127.0.0.1',
      plainPort,
      `http://shop.test:${plainPort}/redirect`,
    );
    expect(response.status).toBe(302);
    expect(response.location).toBe('/elsewhere');
    await response.discard?.();
    expect(seen.slice(before).map((s) => s.url)).toEqual(['/redirect']);
  });

  it('keeps every Set-Cookie apart', async () => {
    const response = await transport({}).exchange(
      '127.0.0.1',
      plainPort,
      `http://shop.test:${plainPort}/cookie`,
    );
    await text(response);
    expect(response.headers.filter(([name]) => name === 'set-cookie')).toEqual([
      ['set-cookie', 'a=1; Path=/'],
      ['set-cookie', 'b=2; Path=/'],
    ]);
  });

  it('opens one connection per request', async () => {
    const before = connections;
    const t = transport({});
    for (const path of ['/one', '/two']) {
      await text(await t.exchange('127.0.0.1', plainPort, `http://shop.test:${plainPort}${path}`));
    }
    expect(connections - before).toBe(2);
  });

  it('times out a body that never ends, as a timeout', async () => {
    const started = Date.now();
    const response = await transport({ deadlineMs: 800 }).exchange(
      '127.0.0.1',
      plainPort,
      `http://shop.test:${plainPort}/hang-body`,
    );
    expect(response.status).toBe(200);
    const read = await readCapped(response.body, 1 << 20, response.contentLength);
    expect(read).toEqual({ kind: 'failed', code: TIMEOUT_CODE });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(750);
    expect(elapsed).toBeLessThan(4_000);
  });

  it('times out a response that never starts, as a timeout', async () => {
    const error = await rejection(
      transport({ deadlineMs: 600 }).exchange(
        '127.0.0.1',
        plainPort,
        `http://shop.test:${plainPort}/hang-headers`,
      ),
    );
    expect(error.code).toBe(TIMEOUT_CODE);
  });

  it('names a request the caller aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const error = await rejection(
      transport({ signal: controller.signal }).exchange(
        '127.0.0.1',
        plainPort,
        `http://shop.test:${plainPort}/hang-headers`,
      ),
    );
    expect(error.code).toBe(ABORT_CODE);
  });

  it('sends nothing once the deadline has passed', async () => {
    const before = connections;
    const error = await rejection(
      transport({ deadline: Date.now() - 1 }).exchange(
        '127.0.0.1',
        plainPort,
        `http://shop.test:${plainPort}/late`,
      ),
    );
    expect(error.code).toBe(TIMEOUT_CODE);
    expect(connections).toBe(before);
  });

  it('rejects a refused connection with a connect-failure code', async () => {
    const dead = await closedPort();
    const error = await rejection(
      transport({}).exchange('127.0.0.1', dead, `http://shop.test:${dead}/`),
    );
    expect(error.code).toBe('ECONNREFUSED');
    expect(CONNECT_FAILURE_CODES.has(error.code ?? '')).toBe(true);
  });

  it('takes the TLS server name from the URL and checks the certificate', async () => {
    const before = sni.length;
    const error = await rejection(
      transport({}).exchange('127.0.0.1', tlsPort, `https://shop.test:${tlsPort}/secure`),
    );
    // The server was reached at the pinned address and asked for shop.test by name...
    expect(sni.slice(before)).toEqual(['shop.test']);
    // ...and its certificate, which no authority signed, was refused: nothing was requested.
    expect(error.code).toBe('ERR_TLS_CERT');
    expect(CONNECT_FAILURE_CODES.has(error.code ?? '')).toBe(false);
    expect(tlsRequests).toBe(0);
  });
});
