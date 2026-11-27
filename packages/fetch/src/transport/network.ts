// The real network for guarded requests: the `node:dns` resolver and the pinned transport on the
// `impit` engine and the process's pinning proxy, both bound to one request's deadline and signal.
import type { GuardedNet, Resolver } from '../guard/index.ts';
import { impitEngine } from './impit.ts';
import { codedError, pinnedTransport, untilAborted } from './pinned.ts';
import { dnsResolver } from './resolver.ts';
import { type PinningProxy, sharedPinningProxy } from './socks-proxy.ts';
import {
  ABORT_CODE,
  type ExchangeContext,
  type HttpEngine,
  type HttpNetwork,
  TIMEOUT_CODE,
  type TransportResponse,
} from './types.ts';

export interface HttpNetworkOptions {
  readonly resolver?: Resolver;
  readonly engine?: HttpEngine;
  readonly proxy?: PinningProxy;
  /** The clock deadlines are read on (epoch milliseconds). */
  readonly now?: () => number;
}

/** A lookup that gives up at the request's deadline (a timeout) or when the caller aborts. */
async function boundedLookup(
  resolver: Resolver,
  host: string,
  context: ExchangeContext,
  now: () => number,
): Promise<readonly string[]> {
  const remaining = context.deadline - now();
  if (remaining <= 0) throw codedError(TIMEOUT_CODE, 'the deadline has passed');
  const stop = new AbortController();
  const timer = setTimeout(
    () => stop.abort(codedError(TIMEOUT_CODE, 'the deadline has passed')),
    remaining,
  );
  const onAbort = () => stop.abort();
  context.signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await untilAborted(resolver.lookup(host), stop.signal);
  } catch (error) {
    if (now() >= context.deadline) throw codedError(TIMEOUT_CODE, 'the deadline has passed', error);
    if (context.signal.aborted) throw codedError(ABORT_CODE, 'aborted', error);
    throw error;
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener('abort', onAbort);
  }
}

/** The network guarded requests run on; see `HttpNetwork`. */
export function createHttpNetwork(options: HttpNetworkOptions = {}): HttpNetwork {
  const resolver = options.resolver ?? dnsResolver();
  const engine = options.engine ?? impitEngine();
  const proxy = options.proxy ?? sharedPinningProxy();
  const now = options.now ?? Date.now;
  return {
    open(context): GuardedNet<TransportResponse> {
      const transport = pinnedTransport({ engine, proxy, context, now });
      return {
        lookup: (host) => boundedLookup(resolver, host, context, now),
        exchange: (address, port, url) => transport.exchange(address, port, url),
      };
    },
  };
}
