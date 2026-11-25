// The guarded exchange (S§5.1): one resolution per hop, the connection pinned to the vetted
// addresses, every redirect hop re-checked before it is followed, a hop limit.
import { describe, expect, test } from 'vitest';
import { DEFAULT_MAX_REDIRECTS, guardedExchange } from '../../src/guard/index.ts';
import { failure, type Reply, scripted } from './net.ts';

const PUBLIC = '93.184.215.14';
const PUBLIC6 = '2606:2800:220:1:248:1893:25c8:1946';
const OTHER = '1.1.1.1';
const page: Reply = { status: 200 };
const to = (location: string, status = 302): Reply => ({ status, location });

function refusal(reason: string, rung = 'http') {
  return { delivered: false, outcome: { kind: 'refused_by_policy', rung, reason } };
}
function networkError(code: string, rung = 'http') {
  return { delivered: false, outcome: { kind: 'network_error', rung, code } };
}
function delivered(finalUrl: string, status = 200) {
  return { delivered: true, finalUrl, status };
}
/** The result without the transport's response object. */
function result(r: Awaited<ReturnType<typeof guardedExchange>>) {
  return r.delivered ? { delivered: true, finalUrl: r.finalUrl, status: r.status } : r;
}

describe('the first hop', () => {
  test('a public name is resolved once and dialled at the vetted address with the canonical URL', async () => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'http://store.example:8443/p?x=1': page },
    });
    const r = await guardedExchange(
      { url: 'HTTP://Store.Example:8443/p?x=1#reviews', rung: 'http' },
      net,
    );
    expect(result(r)).toEqual(delivered('http://store.example:8443/p?x=1'));
    expect(lookups).toEqual(['store.example']);
    expect(exchanges).toEqual([
      { address: PUBLIC, port: 8443, url: 'http://store.example:8443/p?x=1' },
    ]);
  });

  test('the response object is handed back with the delivered result', async () => {
    const { net } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'https://store.example/': { status: 204 } },
    });
    const r = await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net);
    expect(r.delivered && r.response.status).toBe(204);
  });

  test('an IP literal is never looked up', async () => {
    const { net, lookups, exchanges } = scripted({
      dns: {},
      replies: { 'http://1.1.1.1/': page },
    });
    expect(result(await guardedExchange({ url: 'http://16843009/', rung: 'http' }, net))).toEqual(
      delivered('http://1.1.1.1/'),
    );
    expect(lookups).toEqual([]);
    expect(exchanges).toEqual([{ address: OTHER, port: 80, url: 'http://1.1.1.1/' }]);
  });

  test.each([
    ['ftp://store.example/', 'scheme'],
    ['http://user@store.example/', 'url_form'],
    ['http://127.1/', 'private_address'],
    ['http://localhost/', 'private_address'],
  ])('%s is refused with no lookup and no connection', async (url, reason) => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], localhost: [[PUBLIC]] },
      replies: {},
    });
    expect(result(await guardedExchange({ url, rung: 'http' }, net))).toEqual(refusal(reason));
    expect(lookups).toEqual([]);
    expect(exchanges).toEqual([]);
  });
});

describe('DNS answers', () => {
  test('an empty answer is a network error and nothing is dialled', async () => {
    const { net, exchanges } = scripted({ dns: { 'store.example': [[]] }, replies: {} });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(networkError('ENOTFOUND'));
    expect(exchanges).toEqual([]);
  });

  test.each([
    [failure('ENOTFOUND'), 'ENOTFOUND'],
    [failure('EAI_AGAIN'), 'EAI_AGAIN'],
    [failure('ESERVFAIL'), 'ESERVFAIL'],
    [failure(undefined, 'resolver exploded'), 'EAI_FAIL'],
    [failure('not a code!'), 'EAI_FAIL'],
  ])(
    'a resolver failure (%s) is the network error %s and nothing is dialled',
    async (error, code) => {
      const { net, exchanges } = scripted({ dns: { 'store.example': [error] }, replies: {} });
      expect(
        result(await guardedExchange({ url: 'https://store.example/', rung: 'api' }, net)),
      ).toEqual(networkError(code, 'api'));
      expect(exchanges).toEqual([]);
    },
  );

  test('a resolver that throws something that is not an Error still fails closed', async () => {
    const { net, exchanges } = scripted({ dns: {}, replies: {} });
    const broken = {
      ...net,
      lookup: async () => {
        throw 'nope';
      },
    };
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, broken)),
    ).toEqual(networkError('EAI_FAIL'));
    expect(exchanges).toEqual([]);
  });

  test('a mixed public and private answer is refused and nothing is dialled', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC, '10.0.0.30']] },
      replies: { 'https://store.example/': page },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(refusal('private_address'));
    expect(exchanges).toEqual([]);
  });

  test('rebinding between the check and the connection cannot happen: one lookup, pinned dial', async () => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC], ['127.0.0.1']] },
      replies: { 'https://store.example/': page },
      failing: { [PUBLIC]: failure('ECONNREFUSED') },
    });
    // Even when the vetted address refuses, the guard does not resolve again.
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(networkError('ECONNREFUSED'));
    expect(lookups).toEqual(['store.example']);
    expect(exchanges).toEqual([{ address: PUBLIC, port: 443, url: 'https://store.example/' }]);
  });

  test('rebinding between two hops of one chain is caught at the second hop', async () => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC], ['127.0.0.1']] },
      replies: { 'https://store.example/a': to('/b'), 'https://store.example/b': page },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/a', rung: 'http' }, net)),
    ).toEqual(refusal('private_address'));
    expect(lookups).toEqual(['store.example', 'store.example']);
    expect(exchanges).toEqual([{ address: PUBLIC, port: 443, url: 'https://store.example/a' }]);
  });
});

