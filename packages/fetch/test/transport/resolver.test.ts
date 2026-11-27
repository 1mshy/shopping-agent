// The node:dns resolver and the network's deadline-bound lookup, with stubbed queries: no real
// DNS lookup is made.
import { describe, expect, it } from 'vitest';
import { createHttpNetwork } from '../../src/transport/network.ts';
import { type DnsQueries, dnsResolver } from '../../src/transport/resolver.ts';
import { ABORT_CODE, type HttpEngine, TIMEOUT_CODE } from '../../src/transport/types.ts';

const coded = (code: string) => Object.assign(new Error(code), { code });

function queries(v4: readonly string[] | Error, v6: readonly string[] | Error): DnsQueries {
  return {
    resolve4: async () => {
      if (v4 instanceof Error) throw v4;
      return v4;
    },
    resolve6: async () => {
      if (v6 instanceof Error) throw v6;
      return v6;
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('expected a rejection');
}

describe('dnsResolver', () => {
  it('returns every A and AAAA address', async () => {
    const resolver = dnsResolver(queries(['93.184.215.14', '93.184.215.15'], ['2606:2800::1']));
    expect(await resolver.lookup('shop.test')).toEqual([
      '93.184.215.14',
      '93.184.215.15',
      '2606:2800::1',
    ]);
  });

  it('returns one family when the other has no record', async () => {
    const resolver = dnsResolver(queries(['93.184.215.14'], coded('ENODATA')));
    expect(await resolver.lookup('shop.test')).toEqual(['93.184.215.14']);
  });

  it('returns the answered family when the other query failed', async () => {
    const resolver = dnsResolver(queries(coded('ETIMEOUT'), ['2606:2800::1']));
    expect(await resolver.lookup('shop.test')).toEqual(['2606:2800::1']);
  });

  it('rejects a name that does not exist with ENOTFOUND', async () => {
    const resolver = dnsResolver(queries(coded('ENOTFOUND'), coded('ENOTFOUND')));
    expect(await failure(resolver.lookup('shop.test'))).toBe('ENOTFOUND');
  });

  it('answers an empty list for a name with no address', async () => {
    const resolver = dnsResolver(queries(coded('ENODATA'), []));
    expect(await resolver.lookup('shop.test')).toEqual([]);
  });

  it('rejects with the DNS error when neither query was answered', async () => {
    const resolver = dnsResolver(queries(coded('ETIMEOUT'), coded('ESERVFAIL')));
    expect(await failure(resolver.lookup('shop.test'))).toBe('ETIMEOUT');
  });
});

describe('the network’s lookup', () => {
  const engine: HttpEngine = {
    fetch: () => Promise.reject(new Error('no request in this test')),
  };
  const hanging = { lookup: () => new Promise<readonly string[]>(() => {}) };

  it('gives up at the deadline, as a timeout', async () => {
    const network = createHttpNetwork({ resolver: hanging, engine });
    const net = network.open({
      deadline: Date.now() + 100,
      signal: new AbortController().signal,
      headersFor: () => [],
    });
    expect(await failure(net.lookup('shop.test'))).toBe(TIMEOUT_CODE);
  });

  it('gives up when the caller aborts', async () => {
    const controller = new AbortController();
    const network = createHttpNetwork({ resolver: hanging, engine });
    const net = network.open({
      deadline: Date.now() + 5_000,
      signal: controller.signal,
      headersFor: () => [],
    });
    setTimeout(() => controller.abort(), 50);
    expect(await failure(net.lookup('shop.test'))).toBe(ABORT_CODE);
  });

  it('classifies an elapsed deadline timer even if the wall clock stepped back', async () => {
    const network = createHttpNetwork({ resolver: hanging, engine, now: () => 1000 });
    const net = network.open({
      deadline: 1005,
      signal: new AbortController().signal,
      headersFor: () => [],
    });
    expect(await failure(net.lookup('shop.test'))).toBe(TIMEOUT_CODE);
  });

  it('passes the resolver’s own failure through', async () => {
    const network = createHttpNetwork({
      resolver: dnsResolver(queries(coded('ENOTFOUND'), coded('ENOTFOUND'))),
      engine,
    });
    const net = network.open({
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal,
      headersFor: () => [],
    });
    expect(await failure(net.lookup('shop.test'))).toBe('ENOTFOUND');
  });
});
