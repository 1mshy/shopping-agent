import { describe, expect, it } from 'vitest';
import {
  CookieJar,
  CookieJars,
  domainMatch,
  MAX_COOKIES_PER_JAR,
  MAX_COOKIES_TOTAL,
  MAX_JARS,
  parseCookieDate,
  pathMatch,
} from '../../src/cookies/index.ts';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

function jarWith(url: string, ...setCookies: string[]): CookieJar {
  const jar = new CookieJar();
  jar.store(setCookies, url, NOW);
  return jar;
}

describe('parseCookieDate (RFC 6265 §5.1.1)', () => {
  it('reads the usual forms', () => {
    expect(parseCookieDate('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(Date.UTC(2026, 9, 21, 7, 28, 0));
    expect(parseCookieDate('Wednesday, 21-Oct-26 07:28:00 GMT')).toBe(
      Date.UTC(2026, 9, 21, 7, 28, 0),
    );
    expect(parseCookieDate('Wed Oct 21 07:28:00 2026')).toBe(Date.UTC(2026, 9, 21, 7, 28, 0));
  });

  it('maps two-digit years as the algorithm says', () => {
    expect(parseCookieDate('01-Jan-70 00:00:00 GMT')).toBe(Date.UTC(1970, 0, 1));
    expect(parseCookieDate('01-Jan-69 00:00:00 GMT')).toBe(Date.UTC(2069, 0, 1));
  });

  it('fails a date that is not one', () => {
    expect(parseCookieDate('soon')).toBeNull();
    expect(parseCookieDate('31 Feb 2026 00:00:00')).toBeNull();
    expect(parseCookieDate('21 Oct 2026 25:00:00')).toBeNull();
    expect(parseCookieDate('21 Oct 1600 00:00:00')).toBeNull();
  });
});

describe('domain and path matching', () => {
  it('matches a domain and its subdomains, never an IP by suffix', () => {
    expect(domainMatch('shop.test', 'shop.test')).toBe(true);
    expect(domainMatch('www.shop.test', 'shop.test')).toBe(true);
    expect(domainMatch('evilshop.test', 'shop.test')).toBe(false);
    expect(domainMatch('1.2.3.4', '2.3.4')).toBe(false);
  });

  it('matches paths on segment boundaries', () => {
    expect(pathMatch('/a/b', '/a')).toBe(true);
    expect(pathMatch('/a/b', '/a/')).toBe(true);
    expect(pathMatch('/ab', '/a')).toBe(false);
    expect(pathMatch('/a', '/a')).toBe(true);
  });
});

describe('CookieJar', () => {
  it('sends a host-only cookie back to its host only', () => {
    const jar = jarWith('https://shop.test/p/1', 'sid=abc; Path=/');
    expect(jar.header('https://shop.test/other', NOW)).toBe('sid=abc');
    expect(jar.header('https://www.shop.test/', NOW)).toBeNull();
  });

  it('sends a Domain cookie to the domain and its subdomains', () => {
    const jar = jarWith('https://www.shop.test/', '_abck=x; Domain=.shop.test; Path=/');
    expect(jar.header('https://shop.test/', NOW)).toBe('_abck=x');
    expect(jar.header('https://cdn.shop.test/', NOW)).toBe('_abck=x');
  });

  it('refuses a Domain the host is not under', () => {
    const jar = jarWith(
      'https://www.shop.test/',
      'a=1; Domain=other.test',
      'b=2; Domain=www.shop.test.evil',
    );
    expect(jar.size).toBe(0);
  });

  it('refuses any other Domain for an IP host', () => {
    const jar = jarWith('http://203.0.113.5/', 'a=1; Domain=113.5');
    expect(jar.size).toBe(0);
  });

  it('defaults the path to the directory of the request', () => {
    const jar = jarWith('https://shop.test/products/item', 'a=1');
    expect(jar.header('https://shop.test/products/other', NOW)).toBe('a=1');
    expect(jar.header('https://shop.test/cart', NOW)).toBeNull();
  });

  it('keeps Secure cookies to https, and refuses one set over http', () => {
    const jar = jarWith('https://shop.test/', 's=1; Secure; Path=/');
    expect(jar.header('http://shop.test/', NOW)).toBeNull();
    expect(jar.header('https://shop.test/', NOW)).toBe('s=1');
    expect(jarWith('http://shop.test/', 's=1; Secure').size).toBe(0);
  });

  it('does not let plain http shadow a secure cookie', () => {
    const jar = jarWith('https://shop.test/', 's=1; Secure; Path=/');
    jar.store(['s=2; Path=/'], 'http://shop.test/', NOW);
    expect(jar.header('https://shop.test/', NOW)).toBe('s=1');
  });

  it('applies the __Secure- and __Host- prefixes', () => {
    expect(jarWith('https://shop.test/', '__Secure-a=1').size).toBe(0);
    expect(jarWith('https://shop.test/', '__Secure-a=1; Secure').size).toBe(1);
    expect(jarWith('https://shop.test/', '__Host-a=1; Secure; Path=/; Domain=shop.test').size).toBe(
      0,
    );
    expect(jarWith('https://shop.test/', '__Host-a=1; Secure; Path=/').size).toBe(1);
  });

  it('expires by Max-Age before Expires, on the given clock', () => {
    const jar = jarWith(
      'https://shop.test/',
      'a=1; Max-Age=60; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/',
    );
    expect(jar.header('https://shop.test/', NOW + 59_000)).toBe('a=1');
    expect(jar.header('https://shop.test/', NOW + 60_000)).toBeNull();
  });

  it('expires by Expires', () => {
    const jar = jarWith('https://shop.test/', 'a=1; Expires=Tue, 24 Nov 2026 12:00:10 GMT; Path=/');
    expect(jar.header('https://shop.test/', NOW + 9_000)).toBe('a=1');
    expect(jar.header('https://shop.test/', NOW + 10_000)).toBeNull();
  });

  it('deletes a cookie set again with Max-Age=0 or a past date', () => {
    const jar = jarWith('https://shop.test/', 'a=1; Path=/', 'b=2; Path=/');
    jar.store(
      ['a=; Max-Age=0; Path=/', 'b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'],
      'https://shop.test/',
      NOW,
    );
    expect(jar.header('https://shop.test/', NOW)).toBeNull();
  });

  it('replaces a cookie of the same name, domain and path', () => {
    const jar = jarWith('https://shop.test/', 'a=1; Path=/');
    jar.store(['a=2; Path=/'], 'https://shop.test/', NOW + 1);
    expect(jar.header('https://shop.test/', NOW + 2)).toBe('a=2');
    expect(jar.size).toBe(1);
  });

  it('orders longer paths first, then older cookies first', () => {
    const jar = new CookieJar();
    jar.store(['b=2; Path=/'], 'https://shop.test/', NOW);
    jar.store(['a=1; Path=/'], 'https://shop.test/', NOW + 1);
    jar.store(['c=3; Path=/x'], 'https://shop.test/', NOW + 2);
    expect(jar.header('https://shop.test/x/y', NOW + 3)).toBe('c=3; b=2; a=1');
  });

  it('ignores a header with no name or no equals sign', () => {
    expect(jarWith('https://shop.test/', 'novalue', '=x', '').size).toBe(0);
  });

  it('keeps at most MAX_COOKIES_PER_JAR cookies, dropping the oldest', () => {
    const jar = new CookieJar();
    for (let i = 0; i <= MAX_COOKIES_PER_JAR; i++) {
      jar.store([`c${i}=1; Path=/`], 'https://shop.test/', NOW + i);
    }
    expect(jar.size).toBe(MAX_COOKIES_PER_JAR);
    expect(jar.list().some((c) => c.name === 'c0')).toBe(false);
  });
});

describe('CookieJars', () => {
  it('keeps one jar per host', () => {
    const jars = new CookieJars();
    jars
      .jar('www.shop.test')
      .store(['a=1; Domain=shop.test; Path=/'], 'https://www.shop.test/', NOW);
    expect(jars.jar('www.shop.test')).toBe(jars.jar('WWW.SHOP.TEST'));
    // Another host's session does not see it, Domain notwithstanding.
    expect(jars.jar('cdn.shop.test').header('https://cdn.shop.test/', NOW)).toBeNull();
  });

  it('forgets a site: its own jar, and its parent-domain cookies held elsewhere', () => {
    const jars = new CookieJars();
    jars
      .jar('www.shop.test')
      .store(['sid=1; Path=/', '_abck=x; Domain=shop.test; Path=/'], 'https://www.shop.test/', NOW);
    jars
      .jar('m.shop.test')
      .store(['bm=y; Domain=shop.test; Path=/', 'own=z; Path=/'], 'https://m.shop.test/', NOW);
    jars.jar('other.test').store(['keep=1; Path=/'], 'https://other.test/', NOW);

    jars.forget('www.shop.test');

    expect(jars.jar('www.shop.test').size).toBe(0);
    // The bot manager's cookie on the parent domain goes; the other host's own cookie stays.
    expect(
      jars
        .jar('m.shop.test')
        .list()
        .map((c) => c.name),
    ).toEqual(['own']);
    expect(jars.jar('other.test').header('https://other.test/', NOW)).toBe('keep=1');
  });

  it('forgets every host under a site', () => {
    const jars = new CookieJars();
    jars.jar('www.shop.test').store(['a=1; Path=/'], 'https://www.shop.test/', NOW);
    jars.jar('shop.test').store(['b=1; Path=/'], 'https://shop.test/', NOW);
    jars.forget('shop.test');
    expect(jars.jar('www.shop.test').size).toBe(0);
    expect(jars.jar('shop.test').size).toBe(0);
  });

  // From the fetch review's finding 5, case 1: a wall on a hosting suffix emptied every shop on it.
  it('forgets a hosting suffix without touching the shops under it', () => {
    const jars = new CookieJars();
    jars.jar('www.myshopify.com').store(['w=1; Path=/'], 'https://www.myshopify.com/', NOW);
    jars.jar('alpha.myshopify.com').store(['a=1; Path=/'], 'https://alpha.myshopify.com/', NOW);
    jars.jar('beta.myshopify.com').store(['b=1; Path=/'], 'https://beta.myshopify.com/', NOW);
    // The site of `www.myshopify.com`, as the session drop names it.
    jars.forget('myshopify.com');
    expect(jars.jar('www.myshopify.com').size).toBe(0);
    expect(jars.jar('alpha.myshopify.com').size).toBe(1);
    expect(jars.jar('beta.myshopify.com').size).toBe(1);
  });

  it('leaves a cookie on a public suffix alone when a site under it is forgotten', () => {
    const jars = new CookieJars();
    jars.jar('a.co.uk').store(['wide=1; Domain=co.uk; Path=/'], 'https://a.co.uk/', NOW);
    jars
      .jar('m.b.co.uk')
      .store(
        ['bm=1; Domain=b.co.uk; Path=/', 'wide=1; Domain=co.uk; Path=/'],
        'https://m.b.co.uk/',
        NOW,
      );
    jars.forget('b.co.uk');
    expect(jars.jar('a.co.uk').size).toBe(1);
    expect(jars.jar('m.b.co.uk').size).toBe(0);
  });

  // From the fetch review's finding 3: a page chooses the hosts it redirects to, and nothing
  // capped the jars.
  it('keeps at most MAX_JARS jars, dropping the least recently used', () => {
    const jars = new CookieJars();
    for (let i = 0; i < MAX_JARS + 50; i++) {
      jars.jar(`h${i}.test`).store(['a=1; Path=/'], `https://h${i}.test/`, NOW);
      // The first host stays in use throughout.
      jars.jar('h0.test');
    }
    expect(jars.size).toBe(MAX_JARS);
    expect(jars.jar('h0.test').size).toBe(1);
    // An early host that was not used again lost its jar: asking again gives an empty one.
    expect(jars.jar('h1.test').size).toBe(0);
    expect(jars.jar(`h${MAX_JARS + 49}.test`).size).toBe(1);
  });

  // From the review of the caps: hosts a page chose could push every watched shop's jar out.
  it('a few hosts with full jars do not evict a shop with a small one', () => {
    const jars = new CookieJars();
    jars.jar('shop.test').store(['sid=1; Path=/'], 'https://shop.test/', NOW);
    for (let i = 0; i < 40; i++) {
      const cookies = Array.from({ length: MAX_COOKIES_PER_JAR }, (_, n) => `c${n}=1; Path=/`);
      jars.jar(`h${i}.evil.test`).store(cookies, `https://h${i}.evil.test/`, NOW);
    }
    jars.jar('another.test');
    expect(jars.jar('shop.test').header('https://shop.test/', NOW)).toBe('sid=1');
    expect(jars.cookieCount).toBeLessThanOrEqual(MAX_COOKIES_TOTAL + MAX_COOKIES_PER_JAR);
  });

  it('a host written with a trailing dot shares its jar, and is forgotten with its site', () => {
    const jars = new CookieJars();
    jars.jar('shop.test.').store(['sid=1; Path=/'], 'https://shop.test./', NOW);
    expect(jars.jar('shop.test')).toBe(jars.jar('shop.test.'));
    jars.forget('shop.test');
    expect(jars.jar('shop.test.').size).toBe(0);
  });

  it('keeps the cookies of all jars near MAX_COOKIES_TOTAL, dropping the largest jars first', () => {
    const jars = new CookieJars();
    const perHost = 200;
    const hosts = Math.ceil(MAX_COOKIES_TOTAL / perHost) + 10;
    for (let i = 0; i < hosts; i++) {
      const cookies = Array.from({ length: perHost }, (_, n) => `c${n}=1; Path=/`);
      jars.jar(`h${i}.test`).store(cookies, `https://h${i}.test/`, NOW);
    }
    // The newest host's jar is whole; the total is under the cap plus the one jar being written.
    const newest = jars.jar(`h${hosts - 1}.test`);
    expect(newest.size).toBe(perHost);
    expect(jars.cookieCount).toBeLessThanOrEqual(MAX_COOKIES_TOTAL + MAX_COOKIES_PER_JAR);
    expect(jars.jar('h0.test').size).toBe(0);
  });
});
