// The HTTP transport (S§5.1, S§3.3): the guard's resolver and pinned transport on `node:dns`, the
// pinning proxy and the `impit` engine, behind a seam free of impit's types.
//
// Only the network is exported, never a bare transport: what `HttpNetwork.open` returns is meant
// for the guard (`guardedFetch`), which is how `fetchPage` uses it.
export { IMPIT_PROFILE } from './impit.ts';
export { createHttpNetwork, type HttpNetworkOptions } from './network.ts';
export { type DnsQueries, dnsResolver } from './resolver.ts';
export {
  ABORT_CODE,
  type EngineRequest,
  type EngineResponse,
  type ExchangeContext,
  type HeaderList,
  type HttpEngine,
  type HttpNetwork,
  TIMEOUT_CODE,
  type TransportResponse,
} from './types.ts';
