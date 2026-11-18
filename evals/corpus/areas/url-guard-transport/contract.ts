// The guarded transport's contract (S§5.1 "Guard first": "connection pinned to the validated IP;
// every redirect re-checked"). Types only.
//
// These rules are about what the transport does on the wire, so each case scripts the network as
// data: the resolver's answers per host name (successive answers model DNS rebinding) and what the
// server answers per URL. The test turns the script into a `ScriptedNet`, hands it to the subject,
// and records every lookup and every exchange the subject makes. A case asserts the result and
// those two records: a refused hop must never be dialled, and a name must be resolved once per hop.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';
import type { DnsAnswer } from '../url-guard-address/contract.ts';

export type { DnsAnswer };

/** What a server answers to one GET: a redirect (3xx with Location) or a final response. */
export interface ScriptedResponse {
  readonly status: number;
  /** For a 3xx: the Location header, absolute or relative, as the server sent it. */
  readonly location?: string;
  readonly bodyBytes: number;
}

/** The network as a case scripts it. */
export interface NetworkScript {
  /**
   * Answers per host name, in order: the first lookup of a name gets the first answer, the second
   * lookup the second, and the last answer repeats. A name not listed is NXDOMAIN.
   */
  readonly dns: Readonly<Record<string, readonly DnsAnswer[]>>;
  /** What the server answers, keyed by the absolute URL requested. */
  readonly responses: Readonly<Record<string, ScriptedResponse>>;
  /** Addresses that refuse the connection (ECONNREFUSED). */
  readonly unreachable: readonly string[];
}

/** The network the subject is given. The test builds it from a `NetworkScript` and records calls. */
export interface ScriptedNet {
  /** Resolves a host name. Rejects with an Error whose `code` is 'ENOTFOUND' for NXDOMAIN. */
  lookup(host: string): Promise<readonly string[]>;
  /**
   * Connects to `address`:`port` and sends one GET for `url` (Host header and TLS name from the
   * URL). Rejects with an Error whose `code` is 'ECONNREFUSED' for an unreachable address.
   */
  exchange(address: string, port: number, url: string): Promise<ScriptedResponse>;
}

export interface GuardedRequest {
  readonly url: string;
  readonly rung: Rung;
}

export type GuardedResult =
  /** The last response of the chain, with the URL it came from. */
  | { readonly delivered: true; readonly finalUrl: string; readonly status: number }
  | {
      readonly delivered: false;
      readonly outcome: Extract<FetchOutcome, { kind: 'refused_by_policy' | 'network_error' }>;
    };

/** The subject: one GET, following redirects, through the guard. */
export type GuardedGet = (request: GuardedRequest, net: ScriptedNet) => Promise<GuardedResult>;

export interface Exchange {
  readonly address: string;
  readonly port: number;
  readonly url: string;
}

export interface TransportExpectation {
  readonly result: GuardedResult;
  /** Every `lookup` call, in order. */
  readonly lookups: readonly string[];
  /** Every `exchange` call, in order, including one that failed to connect. */
  readonly exchanges: readonly Exchange[];
}

export type Established = 'test' | 'read' | 'ran' | 'spec';

export interface TransportCase {
  readonly id: string;
  readonly what: string;
  readonly input: { readonly request: GuardedRequest; readonly network: NetworkScript };
  readonly expected: TransportExpectation;
  readonly from: string;
  readonly established: readonly Established[];
  readonly divergence?: string;
  readonly specSilent?: true;
  readonly note?: string;
}
