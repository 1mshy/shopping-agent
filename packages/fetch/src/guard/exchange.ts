// The guarded exchange (S§5.1): "connection pinned to the validated IP; every redirect
// re-checked". One GET, redirects followed by hand, each hop through the guard before it is
// requested.
//
// The seam. The guard never touches the network itself: the caller hands it a `GuardedNet`, a
// resolver and a pinned transport. Per hop the guard resolves the host once (`lookup`), judges
// every address answered, and then asks the transport to reach exactly one vetted address
// (`exchange(address, port, url)`), trying the next vetted address only when the connection could
// not be made. The transport must:
//   - connect to `address`:`port` and nothing else: never resolve `url`'s host, never use a proxy
//     that resolves it, never open a second connection elsewhere;
//   - take the Host header, the TLS server name and the certificate check from `url`;
//   - send one request and never follow a redirect: a 3xx comes back as it is, with its Location;
//   - reject with an Error whose `code` names the failure, and use one of
//     `CONNECT_FAILURE_CODES` only when no byte of the request reached the address.
import type { Rung } from '@agentic-dasher/shared';
import {
  type DnsAnswer,
  decide,
  type GuardDecision,
  isLoopbackName,
  type NetworkError,
  networkError,
  type RefusedByPolicy,
  refusal,
} from './destination.ts';
import { hostNetworks, type OwnNetwork, onOwnNetwork } from './local.ts';
import { parseTarget, resolveLocation, type Target } from './target.ts';

/** The resolver the guard asks: every address of a host name (A and AAAA). */
export interface Resolver {
  /** Rejects for a name that does not resolve, with `code` 'ENOTFOUND' for NXDOMAIN. */
  lookup(host: string): Promise<readonly string[]>;
}

/** What the guard needs to see of one response. */
export interface HopResponse {
  readonly status: number;
  /** The Location header as the server sent it (absolute or relative), if any. */
  readonly location?: string | undefined;
  /** Releases the response without reading its body; called on a redirect that is followed. */
  readonly discard?: (() => void | Promise<void>) | undefined;
}

/** The low-level transport: one request to one vetted address. See the module comment. */
export interface PinnedTransport<R extends HopResponse = HopResponse> {
  exchange(address: string, port: number, url: string): Promise<R>;
}

export interface GuardedNet<R extends HopResponse = HopResponse>
  extends Resolver,
    PinnedTransport<R> {}

export interface GuardedRequest {
  readonly url: string;
  readonly rung: Rung;
}

export interface GuardedOptions {
  /** Redirects followed at most; one more ends the request (default `DEFAULT_MAX_REDIRECTS`). */
  readonly maxRedirects?: number;
  /**
   * This machine's own networks, read for every hop (default: `hostNetworks`, the interfaces of the
   * machine). An address on one of them is refused as `private_address`, whatever range it is in.
   */
  readonly ownNetworks?: () => readonly OwnNetwork[];
  /** Additional networks selected by the operator at startup; apply them to each hop. */
  readonly deniedNetworks?: readonly OwnNetwork[];
}

export type GuardedResult<R extends HopResponse = HopResponse> =
  /** The last response of the chain, from `finalUrl` (canonical, without fragment). */
  | {
      readonly delivered: true;
      readonly finalUrl: string;
      readonly status: number;
      readonly response: R;
    }
  | { readonly delivered: false; readonly outcome: RefusedByPolicy | NetworkError };

/** Redirects followed before the request ends as `ERR_TOO_MANY_REDIRECTS`. */
export const DEFAULT_MAX_REDIRECTS = 10;

/** The network error code of a chain longer than the hop limit. */
export const TOO_MANY_REDIRECTS = 'ERR_TOO_MANY_REDIRECTS';

/**
 * Codes that mean the connection to an address was never made, so the next vetted address may be
 * tried. Any other failure ends the hop: the request may have reached the server.
 */
export const CONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The statuses whose Location is followed (RFC 9110 §15.4); other 3xx are final responses. */
const FOLLOWED = new Set([301, 302, 303, 307, 308]);

/** The shape `FetchOutcome.network_error.code` accepts. */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

function codeOf(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && CODE.test(code) ? code : fallback;
}

