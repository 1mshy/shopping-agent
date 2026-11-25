// What a robots.txt answers (RFC 9309 §2.3.1 as mapped in policy.ts), from real fetchPage results
// on a scripted network, and the per-origin cache.
import { describe, expect, it } from 'vitest';
import { CookieJars } from '../../src/cookies/index.ts';
import { type Classify, fetchPage, type PageResult } from '../../src/page/index.ts';
import {
  createRobotsCache,
  interpretRobots,
  ROBOTS_CACHE_MS,
  ROBOTS_PARSE_LIMIT,
  ROBOTS_RETRY_MS,
  type RobotsAnswer,
  robotsAnswerTtl,
  robotsUrlOf,
  robotsVerdict,
} from '../../src/robots/index.ts';
import { coded, type PageReply, scriptedNetwork } from '../page/net.ts';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const PUBLIC = '93.184.215.14';
const ROBOTS = 'https://shop.test/robots.txt';

async function fetched(
  replies: Record<string, PageReply>,
  options: { classify?: Classify; dns?: Record<string, readonly string[] | Error> } = {},
): Promise<PageResult> {
  const net = scriptedNetwork({
    dns: options.dns ?? { 'shop.test': [PUBLIC], 'cdn.test': [PUBLIC] },
    replies,
  });
  return fetchPage(
    { rung: 'http', url: ROBOTS, deadline: T0 + 10_000, signal: new AbortController().signal },
    { network: net.network, jars: new CookieJars(), now: () => T0, classify: options.classify },
  );
}

async function answerFor(
  reply: PageReply,
  options: { classify?: Classify } = {},
): Promise<RobotsAnswer> {
  return interpretRobots(ROBOTS, await fetched({ [ROBOTS]: reply }, options));
}

const text = (status: number, body: string, contentType = 'text/plain'): PageReply => ({
  status,
  headers: [['content-type', contentType]],
  body: [body],
});

const RULES = [
  'User-agent: *',
  'Disallow: /checkout',
  '',
  'User-agent: agentic-dasher',
  'Disallow: /cart',
  'Allow: /cart/public',
  '',
  'User-agent: otherbot',
  'Disallow: /',
].join('\n');

