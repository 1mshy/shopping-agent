// The guard's decision on one URL and what the resolver answered for its host (S§5.1 "Guard
// first"). Pure: the resolver's answer is an input. The transport (exchange.ts) asks the resolver
// once and hands the answer here, so the addresses judged are the addresses dialled.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';
import { judgeAddress } from './address.ts';
import { parseTarget, type Target } from './target.ts';

/** What the resolver answered for one host name. */
export type DnsAnswer =
  | { readonly kind: 'addresses'; readonly addresses: readonly string[] }
  /** The name does not resolve (NXDOMAIN, or no answer at all). */
  | { readonly kind: 'nxdomain' };

export type RefusedByPolicy = Extract<FetchOutcome, { kind: 'refused_by_policy' }>;
export type NetworkError = Extract<FetchOutcome, { kind: 'network_error' }>;
export type RefusalReason = RefusedByPolicy['reason'];

export interface GuardInput {
  readonly url: string;
  /** The rung about to fetch; a refusal names it. */
  readonly rung: Rung;
  /** The resolver's answer for the URL's host; null when none was asked for. */
  readonly answer: DnsAnswer | null;
}

export type GuardDecision =
  /** May be fetched, and only from these addresses, in this order (the connection is pinned). */
  | { readonly pass: true; readonly connectTo: readonly string[] }
  | { readonly pass: false; readonly outcome: RefusedByPolicy }
  /** The host does not resolve: a network error, never a refusal (S§2.12). */
  | { readonly pass: false; readonly outcome: NetworkError };

export function refusal(rung: Rung, reason: RefusalReason): RefusedByPolicy {
  return { kind: 'refused_by_policy', rung, reason };
}

export function networkError(rung: Rung, code: string): NetworkError {
  return { kind: 'network_error', rung, code };
}

/**
 * RFC 6761: "localhost" and every name under it are loopback, whatever a resolver says, so they
 * are refused without asking one.
 */
export function isLoopbackName(name: string): boolean {
  const bare = name.replace(/\.+$/, '');
  return bare === 'localhost' || bare.endsWith('.localhost');
}

/** IPv4 first, then IPv6, each in the resolver's order, without repeats. */
function order(addresses: readonly string[]): string[] {
  const unique = [...new Set(addresses)];
  return [...unique.filter((a) => !a.includes(':')), ...unique.filter((a) => a.includes(':'))];
}

/**
 * The decision for a target that passed the form clauses. An IP literal is judged alone and the
 * answer is not consulted. A name passes only when the resolver answered at least one address and
 * every address it answered may be reached: one refused address refuses the name outright, since
 * a mixed answer is how a rebinding name looks.
 */
export function decide(target: Target, answer: DnsAnswer | null, rung: Rung): GuardDecision {
  const refused = (): GuardDecision => ({
    pass: false,
    outcome: refusal(rung, 'private_address'),
  });
  if (target.host.kind === 'address') {
    const verdict = judgeAddress(target.host.address);
    return verdict.allowed ? { pass: true, connectTo: [verdict.address] } : refused();
  }
  if (isLoopbackName(target.host.name)) return refused();
  // No answer for a name: the address cannot be placed, so it cannot pass.
  if (answer === null || typeof answer !== 'object') return refused();
  if (answer.kind === 'nxdomain') {
    return { pass: false, outcome: networkError(rung, 'ENOTFOUND') };
  }
  if (answer.kind !== 'addresses' || !Array.isArray(answer.addresses)) return refused();
  // An empty answer is "no answer at all": the name does not resolve.
  if (answer.addresses.length === 0) {
    return { pass: false, outcome: networkError(rung, 'ENOTFOUND') };
  }
  const connectTo: string[] = [];
  for (const address of answer.addresses) {
    const verdict = judgeAddress(address);
    if (!verdict.allowed) return refused();
    connectTo.push(verdict.address);
  }
  return { pass: true, connectTo: order(connectTo) };
}

/** The guard's decision on one URL and its resolver answer (S§5.1). */
export function checkDestination(input: GuardInput): GuardDecision {
  const parsed = parseTarget(input.url);
  if (!parsed.ok) return { pass: false, outcome: refusal(input.rung, parsed.reason) };
  return decide(parsed.target, input.answer, input.rung);
}
