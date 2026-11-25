// A scripted network for the guard's tests: answers from data and records every lookup and every
// exchange. No real DNS lookup and no real connection is ever made.
import type { GuardedNet, HopResponse } from '../../src/guard/index.ts';

export interface Reply extends HopResponse {
  readonly status: number;
  readonly location?: string;
}

export interface Script {
  /** Answers per host name in order; the last one repeats. An Error is thrown as the lookup's failure. */
  readonly dns: Readonly<Record<string, readonly (readonly string[] | Error)[]>>;
  /** Replies per absolute URL. */
  readonly replies: Readonly<Record<string, Reply>>;
  /** Connection failures per address: the Error the exchange rejects with. */
  readonly failing?: Readonly<Record<string, Error>>;
}

export interface Dialled {
  readonly address: string;
  readonly port: number;
  readonly url: string;
}

export function failure(code: string | undefined, message = code ?? 'failure'): Error {
  return code === undefined ? new Error(message) : Object.assign(new Error(message), { code });
}

export function scripted(script: Script) {
  const lookups: string[] = [];
  const exchanges: Dialled[] = [];
  const discarded: string[] = [];
  const asked = new Map<string, number>();
  const net: GuardedNet<Reply> = {
    async lookup(host) {
      lookups.push(host);
      const answers = script.dns[host] ?? [];
      const n = asked.get(host) ?? 0;
      asked.set(host, n + 1);
      const answer = answers[Math.min(n, answers.length - 1)];
      if (answer === undefined) throw failure('ENOTFOUND');
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async exchange(address, port, url) {
      exchanges.push({ address, port, url });
      const failed = script.failing?.[address];
      if (failed !== undefined) throw failed;
      const reply = script.replies[url];
      if (reply === undefined) throw new Error(`the script has no reply for ${url}`);
      return {
        ...reply,
        discard: () => {
          discarded.push(url);
        },
      };
    },
  };
  return { net, lookups, exchanges, discarded };
}