describe('connection failures', () => {
  test.each([
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EADDRNOTAVAIL',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('after %s on the first vetted address, the next vetted one is dialled', async (code) => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC6, PUBLIC], ['10.0.0.1']] },
      replies: { 'https://store.example/': page },
      failing: { [PUBLIC]: failure(code) },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(delivered('https://store.example/'));
    expect(lookups).toEqual(['store.example']);
    // IPv4 first.
    expect(exchanges.map((e) => e.address)).toEqual([PUBLIC, PUBLIC6]);
  });

  test('a failure after the connection (a reset) is not retried on another address', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC, PUBLIC6]] },
      replies: { 'https://store.example/': page },
      failing: { [PUBLIC]: failure('ECONNRESET') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(networkError('ECONNRESET'));
    expect(exchanges.map((e) => e.address)).toEqual([PUBLIC]);
  });

  test('when every vetted address refuses, the last failure is reported', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC, PUBLIC6]] },
      replies: {},
      failing: { [PUBLIC]: failure('ECONNREFUSED'), [PUBLIC6]: failure('ENETUNREACH') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(networkError('ENETUNREACH'));
    expect(exchanges.map((e) => e.address)).toEqual([PUBLIC, PUBLIC6]);
  });

  test('a transport failure without a usable code is a network error, not a throw', async () => {
    const { net } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: {},
      failing: { [PUBLIC]: failure(undefined, 'boom') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, net)),
    ).toEqual(networkError('ERR_TRANSPORT'));
  });
});

