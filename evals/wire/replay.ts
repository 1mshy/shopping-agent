// Replay of recorded exchanges for tests: a fetch-compatible function and a local HTTP server
// on 127.0.0.1. Both serve fixtures in order, check each request against the recorded one, and
// fail loudly on a difference, so a test cannot pass against the wrong fixture.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { decodeChunk, type JsonValue, NULL_BODY_STATUSES, type WireFixture } from './format.ts';
import { redactJson, redactText } from './redact.ts';

export class WireReplayMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireReplayMismatchError';
  }
}

export interface ReplayOptions {
  /** 'recorded' waits for each chunk's recorded arrival offset; 'none' (default) does not. */
  timing?: 'none' | 'recorded';
}

interface Received {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  bodyText: string;
}

const mediaType = (v: string | undefined) => v?.split(';')[0]?.trim().toLowerCase();

function firstDifference(a: unknown, b: unknown, at = '$'): string | null {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDifference(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${at}.${k}`,
      );
      if (d) return d;
    }
  }
  return at;
}

/** What differs between a received request and the recorded one; empty when they match. The
 * received path and body are redacted the same way the recording was before comparing, so two
 * requests that differ only in a redacted field compare equal. */
export function describeMismatch(f: WireFixture, r: Received): string[] {
  const rec = f.request;
  const problems: string[] = [];
  if (r.method !== rec.method) problems.push(`method ${r.method}, recorded ${rec.method}`);
  const path = redactText(r.path, []);
  if (path !== rec.path) problems.push(`path ${path}, recorded ${rec.path}`);
  if (rec.headers.authorization !== undefined && !r.headers.authorization) {
    problems.push('no Authorization header, but the recorded request had one');
  }
  const ct = mediaType(rec.headers['content-type']);
  if (ct !== undefined && mediaType(r.headers['content-type']) !== ct) {
    problems.push(`content-type ${r.headers['content-type']}, recorded ${ct}`);
  }
  if (rec.body === null) {
    if (r.bodyText !== '') problems.push('a body was sent, but the recorded request had none');
  } else {
    let body: JsonValue;
    try {
      body = redactJson(JSON.parse(r.bodyText) as JsonValue, []);
    } catch {
      return [...problems, 'the body is not JSON, but the recorded request had a JSON body'];
    }
    const diff = firstDifference(body, rec.body);
    if (diff) problems.push(`body differs from the recording at ${diff}`);
  }
  return problems;
}

function label(f: WireFixture): string {
  return `${f.meta.serverFamily}/${f.meta.model}/${f.meta.scenario}`;
}

const toList = (f: WireFixture | readonly WireFixture[]): readonly WireFixture[] =>
  'formatVersion' in f ? [f] : f;

/** Shared bookkeeping for both replay forms: the next fixture, and every mismatch seen. A call
 * claims its slot synchronously when it is made, so concurrent calls are matched in call order
 * whatever order their bodies finish reading in. */
function sequence(fixtures: WireFixture | readonly WireFixture[]) {
  const queue = toList(fixtures);
  let next = 0;
  const mismatches: string[] = [];
  return {
    mismatches,
    claim(): number {
      next += 1;
      return next - 1;
    },
    check(slot: number, r: Received): WireFixture | WireReplayMismatchError {
      const f = queue[slot];
      const problems = f
        ? describeMismatch(f, r)
        : [`unexpected request #${slot + 1} (${r.method} ${r.path}); ${queue.length} recorded`];
      if (f && problems.length === 0) return f;
      const message = `${f ? label(f) : 'replay'}: ${problems.join('; ')}`;
      mismatches.push(message);
      return new WireReplayMismatchError(message);
    },
    assertDone(): void {
      if (mismatches.length > 0) throw new WireReplayMismatchError(mismatches.join('\n'));
      if (next < queue.length) {
        const left = queue.slice(next).map(label).join(', ');
        throw new WireReplayMismatchError(`recorded exchanges not requested: ${left}`);
      }
    },
  };
}

