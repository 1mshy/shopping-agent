// A scripted in-process HTTP server on 127.0.0.1 for the recorder tests. It writes each
// scripted chunk as its own write, with a pause between writes, so the client sees the
// chunk boundaries the test chose.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

export interface SeenRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ScriptedResponse {
  status: number;
  headers?: Record<string, string>;
  chunks: readonly (string | Uint8Array)[];
}

export async function startScriptedServer(
  route: (req: SeenRequest) => ScriptedResponse,
  gapMs = 40,
): Promise<{ origin: string; seen: SeenRequest[]; close(): Promise<void> }> {
  const seen: SeenRequest[] = [];
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(part as Buffer);
    const r: SeenRequest = {
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      body: Buffer.concat(parts).toString('utf8'),
    };
    seen.push(r);
    const out = route(r);
    res.socket?.setNoDelay(true);
    res.writeHead(out.status, out.headers);
    res.flushHeaders();
    for (const [i, chunk] of out.chunks.entries()) {
      if (i > 0) await sleep(gapMs);
      res.write(chunk);
    }
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