describe('redirects', () => {
  test.each([301, 302, 303, 307, 308])(
    'a %i to a public host is followed after its own lookup',
    async (status) => {
      const { net, lookups, exchanges, discarded } = scripted({
        dns: { 'store.example': [[PUBLIC]], 'www.store.example': [[PUBLIC6]] },
        replies: {
          'https://store.example/go': to('https://www.store.example/p/1', status),
          'https://www.store.example/p/1': page,
        },
      });
      expect(
        result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
      ).toEqual(delivered('https://www.store.example/p/1'));
      expect(lookups).toEqual(['store.example', 'www.store.example']);
      expect(exchanges).toEqual([
        { address: PUBLIC, port: 443, url: 'https://store.example/go' },
        { address: PUBLIC6, port: 443, url: 'https://www.store.example/p/1' },
      ]);
      // The redirect's own body is released, the final one is not.
      expect(discarded).toEqual(['https://store.example/go']);
    },
  );

  test.each([300, 304, 305, 306])(
    'a %i is not followed: it is the final response',
    async (status) => {
      const { net, exchanges } = scripted({
        dns: { 'store.example': [[PUBLIC]] },
        replies: { 'https://store.example/go': to('https://www.store.example/', status) },
      });
      expect(
        result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
      ).toEqual(delivered('https://store.example/go', status));
      expect(exchanges).toHaveLength(1);
    },
  );

  test.each([[{ status: 302 } as Reply], [to('')]])(
    'a redirect with no usable Location is the final response',
    async (reply) => {
      const { net, exchanges } = scripted({
        dns: { 'store.example': [[PUBLIC]] },
        replies: { 'https://store.example/go': reply },
      });
      expect(
        result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
      ).toEqual(delivered('https://store.example/go', 302));
      expect(exchanges).toHaveLength(1);
    },
  );

  test.each([
    ['/p/2', 'https://store.example/p/2'],
    ['p/2', 'https://store.example/a/p/2'],
    ['../p/2', 'https://store.example/p/2'],
    ['?page=2', 'https://store.example/a/b?page=2'],
    ['//www.store.example/p/2', 'https://www.store.example/p/2'],
    ['HTTPS://WWW.STORE.EXAMPLE/p/2#x', 'https://www.store.example/p/2'],
  ])('a relative Location %j is resolved against the hop it came from', async (location, next) => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], 'www.store.example': [[PUBLIC]] },
      replies: { 'https://store.example/a/b': to(location), [next]: page },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/a/b', rung: 'http' }, net)),
    ).toEqual(delivered(next));
    expect(exchanges.map((e) => e.url)).toEqual(['https://store.example/a/b', next]);
  });

  test.each([
    ['http://10.0.0.30:1234/v1/models', 'private_address'],
    ['http://[::1]/', 'private_address'],
    ['http://2130706433/', 'private_address'],
    ['http://[::ffff:169.254.169.254]/latest/meta-data/', 'private_address'],
    ['http://localhost:8000/api', 'private_address'],
    ['//127.0.0.1/admin', 'private_address'],
    ['ftp://store.example/price.txt', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,hi', 'scheme'],
    ['gopher://store.example:70/_GET', 'scheme'],
    ['http://user:pw@store.example/', 'url_form'],
    ['//user@www.store.example/', 'url_form'],
    ['https:///p/1', 'url_form'],
    ['https:www.store.example/', 'url_form'],
    ['/\\127.0.0.1/', 'url_form'],
    ['\\\\127.0.0.1\\', 'url_form'],
    ['/p/ 2', 'url_form'],
    ['\t//127.0.0.1/', 'url_form'],
    ['http://[fe80::1%25en0]/', 'url_form'],
  ])('a redirect to %j is refused (%s) and never requested', async (location, reason) => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], 'www.store.example': [[PUBLIC]], localhost: [[PUBLIC]] },
      replies: { 'https://store.example/go': to(location) },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/go', rung: 'browser' }, net)),
    ).toEqual(refusal(reason, 'browser'));
    expect(lookups).toEqual(['store.example']);
    expect(exchanges).toEqual([{ address: PUBLIC, port: 443, url: 'https://store.example/go' }]);
  });

  test('a redirect to a name that resolves private is refused after its lookup, never dialled', async () => {
    const { net, lookups, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], 'cdn.store.example': [[PUBLIC, '100.64.0.1']] },
      replies: {
        'https://store.example/go': to('https://cdn.store.example/p'),
        'https://cdn.store.example/p': page,
      },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
    ).toEqual(refusal('private_address'));
    expect(lookups).toEqual(['store.example', 'cdn.store.example']);
    expect(exchanges).toHaveLength(1);
  });

  test('a redirect to a name that does not resolve is a network error', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'https://store.example/go': to('https://gone.example/p') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
    ).toEqual(networkError('ENOTFOUND'));
    expect(exchanges).toHaveLength(1);
  });

  test('a private hop in the middle of a chain stops the chain there', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], 'www.store.example': [[PUBLIC]] },
      replies: {
        'https://store.example/1': to('https://www.store.example/2'),
        'https://www.store.example/2': to('http://192.168.1.1/3'),
        'http://192.168.1.1/3': to('https://www.store.example/4'),
        'https://www.store.example/4': page,
      },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/1', rung: 'http' }, net)),
    ).toEqual(refusal('private_address'));
    expect(exchanges.map((e) => e.url)).toEqual([
      'https://store.example/1',
      'https://www.store.example/2',
    ]);
  });
});