async function waitFor(f: WireFixture, i: number, started: number, timing: string | undefined) {
  const chunk = f.response.chunks[i];
  if (timing !== 'recorded' || !chunk) return;
  const wait = chunk.atMs - f.response.headersAtMs - (performance.now() - started);
  if (wait > 0) await sleep(wait);
}

export type ReplayFetch = ((
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>) & {
  readonly mismatches: readonly string[];
  /** Throws if any request mismatched or any recorded exchange was not requested. */
  assertDone(): void;
};

/** A fetch replacement. The body stream yields exactly one recorded chunk per read. */
export function createReplayFetch(
  fixtures: WireFixture | readonly WireFixture[],
  options: ReplayOptions = {},
): ReplayFetch {
  const seq = sequence(fixtures);
  const replay = async (input: string | URL | Request, init?: RequestInit) => {
    const slot = seq.claim(); // before the first await
    const req = new Request(input, init);
    const url = new URL(req.url);
    const f = seq.check(slot, {
      method: req.method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(req.headers),
      bodyText: await req.text(),
    });
    if (f instanceof WireReplayMismatchError) throw f;
    let i = 0;
    const started = performance.now();
    const body = NULL_BODY_STATUSES.has(f.response.status)
      ? null
      : new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              const chunk = f.response.chunks[i];
              if (!chunk) return controller.close();
              await waitFor(f, i, started, options.timing);
              i += 1;
              controller.enqueue(decodeChunk(chunk));
            },
          },
          { highWaterMark: 0 },
        );
    return new Response(body, { status: f.response.status, headers: f.response.headers });
  };
  return Object.assign(replay, { mismatches: seq.mismatches, assertDone: seq.assertDone });
}

export interface ReplayServer {
  readonly origin: string;
  /** origin + the recorded base path of the first fixture, e.g. http://127.0.0.1:1234/v1 */
  readonly baseUrl: string;
  readonly mismatches: readonly string[];
  /** Stops the server; rejects on any mismatch or any recorded exchange not requested. */
  close(): Promise<void>;
}

/** A local server on 127.0.0.1. Each chunk is its own write with Nagle off and a pause between
 * writes (`chunkGapMs`, default 10), so boundaries normally survive TCP; the fetch form above
 * is the one that guarantees them. On a mismatch the connection is dropped. */
export async function startReplayServer(
  fixtures: WireFixture | readonly WireFixture[],
  options: ReplayOptions & { chunkGapMs?: number } = {},
): Promise<ReplayServer> {
  const seq = sequence(fixtures);
  const server = createServer(async (req, res) => {
    // Claimed when the request's headers arrive, before its body is read.
    const slot = seq.claim();
    try {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part as Buffer);
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = [v].flat().join(', ');
      const f = seq.check(slot, {
        method: req.method ?? '',
        path: req.url ?? '',
        headers,
        bodyText: Buffer.concat(parts).toString('utf8'),
      });
      if (f instanceof WireReplayMismatchError) {
        req.socket.destroy();
        return;
      }
      res.socket?.setNoDelay(true);
      res.writeHead(f.response.status, f.response.headers);
      res.flushHeaders();
      const started = performance.now();
      if (!NULL_BODY_STATUSES.has(f.response.status)) {
        for (const [i, chunk] of f.response.chunks.entries()) {
          if (options.timing === 'recorded') await waitFor(f, i, started, options.timing);
          else if (i > 0) await sleep(options.chunkGapMs ?? 10);
          res.write(decodeChunk(chunk));
        }
      }
      res.end();
    } catch {
      req.socket.destroy();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const basePath = toList(fixtures)[0]?.meta.basePath.replace(/\/+$/, '') ?? '';
  return {
    origin,
    baseUrl: origin + basePath,
    mismatches: seq.mismatches,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      seq.assertDone();
    },
  };
}
