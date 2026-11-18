// ClientHello, JA4/JA3 and HTTP/2 fingerprint parsing. No external network: the vectors were
// captured on loopback (vectors.json says how), and the live cases below use 127.0.0.1 only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect as h2connect } from 'node:http2';
import { createServer, type Server } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { handshakeFromRecords, isGrease, ja3, ja4, parseClientHello } from './clienthello.ts';
import { h2Fingerprint, headerNames, PREFACE, parseFrames, serverFrames } from './h2.ts';
import { scrub } from './run.ts';

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')) as {
  captures: Record<string, { clientHelloHex: string; echoJa4: string; echoAkamai: string }>;
};
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

/** The first bytes a client sends to a raw TCP listener on 127.0.0.1. */
async function firstBytes(send: (port: number) => void, enough: (b: Buffer) => boolean) {
  let resolve: (b: Buffer) => void = () => {};
  const got = new Promise<Buffer>((r) => {
    resolve = r;
  });
  const server = createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (enough(buf)) {
        resolve(buf);
        s.destroy();
      }
    });
    s.on('error', () => {});
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  send((server.address() as { port: number }).port);
  return got;
}

describe('scrub (echo answers keep nothing about the caller)', () => {
  it('drops address fields, the TCP/IP block and address strings, and keeps the fingerprints', () => {
    const echo = {
      ip: '198.51.100.7:51234',
      user_agent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36',
      tls: { ja4: 't13d1516h2_8daaf6152771_d8a2da3f94cd', client_ip: '198.51.100.7' },
      http2: { akamai_fingerprint: '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p' },
      tcpip: { tcp_syn: { src_ip: '198.51.100.7', ttl: 51 } },
      note: 'seen from 2001:db8:0:0:0:0:0:1',
    };
    expect(scrub(echo)).toEqual({
      user_agent: echo.user_agent,
      tls: { ja4: echo.tls.ja4 },
      http2: echo.http2,
      note: '[address removed]',
    });
  });
});

describe('GREASE', () => {
  it('recognises the reserved values and nothing else', () => {
    expect([0x0a0a, 0x1a1a, 0xfafa].every(isGrease)).toBe(true);
    expect([0x0a1a, 0x1301, 0x0000, 0xff01].some(isGrease)).toBe(false);
  });
});

describe('JA4 on captured ClientHellos', () => {
  it.each(Object.entries(vectors.captures))(
    '%s: our JA4 equals what tls.peet.ws reported for the same client',
    (_id, v) => {
      const hello = parseClientHello(Buffer.from(v.clientHelloHex, 'hex'));
      expect(hello.sni).toBe('localhost');
      expect(ja4(hello).ja4).toBe(v.echoJa4);
    },
  );
  it('gives the published hash of the cipher list Chrome offers (JA4 part b)', () => {
    const hello = parseClientHello(Buffer.from(vectors.captures.wreq?.clientHelloHex ?? '', 'hex'));
    expect(ja4(hello).ja4.split('_')[1]).toBe('8daaf6152771');
  });
  it('builds JA3 without GREASE, and JA3N with the extensions sorted', () => {
    const hello = parseClientHello(Buffer.from(vectors.captures.wreq?.clientHelloHex ?? '', 'hex'));
    const j = ja3(hello);
    expect(j.ja3.startsWith('771,4865-4866-4867-')).toBe(true);
    expect(j.ja3).not.toMatch(/\b(2570|6682|10794)\b/);
    const exts = j.ja3n.split(',')[2]?.split('-').map(Number) ?? [];
    expect(exts).toEqual([...exts].sort((a, b) => a - b));
    expect(j.ja3Hash).toBe(createHash('md5').update(j.ja3).digest('hex'));
  });
});