describe('the hop limit', () => {
  function chain(length: number) {
    const replies: Record<string, Reply> = {};
    for (let i = 0; i < length; i++) replies[`https://store.example/${i}`] = to(`/${i + 1}`);
    replies[`https://store.example/${length}`] = page;
    return scripted({ dns: { 'store.example': [[PUBLIC]] }, replies });
  }

  test('the default limit is a small positive number', () => {
    expect(Number.isInteger(DEFAULT_MAX_REDIRECTS)).toBe(true);
    expect(DEFAULT_MAX_REDIRECTS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_REDIRECTS).toBeLessThanOrEqual(20);
  });

  test('exactly the limit of redirects is followed', async () => {
    const { net, exchanges } = chain(DEFAULT_MAX_REDIRECTS);
    const r = await guardedExchange({ url: 'https://store.example/0', rung: 'http' }, net);
    expect(result(r)).toEqual(delivered(`https://store.example/${DEFAULT_MAX_REDIRECTS}`));
    expect(exchanges).toHaveLength(DEFAULT_MAX_REDIRECTS + 1);
  });

  test('one redirect over the limit is a network error and the extra hop is never requested', async () => {
    const { net, exchanges } = chain(DEFAULT_MAX_REDIRECTS + 1);
    const r = await guardedExchange({ url: 'https://store.example/0', rung: 'http' }, net);
    expect(result(r)).toEqual(networkError('ERR_TOO_MANY_REDIRECTS'));
    expect(exchanges).toHaveLength(DEFAULT_MAX_REDIRECTS + 1);
  });

  test('a custom limit is honoured, including zero', async () => {
    const two = chain(3);
    expect(
      result(
        await guardedExchange({ url: 'https://store.example/0', rung: 'http' }, two.net, {
          maxRedirects: 2,
        }),
      ),
    ).toEqual(networkError('ERR_TOO_MANY_REDIRECTS'));
    expect(two.exchanges).toHaveLength(3);
    const none = chain(1);
    expect(
      result(
        await guardedExchange({ url: 'https://store.example/0', rung: 'http' }, none.net, {
          maxRedirects: 0,
        }),
      ),
    ).toEqual(networkError('ERR_TOO_MANY_REDIRECTS'));
    expect(none.exchanges).toHaveLength(1);
  });

  test('a redirect loop ends at the limit', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]], 'www.store.example': [[PUBLIC]] },
      replies: {
        'https://store.example/a': to('https://www.store.example/b'),
        'https://www.store.example/b': to('https://store.example/a'),
      },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/a', rung: 'http' }, net)),
    ).toEqual(networkError('ERR_TOO_MANY_REDIRECTS'));
    expect(exchanges).toHaveLength(DEFAULT_MAX_REDIRECTS + 1);
  });

  test('a self-redirect loop ends at the limit', async () => {
    const { net, exchanges } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'https://store.example/a': to('/a') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/a', rung: 'http' }, net)),
    ).toEqual(networkError('ERR_TOO_MANY_REDIRECTS'));
    expect(exchanges).toHaveLength(DEFAULT_MAX_REDIRECTS + 1);
  });

  test.each([-1, 1.5, Number.NaN])(
    'an invalid limit (%s) is a programming error',
    async (maxRedirects) => {
      const { net } = chain(0);
      await expect(
        guardedExchange({ url: 'https://store.example/0', rung: 'http' }, net, { maxRedirects }),
      ).rejects.toThrow(RangeError);
    },
  );
});

describe('releasing and odd transports', () => {
  test('the body of a redirect that is refused is released too', async () => {
    const { net, discarded } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'https://store.example/go': to('http://10.0.0.1/') },
    });
    expect(
      result(await guardedExchange({ url: 'https://store.example/go', rung: 'http' }, net)),
    ).toEqual(refusal('private_address'));
    expect(discarded).toEqual(['https://store.example/go']);
  });

  test('a release that fails does not change the outcome', async () => {
    const { net } = scripted({
      dns: { 'store.example': [[PUBLIC]] },
      replies: { 'https://store.example/a': to('/b'), 'https://store.example/b': page },
    });
    const throwing = {
      ...net,
      exchange: async (address: string, port: number, url: string) => ({
        ...(await net.exchange(address, port, url)),
        discard: () => {
          throw new Error('already closed');
        },
      }),
    };
    expect(
      result(await guardedExchange({ url: 'https://store.example/a', rung: 'http' }, throwing)),
    ).toEqual(delivered('https://store.example/b'));
  });

  test('a transport that resolves to nothing is a network error, not a throw', async () => {
    const { net } = scripted({ dns: { 'store.example': [[PUBLIC]] }, replies: {} });
    const empty = { ...net, exchange: async () => null as unknown as Reply };
    expect(
      result(await guardedExchange({ url: 'https://store.example/', rung: 'http' }, empty)),
    ).toEqual(networkError('ERR_TRANSPORT'));
  });

  test('a loopback name with extra trailing dots is still refused without a lookup', async () => {
    const { net, lookups } = scripted({ dns: { 'localhost..': [[PUBLIC]] }, replies: {} });
    const r = await guardedExchange({ url: 'http://localhost../', rung: 'http' }, net);
    expect(r.delivered).toBe(false);
    expect(lookups).toEqual([]);
  });
});
