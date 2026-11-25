// The scripted network of the page tests, on the fake clock: each exchange takes `latencyMs` of
// virtual time, and every exchange's start, end and concurrency per host is recorded.
import type { HttpNetwork } from '../../src/transport/index.ts';
import type { FakeClock } from '../pacing/clock.ts';
import { type PageScript, scriptedNetwork } from '../page/net.ts';

export interface Exchange {
  readonly host: string;
  readonly url: string;
  readonly at: number;
}

export function timedNetwork(
  script: PageScript,
  clock: FakeClock,
  options: { latencyMs?: number; failLookups?: number } = {},
) {
  const inner = scriptedNetwork(script);
  const exchanges: Exchange[] = [];
  const lookups: string[] = [];
  const inFlight = new Map<string, number>();
  let maxInFlightPerHost = 0;
  let maxInFlight = 0;
  let current = 0;
  let failLookups = options.failLookups ?? 0;
  const network: HttpNetwork = {
    open(context) {
      const net = inner.network.open(context);
      return {
        async lookup(host) {
          lookups.push(host);
          if (failLookups > 0) {
            failLookups--;
            throw Object.assign(new Error('EAI_AGAIN'), { code: 'EAI_AGAIN' });
          }
          return net.lookup(host);
        },
        async exchange(address, port, url) {
          const host = new URL(url).hostname;
          exchanges.push({ host, url, at: clock.now() });
          const n = (inFlight.get(host) ?? 0) + 1;
          inFlight.set(host, n);
          current++;
          maxInFlightPerHost = Math.max(maxInFlightPerHost, n);
          maxInFlight = Math.max(maxInFlight, current);
          try {
            await clock.sleep(options.latencyMs ?? 0, new AbortController().signal);
            return await net.exchange(address, port, url);
          } finally {
            inFlight.set(host, (inFlight.get(host) ?? 1) - 1);
            current--;
          }
        },
      };
    },
  };
  return {
    network,
    exchanges,
    lookups,
    get maxInFlightPerHost() {
      return maxInFlightPerHost;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}