describe('ClientHello from a live Node TLS client on loopback', () => {
  it('parses SNI, ALPN and the version from the records, across chunks', async () => {
    const buf = await firstBytes(
      (port) => {
        const s = tlsConnect({
          port,
          host: '127.0.0.1',
          servername: 'fixture.example',
          ALPNProtocols: ['h2', 'http/1.1'],
        });
        s.on('error', () => {});
      },
      (b) => {
        try {
          return handshakeFromRecords(b) !== undefined;
        } catch {
          return true;
        }
      },
    );
    expect(handshakeFromRecords(buf.subarray(0, 10))).toBeUndefined();
    const hs = handshakeFromRecords(buf);
    expect(hs).toBeDefined();
    const hello = parseClientHello(hs as Uint8Array);
    expect(hello.sni).toBe('fixture.example');
    expect(hello.alpn).toEqual(['h2', 'http/1.1']);
    expect(ja4(hello).ja4).toMatch(/^t13d\d{4}h2_[0-9a-f]{12}_[0-9a-f]{12}$/);
  });
  it('refuses bytes that are not a TLS handshake', () => {
    expect(() => handshakeFromRecords(Buffer.from('GET / HTTP/1.1\r\n\r\n'))).toThrow();
  });
});

describe('HTTP/2 fingerprint', () => {
  it('reads a Chrome-shaped connection start into the Akamai string', () => {
    const settings = Buffer.alloc(24);
    [
      [1, 65536],
      [2, 0],
      [4, 6291456],
      [6, 262144],
    ].forEach(([k, v], i) => {
      settings.writeUInt16BE(k as number, i * 6);
      settings.writeUInt32BE(v as number, i * 6 + 2);
    });
    const wu = Buffer.alloc(4);
    wu.writeUInt32BE(15663105);
    // HEADERS with the PRIORITY flag: :method GET (static 2), :authority (literal, indexed name 1,
    // value "x"), :scheme https (static 7), :path / (static 4), then a regular header.
    const block = Buffer.from([0x82, 0x41, 0x01, 0x78, 0x87, 0x84, 0x7a, 0x01, 0x79]);
    const priority = Buffer.from([0x80, 0, 0, 0, 255]);
    const bytes = Buffer.concat([
      Buffer.from(PREFACE, 'latin1'),
      serverFrames.frame(4, 0, 0, settings),
      serverFrames.frame(8, 0, 0, wu),
      serverFrames.frame(1, 0x24 | 0x01, 1, Buffer.concat([priority, block])),
    ]);
    const { frames, preface, rest } = parseFrames(bytes);
    expect([preface, rest, frames.length]).toEqual([true, 0, 3]);
    const fp = h2Fingerprint(frames);
    expect(fp.akamai).toBe('1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p');
    expect(headerNames(block)).toEqual([':method', ':authority', ':scheme', ':path', 'user-agent']);
  });
  it('lists PRIORITY frames and leaves 00 with no window update', () => {
    const p = Buffer.from([0x00, 0, 0, 0, 200]);
    const head = Buffer.from([0x82, 0x84, 0x87, 0x41, 0x01, 0x78]);
    const fp = h2Fingerprint([
      { type: 4, flags: 0, stream: 0, payload: new Uint8Array() },
      { type: 2, flags: 0, stream: 3, payload: p },
      { type: 1, flags: 0x04, stream: 1, payload: head },
    ]);
    expect(fp.akamai).toBe('|00|3:0:0:201|m,p,s,a');
  });
  it("reads Node's own HTTP/2 client in cleartext on loopback", async () => {
    const buf = await firstBytes(
      (port) => {
        const c = h2connect(`http://127.0.0.1:${port}`);
        c.on('error', () => {});
        const r = c.request({ ':path': '/x' });
        r.on('error', () => {});
      },
      (b) => parseFrames(b).frames.some((f) => f.type === 1 && f.flags & 0x04),
    );
    const fp = h2Fingerprint(parseFrames(buf).frames);
    // Node may send an empty SETTINGS frame (all defaults); it is still the first frame.
    expect(fp.frameTypes[0]).toBe(4);
    expect([...fp.pseudoOrder].sort()).toEqual(['a', 'm', 'p', 's']);
    expect(fp.akamai).toMatch(/^[\d:;]*\|(\d+|00)\|0\|[amps,]+$/);
  });
});