/** True for a host name the resolver must answer; an IP literal or a loopback name needs none. */
function needsLookup(
  target: Target,
): target is Target & { readonly host: { readonly kind: 'name'; readonly name: string } } {
  return target.host.kind === 'name' && !isLoopbackName(target.host.name);
}

async function release(response: HopResponse): Promise<void> {
  try {
    await response.discard?.();
  } catch {
    // Releasing a body we will not read is best effort.
  }
}

/**
 * One GET through the guard, following redirects by hand: each hop passes the form clauses, is
 * resolved once, has every answered address judged, and is dialled only at a vetted address. A
 * refused hop is never requested; its refusal names the clause it failed. Never throws for a
 * network or policy outcome; throws RangeError for an invalid option.
 */
export async function guardedExchange<R extends HopResponse>(
  request: GuardedRequest,
  net: GuardedNet<R>,
  options: GuardedOptions = {},
): Promise<GuardedResult<R>> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError(`maxRedirects must be a non-negative integer, got ${maxRedirects}`);
  }
  const { rung } = request;
  const ownNetworks = options.ownNetworks ?? hostNetworks;
  const stop = (outcome: RefusedByPolicy | NetworkError): GuardedResult<R> => ({
    delivered: false,
    outcome,
  });

  let text = request.url;
  let redirects = 0;
  for (;;) {
    const parsed = parseTarget(text);
    if (!parsed.ok) return stop(refusal(rung, parsed.reason));
    const target = parsed.target;

    // Resolved once for this hop, and the decision is made on that one answer. A literal or a
    // loopback name is decided without a lookup.
    let decision: GuardDecision;
    if (needsLookup(target)) {
      let answer: DnsAnswer;
      try {
        answer = { kind: 'addresses', addresses: await net.lookup(target.host.name) };
      } catch (error) {
        return stop(networkError(rung, codeOf(error, 'EAI_FAIL')));
      }
      decision = decide(target, answer, rung, options.deniedNetworks);
    } else {
      decision = decide(target, null, rung, options.deniedNetworks);
    }
    if (!decision.pass) return stop(decision.outcome);
    // The machine itself and its link, at whatever address: a global IPv6 address of this host or
    // of a device beside it is no more a shop than 192.168.0.1 is (local.ts). Like the table, one
    // such address among the answers refuses the name.
    let own: readonly OwnNetwork[];
    try {
      own = ownNetworks();
    } catch {
      // The interfaces could not be read: what is own is not known, so nothing is reached. An
      // outcome, like every other refusal; this function does not throw.
      return stop(refusal(rung, 'private_address'));
    }
    if (decision.connectTo.some((address) => onOwnNetwork(address, own))) {
      return stop(refusal(rung, 'private_address'));
    }

    let response: R | undefined;
    let lastCode = 'ERR_TRANSPORT';
    for (const address of decision.connectTo) {
      try {
        response = await net.exchange(address, target.port, target.href);
        break;
      } catch (error) {
        lastCode = codeOf(error, 'ERR_TRANSPORT');
        if (!CONNECT_FAILURE_CODES.has(lastCode)) break;
      }
    }
    if (response === undefined) return stop(networkError(rung, lastCode));
    if (typeof response !== 'object' || response === null) {
      return stop(networkError(rung, 'ERR_TRANSPORT'));
    }

    const location = response.location;
    if (!FOLLOWED.has(response.status) || typeof location !== 'string' || location === '') {
      return { delivered: true, finalUrl: target.href, status: response.status, response };
    }
    // From here on the redirect's own body is never read.
    await release(response);
    // The next hop is judged before anything else is done with it: the form clauses, and the
    // address when it needs no lookup. A name is resolved and judged at the top of the loop.
    const next = resolveLocation(location, target);
    if (!next.ok) return stop(refusal(rung, next.reason));
    if (!needsLookup(next.target)) {
      const known = decide(next.target, null, rung, options.deniedNetworks);
      if (!known.pass) return stop(known.outcome);
    }
    if (redirects >= maxRedirects) return stop(networkError(rung, TOO_MANY_REDIRECTS));
    redirects++;
    text = next.target.href;
  }
}
