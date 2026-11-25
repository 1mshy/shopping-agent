// The HTTP rung's session drop (S§5.1 Sessions): a wall clears the cookies of the site that
// answered it, which after a redirect is not the site that was asked for. From the fetch review's
// finding 5: the drop read the request's URL only, so the wall's own cookies stayed.
import { CookieJars, type Fetcher, type FetcherResult } from '@agentic-dasher/fetch';
import { describe, expect, it } from 'vitest';
import { fetcherWithSessionDrop } from '../../src/runtime.ts';

const NOW = Date.UTC(2026, 10, 25);

function answering(
  outcome: FetcherResult['outcome'],
  finalUrl: string | null,
  status = 403,
): Fetcher {
  return {
    get: async () => ({
      outcome,
      response:
        finalUrl === null
          ? null
          : {
              status,
              finalUrl,
              headers: {},
              setCookies: [],
              contentType: null,
              body: new Uint8Array(),
              text: '',
            },
      robots: null,
      closedUntil: null,
    }),
  };
}

function jarsWith(...hosts: string[]): CookieJars {
  const jars = new CookieJars();
  for (const host of hosts) jars.jar(host).store(['session=1; Path=/'], `https://${host}/`, NOW);
  return jars;
}

function request(url: string) {
  return {
    url,
    rung: 'http' as const,
    pageKind: 'product' as const,
    deadline: NOW + 10_000,
    signal: new AbortController().signal,
  };
}

const WALL = { kind: 'wall', rung: 'http', vendor: null, mode: 'challenge' } as const;

describe('fetcherWithSessionDrop', () => {
  it('clears the host that answered the wall after a redirect, and the site that was asked', async () => {
    const jars = jarsWith('shop.example.test', 'geo.blocker.test', 'other.example.org');
    const fetcher = fetcherWithSessionDrop(
      answering(WALL, 'https://geo.blocker.test/denied?ref=1'),
      jars,
    );
    await fetcher.get(request('https://shop.example.test/products/widget'));
    expect(jars.jar('geo.blocker.test').size).toBe(0);
    expect(jars.jar('shop.example.test').size).toBe(0);
    expect(jars.jar('other.example.org').size).toBe(1);
  });

  // From the review of this drop: a page chooses where it redirects, so a wall met on another
  // site must not empty that site's other sessions (a hostile page redirecting to a named shop's
  // URL that its bot manager refuses would otherwise log the fetcher out of that shop each sweep).
  it('a wall on another site clears only the host that answered, not that site', async () => {
    const jars = jarsWith('hostile.example.test', 'www.victim-shop.test', 'victim-shop.test');
    jars
      .jar('m.victim-shop.test')
      .store(['clearance=1; Domain=victim-shop.test; Path=/'], 'https://m.victim-shop.test/', NOW);
    await fetcherWithSessionDrop(
      answering(WALL, 'https://www.victim-shop.test/?q=attack'),
      jars,
    ).get(request('https://hostile.example.test/p'));
    expect(jars.jar('hostile.example.test').size).toBe(0);
    expect(jars.jar('www.victim-shop.test').size).toBe(0);
    // The shop's other hosts and its parent-domain cookies held elsewhere stay.
    expect(jars.jar('victim-shop.test').size).toBe(1);
    expect(jars.jar('m.victim-shop.test').size).toBe(1);
  });

  it('a wall after a redirect inside the asked site clears that site as before', async () => {
    const jars = jarsWith('shop.example.test', 'www.shop.example.test');
    await fetcherWithSessionDrop(
      answering(WALL, 'https://www.shop.example.test/blocked'),
      jars,
    ).get(request('https://shop.example.test/products/widget'));
    expect(jars.jar('shop.example.test').size).toBe(0);
    expect(jars.jar('www.shop.example.test').size).toBe(0);
  });

  it('clears the asked site when the wall came with no redirect, or with no response read', async () => {
    const same = jarsWith('www.shop.example.test', 'other.example.org');
    await fetcherWithSessionDrop(
      answering(WALL, 'https://www.shop.example.test/products/widget'),
      same,
    ).get(request('https://www.shop.example.test/products/widget'));
    expect(same.jar('www.shop.example.test').size).toBe(0);
    expect(same.jar('other.example.org').size).toBe(1);

    const none = jarsWith('shop.example.test');
    await fetcherWithSessionDrop(answering(WALL, null), none).get(
      request('https://shop.example.test/products/widget'),
    );
    expect(none.jar('shop.example.test').size).toBe(0);
  });

  it('clears nothing for an outcome that is not a wall, whatever host answered', async () => {
    const jars = jarsWith('shop.example.test', 'cdn.example.test');
    await fetcherWithSessionDrop(
      answering({ kind: 'server_error', rung: 'http' }, 'https://cdn.example.test/oops', 503),
      jars,
    ).get(request('https://shop.example.test/products/widget'));
    await fetcherWithSessionDrop(
      answering({ kind: 'ok', rung: 'http' }, 'https://cdn.example.test/page', 200),
      jars,
    ).get(request('https://shop.example.test/products/widget'));
    expect(jars.jar('shop.example.test').size).toBe(1);
    expect(jars.jar('cdn.example.test').size).toBe(1);
  });
});
