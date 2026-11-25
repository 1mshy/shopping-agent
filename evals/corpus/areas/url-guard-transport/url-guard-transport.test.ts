import { isIP } from 'node:net';
import { guardedExchange } from '@agentic-dasher/fetch';
import { FetchOutcome, RUNGS } from '@agentic-dasher/shared';
import { describe, expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type {
  Exchange,
  GuardedGet,
  NetworkScript,
  ScriptedNet,
  TransportExpectation,
} from './contract.ts';

/**
 * The guarded transport of packages/fetch (S§5.1). It also hands back the final response object;
 * the contract's result is the delivery, the final URL and the status.
 */
const guardedGet: GuardedGet = async (request, net) => {
  const result = await guardedExchange(request, net);
  return result.delivered
    ? { delivered: true, finalUrl: result.finalUrl, status: result.status }
    : result;
};

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A network that answers from the script and records every call made to it. */
function scriptedNet(script: NetworkScript) {
  const lookups: string[] = [];
  const exchanges: Exchange[] = [];
  const asked = new Map<string, number>();
  const net: ScriptedNet = {
    async lookup(host) {
      lookups.push(host);
      const answers = script.dns[host] ?? [];
      const n = asked.get(host) ?? 0;
      asked.set(host, n + 1);
      const answer = answers[Math.min(n, answers.length - 1)];
      if (answer === undefined || answer.kind === 'nxdomain') {
        throw failure('ENOTFOUND', `getaddrinfo ENOTFOUND ${host}`);
      }
      return answer.addresses;
    },
    async exchange(address, port, url) {
      exchanges.push({ address, port, url });
      if (script.unreachable.includes(address)) {
        throw failure('ECONNREFUSED', `connect ECONNREFUSED ${address}:${port}`);
      }
      const response = script.responses[url];
      if (response === undefined) throw new Error(`the script has no response for ${url}`);
      return response;
    },
  };
  return { net, lookups, exchanges };
}

corpusTests(
  area,
  async (c): Promise<TransportExpectation> => {
    const { net, lookups, exchanges } = scriptedNet(c.input.network);
    const result = await guardedGet(c.input.request, net);
    return { result, lookups, exchanges };
  },
  (c, actual) => {
    if (!actual.result.delivered) {
      expect(FetchOutcome.parse(actual.result.outcome)).toEqual(actual.result.outcome);
    }
    expect(actual).toEqual(c.expected);
  },
);

describe('url-guard-transport case data', () => {
  test.each(area.cases.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    const { request, network } = c.input;
    const { result, exchanges } = c.expected;
    expect(RUNGS).toContain(request.rung);
    expect(() => new URL(request.url)).not.toThrow();
    for (const [url, response] of Object.entries(network.responses)) {
      expect(() => new URL(url)).not.toThrow();
      const isRedirect = response.status >= 300 && response.status < 400;
      expect(response.location !== undefined).toBe(isRedirect);
    }
    for (const answers of Object.values(network.dns)) {
      for (const a of answers) {
        if (a.kind === 'addresses') for (const ip of a.addresses) expect(isIP(ip)).not.toBe(0);
      }
    }
    for (const e of exchanges) {
      expect(isIP(e.address)).not.toBe(0);
      expect(network.responses[e.url]).toBeDefined();
    }
    if (result.delivered) {
      expect(network.responses[result.finalUrl]?.status).toBe(result.status);
    } else {
      expect(FetchOutcome.safeParse(result.outcome).success).toBe(true);
      expect(result.outcome.rung).toBe(request.rung);
    }
    expect(c.established.length).toBeGreaterThan(0);
    if (c.divergence !== undefined) expect(c.established).toContain('spec');
  });
});
