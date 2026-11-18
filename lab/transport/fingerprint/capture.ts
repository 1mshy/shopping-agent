// A local capture server for client fingerprints, loopback only. A TCP front records the raw
// ClientHello and passes every byte through to a TLS server behind it (ALPN h2 and http/1.1),
// which records the first HTTP/2 frames (or the HTTP/1.1 request head) and answers 200.
import { connect, createServer as createNetServer, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer, type TLSSocket } from 'node:tls';
import { type ClientHello, handshakeFromRecords, parseClientHello } from './clienthello.ts';
import { type H2Fingerprint, h2Fingerprint, parseFrames, serverFrames } from './h2.ts';

export interface Capture {
  id: number;
  clientHelloHex?: string;
  clientHello?: ClientHello;
  alpn?: string | false;
  h2?: H2Fingerprint;
  /** HTTP/1.1: the request line and the header names in order (values are not kept). */
  h1?: { requestLine: string; headerNames: string[] };
  error?: string;
}

export interface CaptureServer {
  port: number;
  captures: Capture[];
  close(): Promise<void>;
}

export async function startCapture(
  tls: { key: string | Buffer; cert: string | Buffer },
  hosts: string[] = ['127.0.0.1'],
): Promise<CaptureServer> {
  const captures: Capture[] = [];
  const byUpstreamPort = new Map<number, Capture>();
  const sockets = new Set<Socket>();
  const track = (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  };

  const back = createTlsServer({ ...tls, ALPNProtocols: ['h2', 'http/1.1'] }, (s: TLSSocket) => {
    track(s);
    const cap = byUpstreamPort.get(s.remotePort ?? -1) ?? { id: -1 };
    cap.alpn = s.alpnProtocol ?? false;
    let buf = Buffer.alloc(0);
    let done = false;
    if (s.alpnProtocol === 'h2') s.write(serverFrames.settings());
    s.on('data', (d: Buffer) => {
      if (done) return;
      buf = Buffer.concat([buf, d]);
      if (s.alpnProtocol === 'h2') {
        const { frames } = parseFrames(buf);
        if (frames.some((f) => f.type === 4 && (f.flags & 1) === 0)) s.write(serverFrames.ack());
        const head = frames.find((f) => (f.type === 1 || f.type === 9) && f.flags & 0x04);
        if (head) {
          done = true;
          cap.h2 = h2Fingerprint(frames);
          s.write(serverFrames.ok(head.stream));
          s.write(serverFrames.goaway(head.stream));
          setTimeout(() => s.end(), 100);
        }
      } else {
        const end = buf.indexOf('\r\n\r\n');
        if (end >= 0) {
          done = true;
          const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
          cap.h1 = {
            requestLine: lines[0] ?? '',
            headerNames: lines.slice(1).map((l) => l.split(':')[0]?.trim().toLowerCase() ?? ''),
          };
          s.end(
            'HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok',
          );
        }
      }
    });
    s.on('error', (e) => {
      cap.error = cap.error ?? String(e.message);
    });
  });
  back.on('tlsClientError', () => {});
  await new Promise<void>((r) => back.listen(0, '127.0.0.1', r));
  const backPort = (back.address() as { port: number }).port;

  const onClient = (client: Socket) => {
    track(client);
    const cap: Capture = { id: captures.length };
    captures.push(cap);
    let hello = Buffer.alloc(0);
    let parsed = false;
    const up = connect(backPort, '127.0.0.1');
    track(up);
    up.on('connect', () => byUpstreamPort.set(up.localPort ?? -1, cap));
    client.on('data', (d: Buffer) => {
      if (!parsed) {
        hello = Buffer.concat([hello, d]);
        try {
          const hs = handshakeFromRecords(hello);
          if (hs) {
            parsed = true;
            cap.clientHelloHex = Buffer.from(hs).toString('hex');
            cap.clientHello = parseClientHello(hs);
          }
        } catch (e) {
          parsed = true;
          cap.error = `not TLS: ${(e as Error).message}`;
        }
      }
      up.write(d);
    });
    up.on('data', (d: Buffer) => client.write(d));
    client.on('end', () => up.end());
    up.on('end', () => client.end());
    client.on('error', () => up.destroy());
    up.on('error', () => client.destroy());
  };
  // One port on every requested loopback address, so `localhost` works over IPv4 or IPv6.
  const fronts: Server[] = [];
  let port = 0;
  for (const host of hosts) {
    const front = createNetServer(onClient);
    await new Promise<void>((r) => front.listen(port, host, r));
    port = (front.address() as { port: number }).port;
    fronts.push(front);
  }
  return {
    port,
    captures,
    async close() {
      for (const s of sockets) s.destroy();
      for (const f of fronts) await new Promise((r) => f.close(r));
      await new Promise((r) => back.close(r));
    },
  };
}
