// The URL guard (S§5.1 "Guard first", S§5.15): form clauses, the address decision, DNS pinning,
// per-hop redirect checks and the body size cap.
export { type AddressVerdict, judgeAddress } from './address.ts';
export {
  type BodyResponse,
  type CappedRead,
  type GuardedFetchOptions,
  type GuardedFetchResult,
  guardedFetch,
  readCapped,
} from './body.ts';
export {
  checkDestination,
  type DnsAnswer,
  decide,
  type GuardDecision,
  type GuardInput,
  isLoopbackName,
  type NetworkError,
  type RefusalReason,
  type RefusedByPolicy,
} from './destination.ts';
export {
  CONNECT_FAILURE_CODES,
  DEFAULT_MAX_REDIRECTS,
  type GuardedNet,
  type GuardedOptions,
  type GuardedRequest,
  type GuardedResult,
  guardedExchange,
  type HopResponse,
  type PinnedTransport,
  type Resolver,
  TOO_MANY_REDIRECTS,
} from './exchange.ts';
export {
  type FormReason,
  parseTarget,
  resolveLocation,
  type Target,
  type TargetHost,
  type TargetParse,
} from './target.ts';
