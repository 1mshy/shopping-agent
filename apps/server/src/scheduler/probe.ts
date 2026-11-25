// The DNS gate's default probe: does a host name resolve? The scheduler injects any other probe
// (tests do); this is the only network access in the scheduler.
import { lookup } from 'node:dns/promises';

/** Resolves true when the name resolved, false when it did not; never rejects. */
export type DnsProbe = (signal: AbortSignal) => Promise<boolean>;

/**
 * A `node:dns` lookup (getaddrinfo, so /etc/hosts and the container's resolver apply). The lookup
 * cannot be cancelled; the scheduler stops waiting for it after its probe timeout.
 */
export function dnsLookupProbe(host: string): DnsProbe {
  return async () => {
    try {
      const answer = await lookup(host, { all: true });
      return answer.length > 0;
    } catch {
      return false;
    }
  };
}
