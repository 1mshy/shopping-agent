import { beforeEach, expect, it, vi } from 'vitest';
import {
  bindReaderGet,
  CookieJars,
  classifyResponse,
  createFetcher,
  createHttpNetwork,
  createRequestBudget,
  memoryPacingStore,
  memoryPlaybookStore,
} from '../../src/index.ts';
import { PinningProxy } from '../../src/transport/socks-proxy.ts';

const wire = vi.hoisted(() => vi.fn<(url: string, init: RequestInit) => Promise<Response>>());
vi.mock('impit', () => ({
  Impit: class {
    fetch = wire;
  },
}));
const origin = 'https://shop.example';
const endpoint = `${origin}/api/ucp/mcp`;
const robots = `${origin}/robots.txt`;
const catalogSearch = { query: 'coffee', country: 'CA', currency: 'CAD', language: 'en-CA' };
beforeEach(() => {
  wire.mockReset();
});
function setup(robotsText: string, reply: Response) {
  let instant = 0;
  const now = () => instant;
  const proxy = new PinningProxy();
  vi.spyOn(proxy, 'allow').mockResolvedValue({
    state: 'connected',
    failure: undefined,
    proxyUrl: 'socks5h://in-process',
    close() {},
  });
  const lookup = vi.fn(async () => ['93.184.216.34']);
  const network = createHttpNetwork({ proxy, resolver: { lookup }, now });
  const starts: number[] = [];
  wire.mockImplementation(async (url) => {
    starts.push(now());
    if (url === robots)
      return new Response(robotsText, { headers: { 'content-type': 'text/plain' } });
    if (url !== endpoint) throw Error('unscripted URL');
    return reply;
  });
  const jars = new CookieJars();
  jars.jar('shop.example').store(['saved=old; Path=/'], origin, now());
  const fetcher = createFetcher({
    network,
    jars,
    pacing: memoryPacingStore(),
    playbook: memoryPlaybookStore(),
    classify: classifyResponse,
    robotsMode: () => 'respect',
    now,
    sleep: async (ms) => {
      instant += ms;
    },
    random: () => 0.5,
  });
  const binding = {
    deadline: 30_000,
    signal: new AbortController().signal,
    pageKind: 'search' as const,
  };
  const get = bindReaderGet(fetcher, binding);
  return {
    fetcher,
    binding,
    lookup,
    jars,
    starts,
    run: () => get({ url: endpoint, rung: 'api', catalogSearch }),
  };
}
it('sends one paced anonymous search POST after the robots GET and uses only the fixed RPC shape', async () => {
  const s = setup(
    'User-agent: *\nAllow: /',
    new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json', 'set-cookie': 'learned=new; Path=/' },
    }),
  );
  expect((await s.run()).outcome.kind).toBe('ok');
  expect(wire.mock.calls.map(([u, o]) => [u, o.method])).toEqual([
    [robots, 'GET'],
    [endpoint, 'POST'],
  ]);
  const first = wire.mock.calls[0]?.[1];
  const second = wire.mock.calls[1]?.[1];
  expect(first?.body).toBeUndefined();
  for (const call of [first, second]) expect(new Headers(call?.headers).get('cookie')).toBeNull();
  expect(new Headers(second?.headers).get('content-type')).toBe('application/json');
  expect(new Headers(second?.headers).get('accept')).toBe('application/json, text/event-stream');
  expect(JSON.parse(String(second?.body))).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'search_catalog',
      arguments: {
        meta: {
          'ucp-agent': {
            profile:
              'https://cdn.jsdelivr.net/gh/1mshy/shopping-agent@agent-profile-v1/lab/catalog/agent-profile.json',
          },
        },
        catalog: {
          query: 'coffee',
          context: { address_country: 'CA', currency: 'CAD', language: 'en-CA' },
          pagination: { limit: 10 },
        },
      },
    },
  });
  expect(s.starts[1]).toBeGreaterThan(2000);
  expect(s.jars.jar('shop.example').header(endpoint, 30000)).toBe('saved=old');
});
it('honors a robots refusal without sending catalog arguments', async () => {
  const s = setup('User-agent: *\nDisallow: /api/ucp/', new Response('{}'));
  expect((await s.run()).outcome).toMatchObject({ kind: 'refused_by_policy', reason: 'robots' });
  expect(wire.mock.calls.map(([u]) => u)).toEqual([robots]);
});
it('never replays a redirected catalog search, and keeps a terminal typed wall', async () => {
  const s = setup(
    'User-agent: *\nAllow: /',
    new Response(null, {
      status: 307,
      headers: { location: 'https://elsewhere.example/api/ucp/mcp', 'cf-mitigated': 'challenge' },
    }),
  );
  expect((await s.run()).outcome).toMatchObject({ kind: 'wall' });
  expect(wire.mock.calls.map(([u]) => u)).toEqual([robots, endpoint]);
});
it('keeps ordinary redirects terminal and checks the wire budget including robots', async () => {
  const s = setup(
    'User-agent: *\nAllow: /',
    new Response(null, {
      status: 307,
      headers: { location: 'https://elsewhere.example/api/ucp/mcp' },
    }),
  );
  const result = await s.fetcher.get({
    ...s.binding,
    pageKind: 'api',
    url: endpoint,
    rung: 'api',
    catalogSearch,
    wireBudget: createRequestBudget(1),
  });
  expect(result.outcome).toMatchObject({ kind: 'refused_by_policy', reason: 'budget' });
  expect((await s.run()).outcome).toMatchObject({ kind: 'network_error', code: 'HTTP_307' });
  expect(wire.mock.calls.map(([u]) => u)).toEqual([robots, endpoint]);
});
it('refuses an oversized stream even when the caller asks for a larger response', async () => {
  const s = setup('User-agent: *\nAllow: /', new Response('a'.repeat(512 * 1024 + 1)));
  expect(
    (
      await s.fetcher.get({
        ...s.binding,
        pageKind: 'api',
        url: endpoint,
        rung: 'api',
        catalogSearch,
        maxBodyBytes: 4 * 1024 * 1024,
      })
    ).outcome,
  ).toMatchObject({ kind: 'refused_by_policy', reason: 'body_size' });
});
it('rejects invalid search inputs before robots or transport', async () => {
  const s = setup('', new Response('{}'));
  for (const change of [
    { url: `${origin}/wrong` },
    { rung: 'http' as const },
    { catalogSearch: { ...catalogSearch, query: 'a'.repeat(513) } },
  ]) {
    await expect(
      s.fetcher.get({
        ...s.binding,
        pageKind: 'api',
        url: endpoint,
        rung: 'api',
        catalogSearch,
        ...change,
      }),
    ).rejects.toThrow();
  }
  expect(wire).not.toHaveBeenCalled();
  expect(s.lookup).not.toHaveBeenCalled();
});
