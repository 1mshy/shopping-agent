// The guard's decision on one URL and its resolved addresses (S§5.1 "Guard first", S§5.15). Types
// only.
//
// "Every URL, from any source, passes guard() before any transport: http/https only; DNS resolved
// and private, loopback, link-local, CGNAT and metadata ranges refused." This area is the pure part:
// given the URL and what the resolver answered for its host, pass (with the addresses a connection
// may use) or refuse. Pinning the connection and re-checking redirects need a scripted network and
// live in the url-guard-transport area.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';

/** What the resolver answers for one host name. */
export type DnsAnswer =
  | { readonly kind: 'addresses'; readonly addresses: readonly string[] }
  /** The name does not resolve (NXDOMAIN, or no answer at all). */
  | { readonly kind: 'nxdomain' };

export interface GuardInput {
  readonly url: string;
  /** The rung about to fetch; a refusal names it. */
  readonly rung: Rung;
  /**
   * The resolver's answer for the URL's host, when the guard asks. null: the guard must not need
   * one (the URL is refused before any lookup, or its host is an IP literal).
   */
  readonly answer: DnsAnswer | null;
}

export type RefusedByPolicy = Extract<FetchOutcome, { kind: 'refused_by_policy' }>;
export type NetworkError = Extract<FetchOutcome, { kind: 'network_error' }>;

export type GuardDecision =
  /** The URL may be fetched, and only from these addresses, in this order (S§5.1 pinning). */
  | { readonly pass: true; readonly connectTo: readonly string[] }
  /** A guard clause refused it (S§5.1 refusal reasons). */
  | { readonly pass: false; readonly outcome: RefusedByPolicy }
  /**
   * The host does not resolve: a network error (code `ENOTFOUND`), never a refusal, so a DNS gap
   * after the host wakes (S§2.12) does not read as a policy decision or a wall.
   */
  | { readonly pass: false; readonly outcome: NetworkError };

/** The subject. Pure: the case supplies the resolver's answer. */
export type CheckDestination = (input: GuardInput) => GuardDecision;

/** How a case's expected value was established. */
export type Established = 'test' | 'read' | 'ran' | 'spec';

export interface GuardCase {
  readonly id: string;
  readonly what: string;
  readonly input: GuardInput;
  readonly expected: GuardDecision;
  /** Predecessor file and test or line, or the spec section. */
  readonly from: string;
  readonly established: readonly Established[];
  readonly divergence?: string;
  readonly specSilent?: true;
  /** Contract gap: the shared vocabulary has no value for this; the closest one is used. */
  readonly gap?: string;
  readonly note?: string;
}
