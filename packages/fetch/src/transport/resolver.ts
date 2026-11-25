// The guard's resolver on `node:dns`: every A and every AAAA record of a name, asked in parallel
// of the configured DNS servers (c-ares, so no thread-pool slot is held by a slow lookup). The
// guard judges every address returned and the transport dials only those.
import { Resolver as DnsResolver } from 'node:dns/promises';
import type { Resolver } from '../guard/index.ts';

/** The two queries the resolver makes; `node:dns` by default, a stub in tests. */
export interface DnsQueries {
  resolve4(host: string): Promise<readonly string[]>;
  resolve6(host: string): Promise<readonly string[]>;
}

/** Per-query timeout and tries, so a server that drops AAAA queries costs seconds, not minutes. */
export const DNS_TIMEOUT_MS = 2_500;
export const DNS_TRIES = 2;

/** Codes that mean "no record of this type", not a failure of the lookup. */
const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND']);

function codeOf(reason: unknown): string {
  const code = (reason as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : 'EAI_FAIL';
}

function systemQueries(): DnsQueries {
  const resolver = new DnsResolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
  return {
    resolve4: (host) => resolver.resolve4(host),
    resolve6: (host) => resolver.resolve6(host),
  };
}

/**
 * Every A and AAAA address of `host`. Rejects with `code` 'ENOTFOUND' when the name does not
 * exist; resolves to an empty list when it exists with no address; rejects with the DNS error's
 * code when neither query was answered. One failed family with an answered other gives the
 * answered addresses: only those are judged and dialled.
 */
export function dnsResolver(queries: DnsQueries = systemQueries()): Resolver {
  return {
    async lookup(host) {
      const [v4, v6] = await Promise.allSettled([queries.resolve4(host), queries.resolve6(host)]);
      const addresses: string[] = [];
      const failures: string[] = [];
      for (const result of [v4, v6]) {
        if (result.status === 'fulfilled') addresses.push(...result.value);
        else failures.push(codeOf(result.reason));
      }
      if (addresses.length > 0) return addresses;
      if (failures.includes('ENOTFOUND')) {
        throw Object.assign(new Error(`${host} does not resolve`), { code: 'ENOTFOUND' });
      }
      const failure = failures.find((code) => !NO_RECORDS.has(code));
      if (failure !== undefined) {
        throw Object.assign(new Error(`DNS lookup of ${host} failed: ${failure}`), {
          code: failure,
        });
      }
      return [];
    },
  };
}
