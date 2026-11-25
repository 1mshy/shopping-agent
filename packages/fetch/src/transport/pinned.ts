// The guard's `PinnedTransport` (guard/exchange.ts), on an `HttpEngine` and the pinning proxy.
// Per hop: one ticket on the proxy for the URL's host and port at the vetted address, one engine
// request through it, and a body that cannot be read past the deadline.
//
// The deadline rule (docs/progress.md, 2026-11-24): a failure at or after the request's deadline
// is a timeout (`TIMEOUT_CODE`), whatever the client called it; three timers race there (the
// engine's own, the abort signal, the body reader's) and any of them may win.
import net from 'node:net';
import { CONNECT_FAILURE_CODES, type PinnedTransport } from '../guard/index.ts';
import type { PinningProxy, Ticket } from './socks-proxy.ts';
import {
  ABORT_CODE,
  assertCallerHeaders,
  type EngineResponse,
  type ExchangeContext,
  type HeaderList,
  type HttpEngine,
  TIMEOUT_CODE,
  type TransportResponse,
} from './types.ts';

export interface PinnedTransportOptions {
  readonly engine: HttpEngine;
  readonly proxy: PinningProxy;
  readonly context: ExchangeContext;
  readonly now: () => number;
}

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** An Error with a `code`, as the guard reads it. */
export function codedError(code: string, message: string = code, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && CODE.test(code) ? code : undefined;
}

/** Rejects with the signal's reason as soon as it fires, whatever `promise` does. */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** The URL's host as the proxy compares it: IPv6 without brackets. */
function hostOf(url: URL): string {
  const host = url.hostname;
  return host.startsWith('[') ? host.slice(1, -1) : host;
}

function first(headers: HeaderList, name: string): string | undefined {
  return headers.find(([key]) => key === name)?.[1];
}

/** The guard's pinned transport for one request: see the module comment. */
export function pinnedTransport(
  options: PinnedTransportOptions,
): PinnedTransport<TransportResponse> {
  return {
    exchange: (address, port, url) => exchange(options, address, port, url),
  };
}

async function exchange(
  options: PinnedTransportOptions,
  address: string,
  port: number,
  url: string,
): Promise<TransportResponse> {
  const { engine, proxy, context, now } = options;
  const { deadline, signal } = context;
  const target = new URL(url);
  const headers = context.headersFor(target.href);
  assertCallerHeaders(headers);
  if (net.isIP(address) === 0) {
    throw codedError('ERR_INVALID_ADDRESS', `not an IP address: ${address}`);
  }

  const remaining = deadline - now();
  if (remaining <= 0) throw codedError(TIMEOUT_CODE, 'the deadline has passed');
  if (signal.aborted) throw codedError(ABORT_CODE, 'aborted', signal.reason);

  // The hop's own signal: fires at the deadline or when the caller aborts, and closes the hop's
  // connections then, so an engine that ignored its signal is cut off all the same.
  const hop = new AbortController();
  const timer = setTimeout(
    () => hop.abort(codedError(TIMEOUT_CODE, 'the deadline has passed')),
    remaining,
  );
  const onAbort = () => hop.abort(codedError(ABORT_CODE, 'aborted', signal.reason));
  signal.addEventListener('abort', onAbort, { once: true });

  let ticket: Ticket;
  try {
    ticket = await proxy.allow({ host: hostOf(target), port, address, ttlMs: remaining });
  } catch (error) {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    throw codedError('ERR_PROXY', 'the pinning proxy could not open a ticket', error);
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    hop.signal.removeEventListener('abort', finish);
    ticket.close();
  };
  hop.signal.addEventListener('abort', finish, { once: true });

  /** The one error vocabulary of a failed hop: see the module comment and CONNECT_FAILURE_CODES. */
  const failure = (error: unknown): Error => {
    if (now() >= deadline) return codedError(TIMEOUT_CODE, 'the deadline has passed', error);
    if (signal.aborted) return codedError(ABORT_CODE, 'aborted', error);
    // The proxy knows whether the address was ever reached; the engine's words do not.
    if (ticket.state === 'failed' && ticket.failure !== undefined) {
      return codedError(ticket.failure, `could not connect to ${address}:${port}`, error);
    }
    if (ticket.state === 'refused') {
      return codedError('ERR_PROXY_REFUSED', 'the client asked for another destination', error);
    }
    const code = codeOf(error) ?? 'ERR_TRANSPORT';
    // A connect-failure code is the proxy's to give: only it knows that nothing was sent.
    return codedError(CONNECT_FAILURE_CODES.has(code) ? 'ERR_TRANSPORT' : code, code, error);
  };

  const pending = engine.fetch({
    url: target.href,
    proxyUrl: ticket.proxyUrl,
    headers,
    signal: hop.signal,
    timeoutMs: remaining,
  });
  let response: EngineResponse;
  try {
    response = await untilAborted(pending, hop.signal);
  } catch (error) {
    // A response that arrives after we gave up is released unread.
    pending.then(
      (late) => late.cancel(),
      () => {},
    );
    const err = failure(error);
    finish();
    throw err;
  }

  const body =
    response.body === null ? null : deadlineBody(response.body, hop.signal, failure, finish);
  if (body === null) finish();
  return {
    status: response.status,
    headers: response.headers,
    location: first(response.headers, 'location'),
    contentLength: first(response.headers, 'content-length') ?? null,
    body,
    discard: () => {
      response.cancel();
      finish();
    },
  };
}

/** The body, read no further than the hop's signal, with its failures in the hop's vocabulary. */
async function* deadlineBody(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  failure: (error: unknown) => Error,
  finish: () => void,
): AsyncGenerator<Uint8Array, void, undefined> {
  const iterator = body[Symbol.asyncIterator]();
  let done = false;
  try {
    for (;;) {
      let next: IteratorResult<Uint8Array>;
      try {
        next = await untilAborted(iterator.next(), signal);
      } catch (error) {
        throw failure(error);
      }
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
    }
  } finally {
    finish();
    // Not awaited: a stream's `return` waits for a pending read, which may never end.
    if (!done) iterator.return?.()?.catch(() => {});
  }
}