describe('interpretRobots', () => {
  it('reads the rules of our product token, which replace the * group', async () => {
    const answer = await answerFor(text(200, RULES));
    expect(answer.state).toBe('parsed');
    expect(robotsVerdict(answer, 'https://shop.test/cart/42')).toBe('disallowed');
    expect(robotsVerdict(answer, 'https://shop.test/cart/public/1')).toBe('allowed');
    expect(robotsVerdict(answer, 'https://shop.test/checkout')).toBe('allowed');
    expect(robotsVerdict(answer, 'https://shop.test/p/1')).toBe('allowed');
  });

  it('falls back to the * group when no group names us', async () => {
    const answer = await answerFor(text(200, 'User-agent: *\nDisallow: /search\n'));
    expect(robotsVerdict(answer, 'https://shop.test/search?q=x')).toBe('disallowed');
    expect(robotsVerdict(answer, 'https://shop.test/p/1')).toBe('allowed');
  });

  it('allows everything on an empty robots.txt, and reads one behind a byte-order mark', async () => {
    expect(robotsVerdict(await answerFor(text(200, '')), 'https://shop.test/x')).toBe('allowed');
    const bom = await answerFor(text(200, '﻿User-agent: *\nDisallow: /\n'));
    expect(robotsVerdict(bom, 'https://shop.test/x')).toBe('disallowed');
  });

  it('gives no verdict for a URL of another origin', async () => {
    const answer = await answerFor(text(200, RULES));
    expect(robotsVerdict(answer, 'http://shop.test/cart/42')).toBe('unknown');
    expect(robotsVerdict(answer, 'https://www.shop.test/cart/42')).toBe('unknown');
    expect(robotsUrlOf('https://shop.test:8443/p/1?x=1')).toBe('https://shop.test:8443/robots.txt');
  });

  it('parses only the first 500 KiB', async () => {
    const filler = `# ${'x'.repeat(ROBOTS_PARSE_LIMIT)}\n`;
    const answer = await answerFor(text(200, `User-agent: *\n${filler}Disallow: /\n`));
    expect(answer.state).toBe('parsed');
    expect(robotsVerdict(answer, 'https://shop.test/x')).toBe('allowed');
  });

  it('applies the rules to the origin asked, after a redirect', async () => {
    const answer = interpretRobots(
      ROBOTS,
      await fetched({
        [ROBOTS]: { status: 301, headers: [['location', 'https://cdn.test/shop/robots.txt']] },
        'https://cdn.test/shop/robots.txt': text(200, 'User-agent: *\nDisallow: /cart\n'),
      }),
    );
    expect(robotsVerdict(answer, 'https://shop.test/cart')).toBe('disallowed');
    expect(robotsVerdict(answer, 'https://cdn.test/cart')).toBe('unknown');
  });

  it('gives no verdict for a challenge, whatever its status', async () => {
    // The default classifier calls a bare 403 a wall.
    const forbidden = await answerFor(text(403, 'User-agent: *\nDisallow:\n'));
    expect(forbidden).toMatchObject({ state: 'challenged', status: 403 });
    expect(robotsVerdict(forbidden, 'https://shop.test/x')).toBe('unknown');
    // A classifier that names the challenge decides, even on a 200 or a 429.
    const vercel: Classify = (input) =>
      input.headers['x-vercel-mitigated'] === 'challenge'
        ? { kind: 'wall', vendor: 'vercel', mode: 'challenge' }
        : null;
    for (const status of [200, 429, 503]) {
      const answer = await answerFor(
        {
          status,
          headers: [['x-vercel-mitigated', 'challenge']],
          body: ['User-agent: *\nDisallow: /\n'],
        },
        { classify: vercel },
      );
      expect(answer.state).toBe('challenged');
      expect(robotsVerdict(answer, 'https://shop.test/x')).toBe('unknown');
    }
  });

  it('gives no verdict for an HTML document served as robots.txt', async () => {
    for (const body of [
      '<!DOCTYPE html><html><body>Sign in</body></html>',
      '  \n<html>',
      '<?xml ?>',
    ]) {
      const answer = await answerFor(text(200, body, 'text/html'));
      expect(answer.state).toBe('not_robots');
      expect(robotsVerdict(answer, 'https://shop.test/x')).toBe('unknown');
    }
    const plainAsHtml = await answerFor(text(200, 'User-agent: *\nDisallow: /\n', 'text/html'));
    expect(plainAsHtml.state).toBe('parsed');
  });

  it('allows everything when robots.txt is unavailable (4xx, unfollowed 3xx, redirect loop)', async () => {
    for (const status of [400, 401, 402, 404, 410, 451, 304]) {
      const answer = await answerFor(text(status, 'User-agent: *\nDisallow: /\n'));
      expect([status, answer.state]).toEqual([status, 'unavailable']);
      expect(robotsVerdict(answer, 'https://shop.test/x')).toBe('allowed');
    }
    const loop = interpretRobots(
      ROBOTS,
      await fetched({ [ROBOTS]: { status: 302, headers: [['location', ROBOTS]] } }),
    );
    expect(loop).toMatchObject({ state: 'unavailable', status: null });
    expect(loop.outcome).toMatchObject({ kind: 'network_error', code: 'ERR_TOO_MANY_REDIRECTS' });
  });

  it('disallows everything when robots.txt is unreachable (5xx, 429)', async () => {
    for (const status of [500, 502, 503, 429]) {
      const answer = await answerFor(text(status, ''));
      expect([status, answer.state]).toEqual([status, 'unreachable']);
      expect(robotsVerdict(answer, 'https://shop.test/x')).toBe('disallowed');
    }
  });

  it('gives no verdict when nothing was read', async () => {
    const reset = interpretRobots(ROBOTS, {
      outcome: { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
      response: null,
    });
    expect(reset).toMatchObject({ state: 'failed', status: null });
    expect(robotsVerdict(reset, 'https://shop.test/x')).toBe('unknown');
    const dns = interpretRobots(
      ROBOTS,
      await fetched({}, { dns: { 'shop.test': coded('ENOTFOUND') } }),
    );
    expect(dns.outcome).toMatchObject({ kind: 'network_error', code: 'ENOTFOUND' });
    expect(dns.state).toBe('failed');
    const lan = interpretRobots(ROBOTS, await fetched({}, { dns: { 'shop.test': ['10.0.0.8'] } }));
    expect(lan.outcome).toMatchObject({ kind: 'refused_by_policy', reason: 'private_address' });
    expect(lan.state).toBe('failed');
  });
});

describe('robotsAnswerTtl', () => {
  const failed = (outcome: RobotsAnswer['outcome']): RobotsAnswer => ({
    robotsUrl: ROBOTS,
    state: 'failed',
    outcome,
    status: null,
    rules: null,
  });

  it('keeps a real answer a day, a failure 15 minutes, and a passing failure not at all', async () => {
    expect(robotsAnswerTtl(await answerFor(text(200, RULES)))).toBe(ROBOTS_CACHE_MS);
    expect(robotsAnswerTtl(await answerFor(text(404, '')))).toBe(ROBOTS_CACHE_MS);
    expect(robotsAnswerTtl(await answerFor(text(200, '<html>')))).toBe(ROBOTS_CACHE_MS);
    expect(robotsAnswerTtl(await answerFor(text(503, '')))).toBe(ROBOTS_RETRY_MS);
    expect(robotsAnswerTtl(await answerFor(text(403, '')))).toBe(ROBOTS_RETRY_MS);
    const rung = 'http' as const;
    expect(robotsAnswerTtl(failed({ kind: 'network_error', rung, code: 'ECONNRESET' }))).toBe(0);
    expect(robotsAnswerTtl(failed({ kind: 'network_error', rung, code: 'ETIMEDOUT' }))).toBe(0);
    for (const reason of ['host_limit', 'budget'] as const) {
      expect(robotsAnswerTtl(failed({ kind: 'refused_by_policy', rung, reason }))).toBe(0);
    }
    for (const reason of ['private_address', 'body_size'] as const) {
      expect(robotsAnswerTtl(failed({ kind: 'refused_by_policy', rung, reason }))).toBe(
        ROBOTS_RETRY_MS,
      );
    }
  });
});

describe('createRobotsCache', () => {
  const ok = (body: string): PageResult => ({
    outcome: { kind: 'ok', rung: 'http' },
    response: {
      status: 200,
      finalUrl: ROBOTS,
      headers: {},
      setCookies: [],
      contentType: 'text/plain',
      body: new TextEncoder().encode(body),
      text: body,
    },
  });
  const reset: PageResult = {
    outcome: { kind: 'network_error', rung: 'http', code: 'ECONNRESET' },
    response: null,
  };

  it('reuses an answer for a day, then asks again', async () => {
    let now = T0;
    const cache = createRobotsCache({ now: () => now });
    let calls = 0;
    const fetch = async () => {
      calls++;
      return ok('User-agent: *\nDisallow: /cart\n');
    };
    expect((await cache.answer(ROBOTS, fetch)).cached).toBe(false);
    now += ROBOTS_CACHE_MS - 1;
    expect((await cache.answer(ROBOTS, fetch)).cached).toBe(true);
    expect(calls).toBe(1);
    now += 1;
    expect((await cache.answer(ROBOTS, fetch)).cached).toBe(false);
    expect(calls).toBe(2);
  });

  it('shares one request between concurrent callers of one origin', async () => {
    const cache = createRobotsCache({ now: () => T0 });
    let calls = 0;
    let release: (r: PageResult) => void = () => {};
    const fetch = () => {
      calls++;
      return new Promise<PageResult>((resolve) => {
        release = resolve;
      });
    };
    const all = Promise.all([1, 2, 3].map(() => cache.answer(ROBOTS, fetch)));
    await Promise.resolve();
    release(ok(''));
    const answers = await all;
    expect(calls).toBe(1);
    expect(answers.map((a) => a.cached)).toEqual([false, true, true]);
  });

  it('does not hand another caller an answer it could not keep', async () => {
    const cache = createRobotsCache({ now: () => T0 });
    const calls: string[] = [];
    let release: (r: PageResult) => void = () => {};
    const first = cache.answer(ROBOTS, () => {
      calls.push('first');
      return new Promise<PageResult>((resolve) => {
        release = resolve;
      });
    });
    const second = cache.answer(ROBOTS, async () => {
      calls.push('second');
      return ok('');
    });
    release(reset);
    expect((await first).answer.state).toBe('failed');
    expect((await second).answer.state).toBe('parsed');
    expect(calls).toEqual(['first', 'second']);
  });

  it('keeps at most maxOrigins origins, dropping the oldest', async () => {
    const cache = createRobotsCache({ now: () => T0, maxOrigins: 2 });
    let calls = 0;
    const fetch = async () => {
      calls++;
      return ok('');
    };
    for (const origin of ['https://a.test', 'https://b.test', 'https://c.test', 'https://a.test']) {
      await cache.answer(`${origin}/robots.txt`, fetch);
    }
    expect(calls).toBe(4);
  });
});
