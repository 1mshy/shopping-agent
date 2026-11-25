// A scripted HttpNetwork for the rung tests: answers from data and records every lookup, every
// exchange and the headers each hop was given. No real DNS lookup and no real connection.
import type { ExchangeContext, HeaderList, HttpNetwork } from '../../src/transport/index.ts';
import type { TransportResponse } from '../../src/transport/types.ts';

export interface PageReply {
  readonly status: number;
  readonly headers?: HeaderList;
  /** The body's chunks; an Error is thrown in place of the chunk where it stands. */
  readonly body?: readonly (string | Uint8Array | Error | (() => Error))[] | null;
}

export interface PageScript {
  /** Answers per host name; an Error is the lookup's failure. */
  readonly dns: Readonly<Record<string, readonly string[] | Error>>;
  /** Replies per absolute URL. */
  readonly replies: Readonly<Record<string, PageReply>>;
  /** Connection failures per address. */
  readonly failing?: Readonly<Record<string, Error>>;
}

export interface Hop {
  readonly address: string;
  readonly port: number;
  readonly url: string;
  readonly headers: HeaderList;
}

export function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function* chunks(body: NonNullable<PageReply['body']>): AsyncGenerator<Uint8Array> {
  for (const chunk of body) {
    if (chunk instanceof Error) throw chunk;
    if (typeof chunk === 'function') throw chunk();
    yield typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
  }
}

export function scriptedNetwork(script: PageScript) {
  const lookups: string[] = [];
  const hops: Hop[] = [];
  const contexts: ExchangeContext[] = [];
  const network: HttpNetwork = {
    open(context) {
      contexts.push(context);
      return {
        async lookup(host) {
          lookups.push(host);
          const answer = script.dns[host];
          if (answer === undefined) throw coded('ENOTFOUND');
          if (answer instanceof Error) throw answer;
          return answer;
        },
        async exchange(address, port, url): Promise<TransportResponse> {
          hops.push({ address, port, url, headers: context.headersFor(url) });
          const failed = script.failing?.[address];
          if (failed !== undefined) throw failed;
          const reply = script.replies[url];
          if (reply === undefined) throw new Error(`the script has no reply for ${url}`);
          const headers = reply.headers ?? [];
          return {
            status: reply.status,
            headers,
            location: headers.find(([name]) => name === 'location')?.[1],
            contentLength: headers.find(([name]) => name === 'content-length')?.[1] ?? null,
            body: reply.body === null ? null : chunks(reply.body ?? []),
          };
        },
      };
    },
  };
  return { network, lookups, hops, contexts };
}
