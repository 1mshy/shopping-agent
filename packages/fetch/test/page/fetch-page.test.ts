// The api and http rungs composed with the real guard, on a scripted network.
import { FetchOutcome } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { CookieJars } from '../../src/cookies/index.ts';
import {
  API_ACCEPT,
  type Classify,
  type ClassifyInput,
  fetchPage,
  type PageFetcherDeps,
  type PageRequest,
} from '../../src/page/index.ts';
import { ABORT_CODE, TIMEOUT_CODE } from '../../src/transport/index.ts';
import { coded, type PageReply, type PageScript, scriptedNetwork } from './net.ts';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const PUBLIC = '93.184.215.14';
const PUBLIC_2 = '93.184.215.15';

function setup(
  script: Partial<PageScript> & { replies: PageScript['replies'] },
  extra: Partial<PageFetcherDeps> = {},
) {
  const net = scriptedNetwork({ dns: { 'shop.test': [PUBLIC] }, ...script });
  const jars = extra.jars ?? new CookieJars();
  let clock = NOW;
  const deps: PageFetcherDeps = { network: net.network, jars, now: () => clock, ...extra };
  return {
    ...net,
    jars,
    deps,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function page(
  url: string,
  extra: Partial<Omit<PageRequest, 'rung'>> & { referer?: string } = {},
): PageRequest {
  return {
    rung: 'http',
    url,
    deadline: NOW + 10_000,
    signal: new AbortController().signal,
    ...extra,
  };
}

function api(url: string): PageRequest {
  return { rung: 'api', url, deadline: NOW + 10_000, signal: new AbortController().signal };
}

const reply = (
  status: number,
  headers: PageReply['headers'] = [],
  body: string[] = [],
): PageReply => ({
  status,
  headers,
  body,
});

describe('fetchPage', () => {
  it('reads a page: ok, with what the readers need, naming the rung', async () => {
    const s = setup({
      replies: {
        'https://shop.test/p/1': reply(
          200,
          [
            ['content-type', 'text/html; charset=iso-8859-1'],
            ['x-a', '1'],
            ['x-a', '2'],
          ],
          ['<p>', 'hello</p>'],
        ),
      },
    });
    const latin1 = setup({
      replies: {
        'https://shop.test/p/1': {
          status: 200,
          headers: [['content-type', 'text/html; charset=iso-8859-1']],
          body: [new Uint8Array([0x63, 0x61, 0x66, 0xe9])],
        },
      },
    });
    const result = await fetchPage(page('https://shop.test/p/1'), s.deps);
    expect(result.outcome).toEqual({ kind: 'ok', rung: 'http' });
    expect(result.response?.status).toBe(200);
    expect(result.response?.finalUrl).toBe('https://shop.test/p/1');
    expect(result.response?.contentType).toBe('text/html; charset=iso-8859-1');
    expect(result.response?.headers['x-a']).toBe('1, 2');
    const decoded = await fetchPage(page('https://shop.test/p/1'), latin1.deps);
    expect(decoded.response?.text).toBe('café');
    expect(decoded.response?.body).toEqual(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
  });

  it('asks the api rung for JSON and adds nothing else', async () => {
    const s = setup({ replies: { 'https://shop.test/products/x.js': reply(200, [], ['{}']) } });
    const result = await fetchPage(api('https://shop.test/products/x.js'), s.deps);
    expect(result.outcome).toEqual({ kind: 'ok', rung: 'api' });
    expect(s.hops[0]?.headers).toEqual([['accept', API_ACCEPT]]);
  });

  it('adds nothing to a plain page read', async () => {
    const s = setup({ replies: { 'https://shop.test/': reply(200) } });
    await fetchPage(page('https://shop.test/'), s.deps);
    expect(s.hops[0]?.headers).toEqual([]);
  });

  it('sends a same-site Referer, and drops it on a hop to another site', async () => {
    const s = setup({
      dns: { 'shop.test': [PUBLIC], 'other.test': [PUBLIC_2] },
      replies: {
        'https://shop.test/p/1': reply(302, [['location', 'https://other.test/p/1']]),
        'https://other.test/p/1': reply(200),
      },
    });
    await fetchPage(
      page('https://shop.test/p/1', { referer: 'https://shop.test/c/shoes' }),
      s.deps,
    );
    expect(s.hops[0]?.headers).toEqual([
      ['referer', 'https://shop.test/c/shoes'],
      ['sec-fetch-site', 'same-origin'],
    ]);
    expect(s.hops[1]?.headers).toEqual([]);
  });

  describe('maps the status', () => {
    const cases: [number, FetchOutcome['kind']][] = [
      [200, 'ok'],
      [204, 'ok'],
      [404, 'not_found'],
      [410, 'not_found'],
      [401, 'login_required'],
      [402, 'payment_required'],
      [500, 'server_error'],
      [503, 'server_error'],
    ];
    for (const [status, kind] of cases) {
      it(`${status} is ${kind}`, async () => {
        const s = setup({ replies: { 'https://shop.test/': reply(status) } });
        const result = await fetchPage(page('https://shop.test/'), s.deps);
        expect(result.outcome).toEqual({ kind, rung: 'http' });
        expect(result.response?.status).toBe(status);
      });
    }

    it('a bare 403 is a wall of unknown vendor, mode challenge', async () => {
      const s = setup({ replies: { 'https://shop.test/': reply(403) } });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({
        kind: 'wall',
        rung: 'http',
        vendor: null,
        mode: 'challenge',
      });
    });

    it('429 carries the Retry-After delay in seconds form', async () => {
      const s = setup({ replies: { 'https://shop.test/': reply(429, [['retry-after', '30']]) } });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({ kind: 'rate_limited', rung: 'http', retryAfterMs: 30_000 });
    });

    it('429 carries the Retry-After delay in date form, on the injected clock', async () => {
      const s = setup({
        replies: {
          'https://shop.test/': reply(429, [['retry-after', 'Tue, 24 Nov 2026 12:02:00 GMT']]),
        },
      });
      s.advance(60_000);
      const result = await fetchPage(
        page('https://shop.test/', { deadline: NOW + 120_000 }),
        s.deps,
      );
      expect(result.outcome).toEqual({ kind: 'rate_limited', rung: 'http', retryAfterMs: 60_000 });
    });

    it('429 without a usable Retry-After has a null delay', async () => {
      const s = setup({
        replies: { 'https://shop.test/': reply(429, [['retry-after', 'later']]) },
      });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({ kind: 'rate_limited', rung: 'http', retryAfterMs: null });
    });

    it('a status with no kind of its own is a network error named after it', async () => {
      const s = setup({
        replies: {
          'https://shop.test/a': reply(400),
          'https://shop.test/b': reply(304),
        },
      });
      expect((await fetchPage(page('https://shop.test/a'), s.deps)).outcome).toEqual({
        kind: 'network_error',
        rung: 'http',
        code: 'HTTP_400',
      });
      expect((await fetchPage(page('https://shop.test/b'), s.deps)).outcome).toEqual({
        kind: 'network_error',
        rung: 'http',
        code: 'HTTP_304',
      });
    });

    it('every outcome is a valid FetchOutcome', async () => {
      for (const status of [200, 401, 403, 404, 429, 418, 500]) {
        const s = setup({ replies: { 'https://shop.test/': reply(status) } });
        const result = await fetchPage(api('https://shop.test/'), s.deps);
        expect(FetchOutcome.safeParse(result.outcome).success).toBe(true);
      }
    });
  });

  describe('the classify hook', () => {
    it('sees the response before the status is mapped, and decides', async () => {
      const inputs: ClassifyInput[] = [];
      const classify: Classify = (input) => {
        inputs.push(input);
        return input.finalUrl.includes('/splashui/')
          ? { kind: 'wall', vendor: 'ebay', mode: 'challenge' }
          : null;
      };
      const s = setup(
        {
          replies: {
            'https://shop.test/itm/1': reply(302, [['location', '/splashui/challenge']]),
            'https://shop.test/splashui/challenge': reply(
              200,
              [['content-type', 'text/html']],
              ['<title>x</title>'],
            ),
          },
        },
        { classify },
      );
      const result = await fetchPage(page('https://shop.test/itm/1'), s.deps);
      expect(result.outcome).toEqual({
        kind: 'wall',
        rung: 'http',
        vendor: 'ebay',
        mode: 'challenge',
      });
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        rung: 'http',
        status: 200,
        finalUrl: 'https://shop.test/splashui/challenge',
        contentType: 'text/html',
        text: '<title>x</title>',
      });
    });

    it('can overrule the status (a 404 page that is a wall, a 200 that is empty)', async () => {
      const s = setup(
        { replies: { 'https://shop.test/': reply(200) } },
        { classify: () => ({ kind: 'empty' }) },
      );
      expect((await fetchPage(page('https://shop.test/'), s.deps)).outcome).toEqual({
        kind: 'empty',
        rung: 'http',
      });
    });

    it('with no opinion leaves the settled 403 rule and the status mapping in force', async () => {
      const s = setup(
        { replies: { 'https://shop.test/a': reply(403), 'https://shop.test/b': reply(404) } },
        { classify: () => null },
      );
      expect((await fetchPage(page('https://shop.test/a'), s.deps)).outcome.kind).toBe('wall');
      expect((await fetchPage(page('https://shop.test/b'), s.deps)).outcome.kind).toBe('not_found');
    });

    it('rejects an invalid verdict', async () => {
      const s = setup(
        { replies: { 'https://shop.test/': reply(200) } },
        { classify: () => ({ kind: 'wall', vendor: 'Not A Vendor!', mode: 'challenge' }) },
      );
      await expect(fetchPage(page('https://shop.test/'), s.deps)).rejects.toThrow(TypeError);
    });

    it('is not asked when nothing was read', async () => {
      let asked = 0;
      const s = setup(
        { dns: { 'shop.test': ['10.0.0.1'] }, replies: {} },
        {
          classify: () => {
            asked++;
            return null;
          },
        },
      );
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result).toEqual({
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'private_address' },
        response: null,
      });
      expect(asked).toBe(0);
    });
  });

  describe('goes through the guard', () => {
    it('passes a refusal through and never dials', async () => {
      const s = setup({ dns: { 'shop.test': [PUBLIC, '192.168.1.10'] }, replies: {} });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({
        kind: 'refused_by_policy',
        rung: 'http',
        reason: 'private_address',
      });
      expect(s.hops).toEqual([]);
    });

    it('refuses loopback and other schemes without a lookup', async () => {
      const s = setup({ replies: {} });
      expect((await fetchPage(page('http://127.0.0.1:8080/api/health'), s.deps)).outcome).toEqual({
        kind: 'refused_by_policy',
        rung: 'http',
        reason: 'private_address',
      });
      expect((await fetchPage(api('ftp://shop.test/x'), s.deps)).outcome).toEqual({
        kind: 'refused_by_policy',
        rung: 'api',
        reason: 'scheme',
      });
      expect(s.hops).toEqual([]);
      expect(s.lookups).toEqual([]);
    });

    it('refuses a redirect to a private address before requesting it', async () => {
      const s = setup({
        replies: {
          'https://shop.test/': reply(302, [
            ['location', 'http://169.254.169.254/latest/meta-data'],
          ]),
        },
      });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({
        kind: 'refused_by_policy',
        rung: 'http',
        reason: 'private_address',
      });
      expect(s.hops.map((h) => h.url)).toEqual(['https://shop.test/']);
    });

    it('refuses a body over the cap', async () => {
      const s = setup({ replies: { 'https://shop.test/': reply(200, [], ['x'.repeat(11)]) } });
      const result = await fetchPage(page('https://shop.test/', { maxBodyBytes: 10 }), s.deps);
      expect(result).toEqual({
        outcome: { kind: 'refused_by_policy', rung: 'http', reason: 'body_size' },
        response: null,
      });
    });

    it('dials the vetted address and follows a redirect to its final URL', async () => {
      const s = setup({
        replies: {
          'https://shop.test/old': reply(301, [['location', '/new']]),
          'https://shop.test/new': reply(200),
        },
      });
      const result = await fetchPage(page('https://shop.test/old'), s.deps);
      expect(result.response?.finalUrl).toBe('https://shop.test/new');
      expect(s.hops.map((h) => [h.address, h.port, h.url])).toEqual([
        [PUBLIC, 443, 'https://shop.test/old'],
        [PUBLIC, 443, 'https://shop.test/new'],
      ]);
    });
  });

  describe('transport failures', () => {
    it('are network errors with the transport’s code', async () => {
      const s = setup({ replies: {}, failing: { [PUBLIC]: coded('ECONNRESET') } });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result).toEqual({
        outcome: { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
        response: null,
      });
    });

    it('are timeouts at or after the deadline, whatever the client called them', async () => {
      let advance = (_: number) => {};
      const s = setup({
        replies: {
          'https://shop.test/': {
            status: 200,
            body: [
              'partial',
              () => {
                advance(10_000);
                return coded('GENERIC_FAILURE');
              },
            ],
          },
        },
      });
      advance = s.advance;
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.outcome).toEqual({ kind: 'network_error', rung: 'http', code: TIMEOUT_CODE });
    });

    it('are named an abort when the caller aborted before the deadline', async () => {
      const controller = new AbortController();
      const s = setup({ replies: {}, failing: { [PUBLIC]: coded('ERR_TRANSPORT') } });
      controller.abort();
      const result = await fetchPage(
        page('https://shop.test/', { signal: controller.signal }),
        s.deps,
      );
      expect(result.outcome).toEqual({ kind: 'network_error', rung: 'http', code: ABORT_CODE });
    });

    it('a name that does not resolve is a network error, not a refusal', async () => {
      const s = setup({ dns: {}, replies: {} });
      expect((await fetchPage(page('https://nowhere.test/'), s.deps)).outcome).toEqual({
        kind: 'network_error',
        rung: 'http',
        code: 'ENOTFOUND',
      });
    });
  });

  describe('cookies', () => {
    it('keeps a host session: Set-Cookie of every hop is stored and sent back', async () => {
      const s = setup({
        replies: {
          'https://shop.test/start': reply(302, [
            ['location', '/landing'],
            ['set-cookie', 'sid=1; Path=/'],
          ]),
          'https://shop.test/landing': reply(200, [['set-cookie', 'seen=yes; Path=/']]),
          'https://shop.test/next': reply(200),
        },
      });
      await fetchPage(page('https://shop.test/start'), s.deps);
      await fetchPage(page('https://shop.test/next'), s.deps);
      expect(s.hops.map((h) => h.headers)).toEqual([
        [],
        [['cookie', 'sid=1']],
        [['cookie', 'sid=1; seen=yes']],
      ]);
    });

    it('forget(site) ends the session', async () => {
      const s = setup({
        replies: {
          'https://shop.test/a': reply(200, [['set-cookie', 'sid=1; Path=/']]),
          'https://shop.test/b': reply(200),
        },
      });
      await fetchPage(page('https://shop.test/a'), s.deps);
      s.jars.forget('shop.test');
      await fetchPage(page('https://shop.test/b'), s.deps);
      expect(s.hops[1]?.headers).toEqual([]);
    });

    it('hands the response’s Set-Cookie values to the classifier too', async () => {
      const s = setup({
        replies: { 'https://shop.test/': reply(200, [['set-cookie', '_abck=x; Path=/']]) },
      });
      const result = await fetchPage(page('https://shop.test/'), s.deps);
      expect(result.response?.setCookies).toEqual(['_abck=x; Path=/']);
      expect(result.response?.headers['set-cookie']).toBeUndefined();
    });
  });

  it('hands the guard the deadline and signal of the request', async () => {
    const controller = new AbortController();
    const s = setup({ replies: { 'https://shop.test/': reply(200) } });
    await fetchPage(
      page('https://shop.test/', { deadline: NOW + 1_234, signal: controller.signal }),
      s.deps,
    );
    expect(s.contexts[0]?.deadline).toBe(NOW + 1_234);
    expect(s.contexts[0]?.signal).toBe(controller.signal);
  });

  it('refuses a rung that is not an HTTP rung', async () => {
    const s = setup({ replies: {} });
    await expect(
      fetchPage(
        { ...page('https://shop.test/'), rung: 'browser' } as unknown as PageRequest,
        s.deps,
      ),
    ).rejects.toThrow(RangeError);
  });
});
