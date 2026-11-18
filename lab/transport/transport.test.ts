// The HttpTransport seam: every adapter against an in-process plain-HTTP server on 127.0.0.1. No
// external network. What the server serves is written for the test.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { impitTransport } from './clients/impit.ts';
import { nodeFetchTransport, USER_AGENT } from './clients/node-fetch.ts';
import { wreqTransport } from './clients/wreq.ts';
import { errorCode, type HttpTransport, readCapped, type TransportResult } from './transport.ts';

type Seen = { path: string; headers: IncomingMessage['headers'] };
const seen: Seen[] = [];
let server: Server;
let base = '';

function handle(req: IncomingMessage, res: ServerResponse) {
  const path = req.url ?? '/';
  seen.push({ path, headers: req.headers });
  if (path.startsWith('/redirect')) {
    res.writeHead(302, { location: '/page', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] }).end();
  } else if (path.startsWith('/big')) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(5000));
  } else if (path.startsWith('/hang')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('partial'); // never ends
  } else if (path.startsWith('/status/')) {
    res.writeHead(Number(path.slice(8)), { 'content-type': 'text/html' }).end('<html></html>');
  } else {
    res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'c=3; Path=/' })
      .end('<html><title>page</title></html>');
  }
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const req = (path: string, over: { timeoutMs?: number; maxBytes?: number } = {}) => ({
  url: `${base}${path}`,
  timeoutMs: over.timeoutMs ?? 5000,
  maxBytes: over.maxBytes ?? 1_000_000,
});
const okRes = (r: TransportResult) => {
  if (!r.ok) throw new Error(`expected an answer, got ${r.error}: ${r.detail}`);
  return r.response;
};

const transports: Array<[string, () => HttpTransport]> = [
  ['fetch', nodeFetchTransport],
  ['impit', () => impitTransport()],
  ['wreq', () => wreqTransport()],
];

describe.each(transports)('%s adapter', (id, make) => {
  const t = make();

  it('names its library, version and profile', () => {
    expect(t.info.id).toBe(id);
    expect(t.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(t.info.profile).toBe({ fetch: 'none', impit: 'chrome151', wreq: 'chrome_149' }[id]);
  });

  it('returns status, body, lowercased headers and every set-cookie value', async () => {
    const r = okRes(await t.get(req('/page')));
    expect(r.status).toBe(200);
    expect(new TextDecoder().decode(r.body)).toBe('<html><title>page</title></html>');
    expect(r.headers).toContainEqual(['content-type', 'text/html; charset=utf-8']);
    expect(r.url).toBe(`${base}/page`);
  });

  it('does not follow a redirect and keeps both cookies apart', async () => {
    const r = okRes(await t.get(req('/redirect')));
    expect(r.status).toBe(302);
    expect(r.headers).toContainEqual(['location', '/page']);
    expect(r.headers.filter(([k]) => k === 'set-cookie').map(([, v]) => v.split(';')[0])).toEqual([
      'a=1',
      'b=2',
    ]);
  });

  it('sends no cookie it was given on an earlier request', async () => {
    await t.get(req('/redirect?cookie-check'));
    await t.get(req('/page?cookie-check'));
    const last = seen.filter((s) => s.path === '/page?cookie-check').at(-1);
    expect(last?.headers.cookie).toBeUndefined();
  });

  it('sends only its own profile headers (impersonating) or the lab User-Agent (baseline)', async () => {
    await t.get(req(`/page?ua-${id}`));
    const h = seen.filter((s) => s.path === `/page?ua-${id}`).at(-1)?.headers ?? {};
    if (id === 'fetch') {
      expect(h['user-agent']).toBe(USER_AGENT);
      expect(h['sec-ch-ua']).toBeUndefined();
    } else {
      const major = id === 'impit' ? '151' : '149';
      expect(h['user-agent']).toContain(`Chrome/${major}`);
      expect(h['sec-ch-ua']).toContain(`v="${major}"`);
      expect(h['user-agent']).not.toContain('agentic-dasher');
    }
  });

  it('passes 4xx and 5xx answers through as answers', async () => {
    expect(okRes(await t.get(req('/status/404'))).status).toBe(404);
    expect(okRes(await t.get(req('/status/503'))).status).toBe(503);
  });

  it('refuses a body above the cap', async () => {
    const r = await t.get(req('/big', { maxBytes: 1000 }));
    expect(r).toMatchObject({ ok: false, error: 'body_cap' });
  });

  it('times out on a body that never ends', async () => {
    const r = await t.get(req('/hang', { timeoutMs: 400 }));
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('reports a refused connection as ECONNREFUSED', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise((r) => dead.close(r));
    const r = await t.get({ url: `http://127.0.0.1:${port}/`, timeoutMs: 3000, maxBytes: 1000 });
    expect(r).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });
});

describe('readCapped', () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
  it('joins the chunks of a body within the cap', async () => {
    const r = await readCapped(stream(['ab', 'cd']), 4, Date.now() + 1000);
    expect('body' in r && new TextDecoder().decode(r.body)).toBe('abcd');
  });
  it('stops at the first byte above the cap', async () => {
    expect(await readCapped(stream(['ab', 'cde']), 4, Date.now() + 1000)).toEqual({
      error: 'body_cap',
    });
  });
  it('reads a missing body as empty', async () => {
    const r = await readCapped(null, 4, Date.now() + 1000);
    expect('body' in r && r.body.byteLength).toBe(0);
  });
});

describe('errorCode', () => {
  it('maps each client vocabulary onto one set of codes', () => {
    expect(errorCode(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(errorCode(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('dns');
    expect(errorCode(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))).toBe(
      'ECONNRESET',
    );
    expect(
      errorCode(Object.assign(new Error('invalid peer certificate'), { name: 'ConnectError' })),
    ).toBe('tls');
    expect(
      errorCode(Object.assign(new Error('h2 protocol error'), { name: 'RemoteProtocolError' })),
    ).toBe('protocol');
    expect(errorCode(Object.assign(new Error('something'), { code: 'EWEIRD' }))).toBe('EWEIRD');
  });
});
