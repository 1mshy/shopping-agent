// The whole probe, every real adapter, against an in-process server on 127.0.0.1. The pages are
// hand-written fixtures (fixtures/README.md), not evidence about any shop.
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Pacer } from '../routes/pacer.ts';
import { createTransports } from './clients/index.ts';
import type { HostEntry } from './hosts/hosts.ts';
import { PER_CLIENT_CAP, type ProbeConfig, probeHost, rotation } from './probe.ts';
import { reclassifyHost } from './reclassify.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});
async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const entry = (url: string): HostEntry => ({
  key: 'fixture',
  host: new URL(url).host,
  url,
  source: 'lab',
  group: 'test',
  urlFrom: 'test',
  predecessor: { playbook: { strategy: 'http', date: '2026-10-01' }, read: null, lab: null },
});
const config = (over: Partial<ProbeConfig> = {}): ProbeConfig => ({
  timeoutMs: 3000,
  maxBytes: 1_000_000,
  maxHops: 3,
  guard: { allowLoopback: true },
  pacer: new Pacer({ minGapMs: 0 }),
  ...over,
});

describe('rotation', () => {
  it('rotates the base order so each client leads one host in three', () => {
    const base = ['fetch', 'impit', 'wreq'];
    expect(rotation(base, 0)).toEqual(['fetch', 'impit', 'wreq']);
    expect(rotation(base, 1)).toEqual(['impit', 'wreq', 'fetch']);
    expect(rotation(base, 2)).toEqual(['wreq', 'fetch', 'impit']);
    expect(rotation(base, 3)).toEqual(base);
  });
});

describe('probeHost', () => {
  it('reads a product page with every client, in the rotated order, and stores the bodies', async () => {
    const order: string[] = [];
    const base = await serve((req, res) => {
      const ua = String(req.headers['user-agent']);
      order.push(
        ua.includes('agentic-dasher') ? 'fetch' : ua.includes('Chrome/151') ? 'impit' : 'wreq',
      );
      if (req.url === '/old') res.writeHead(301, { location: '/product' }).end();
      else res.writeHead(200, { 'content-type': 'text/html' }).end(fixture('product-jsonld.html'));
    });
    const dir = mkdtempSync(join(tmpdir(), 'spike-a-'));
    const r = await probeHost(
      entry(`${base}/old`),
      createTransports(),
      1,
      config({ bodyDir: dir }),
    );
    expect(r.order).toEqual(['impit', 'wreq', 'fetch']);
    expect(order).toEqual(['impit', 'impit', 'wreq', 'wreq', 'fetch', 'fetch']);
    expect(r.requests).toBe(6);
    for (const x of r.results) {
      expect(x.outcome).toEqual({ kind: 'ok' });
      expect(x.requests).toBe(2);
      expect(x.evidence.readable?.methods).toEqual(['json-ld']);
      expect(x.evidence.finalUrl).toBe(`${base}/product`);
      const body = gunzipSync(readFileSync(join(dir, x.evidence.body as string))).toString();
      expect(body).toBe(fixture('product-jsonld.html'));
    }
    expect(r.results.map((x) => x.position)).toEqual([0, 1, 2]);
  });

  it('classifies a challenge with spike C wall rules and a page without price markup', async () => {
    const base = await serve((req, res) => {
      if (String(req.headers['user-agent']).includes('agentic-dasher')) {
        res
          .writeHead(403, {
            'content-type': 'text/html',
            'cf-mitigated': 'challenge',
            server: 'cloudflare',
          })
          .end(fixture('challenge.html'));
      } else res.writeHead(200, { 'content-type': 'text/html' }).end(fixture('no-price.html'));
    });
    const r = await probeHost(entry(`${base}/p`), createTransports(), 0, config());
    const by = Object.fromEntries(r.results.map((x) => [x.client, x.outcome]));
    expect(by.fetch).toEqual({ kind: 'wall', vendor: 'cloudflare', mode: 'challenge' });
    expect(by.impit).toEqual({ kind: 'invalid_payload' });
    expect(by.wreq).toEqual({ kind: 'invalid_payload' });
  });

  it('holds every client to the per-client cap on a redirect loop', async () => {
    const base = await serve((req, res) => {
      const n = Number((req.url ?? '/0').slice(1)) || 0;
      res.writeHead(302, { location: `/${n + 1}` }).end();
    });
    const r = await probeHost(entry(`${base}/0`), createTransports(), 0, config({ maxHops: 10 }));
    for (const x of r.results) {
      expect(x.requests).toBe(PER_CLIENT_CAP);
      expect(x.outcome).toEqual({ kind: 'skipped', reason: 'request_cap' });
    }
    expect(r.requests).toBe(PER_CLIENT_CAP * 3);
  });

  it('re-classifies offline to the same outcomes from the stored bodies', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end(fixture('product-jsonld.html'));
    });
    const dir = mkdtempSync(join(tmpdir(), 'spike-a-'));
    const r = await probeHost(entry(`${base}/p`), createTransports(), 2, config({ bodyDir: dir }));
    const again = reclassifyHost(r, dir);
    expect(again.results.map((x) => x.outcome)).toEqual(r.results.map((x) => x.outcome));
    expect(again.results.map((x) => x.evidence.readable)).toEqual(
      r.results.map((x) => x.evidence.readable),
    );
  });
});
