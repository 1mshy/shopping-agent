import { schema } from '@agentic-dasher/db';
import {
  CookieJars,
  classifyResponse,
  createFetcher,
  memoryPacingStore,
  memoryPlaybookStore,
  type RobotsMode,
} from '@agentic-dasher/fetch';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type PageReply, scriptedNetwork } from '../../../../packages/fetch/test/page/net.ts';
import { createRdapTrust } from '../../src/directory/rdap.ts';
import { Clock, insertStore, TempDb } from '../sweep/harness.ts';

let tmp: TempDb;
beforeEach(() => {
  tmp = new TempDb();
});
afterEach(() => tmp.dispose());
const bootstrap = 'https://rdap.org';
const registry = 'https://registry.example';
const name = 'orchardtools.co.uk';
const bUrl = `${bootstrap}/domain/${name}`;
const rUrl = `${registry}/record/${name}`;
const date = '2017-06-15T12:00:00+02:00';
const record = (
  domain = name,
  events: unknown = [{ eventAction: 'registration', eventDate: date }],
) => ({
  ldhName: domain,
  objectClassName: 'domain',
  events,
  entities: [{ handle: 'private contact content' }],
});
const json = (payload: unknown, status = 200): PageReply => ({
  status,
  headers: [['content-type', 'application/rdap+json']],
  body: [JSON.stringify(payload)],
});
const robots = (text: string): PageReply => ({
  status: 200,
  headers: [['content-type', 'text/plain']],
  body: [text],
});
function setup(mode: RobotsMode = 'ignore') {
  const h = new Clock();
  const storeId = insertStore(tmp.db, { host: `shop.eu.${name}`, trustTier: 'caution' });
  tmp.db.orm
    .update(schema.store)
    .set({ trustReasons: ['owner reason'] })
    .where(eq(schema.store.id, storeId))
    .run();
  const replies: Record<string, PageReply> = {
    [bUrl]: {
      status: 302,
      headers: [
        ['location', rUrl],
        ['set-cookie', 'registrycookie=n; Path=/'],
      ],
    },
    [rUrl]: json(record()),
    [`${bootstrap}/robots.txt`]: robots('User-agent: *\nAllow: /'),
    [`${registry}/robots.txt`]: robots('User-agent: *\nAllow: /'),
  };
  const net = scriptedNetwork({
    dns: { 'rdap.org': ['93.184.216.34'], 'registry.example': ['93.184.216.35'] },
    replies,
  });
  const jars = new CookieJars();
  jars.jar('rdap.org').store(['private=personal; Path=/'], bUrl, h.now());
  jars.jar('registry.example').store(['private=personal; Path=/'], rUrl, h.now());
  const fetcher = createFetcher({
    network: net.network,
    jars,
    classify: classifyResponse,
    pacing: memoryPacingStore(),
    playbook: memoryPlaybookStore(),
    robotsMode: () => mode,
    now: h.now,
    random: () => 0.5,
    sleep: async (ms) => h.advance(ms),
  });
  const service = () => createRdapTrust({ db: tmp.db, fetcher, now: h.now });
  const request = () => ({ deadline: h.now() + 20_000, signal: new AbortController().signal });
  const row = () =>
    tmp.db.orm.select().from(schema.store).where(eq(schema.store.id, storeId)).get();
  const cache = () => tmp.db.orm.select().from(schema.domainRegistration).all();
  return { h, storeId, net, jars, fetcher, service, request, replies, row, cache };
}

it('queries only the registrable domain anonymously, checks each origin’s robots and reuses its date after restart', async () => {
  const s = setup('respect');
  await s.service().enrich(s.storeId, s.request());
  expect(s.net.hops.map((h) => h.url)).toEqual([
    `${bootstrap}/robots.txt`,
    bUrl,
    `${registry}/robots.txt`,
    rUrl,
  ]);
  expect(
    s.net.hops.every((h) => h.headers.every(([key]) => key !== 'cookie' && key !== 'referer')),
  ).toBe(true);
  expect(s.jars.jar('rdap.org').header(bUrl, s.h.now())).not.toContain('registrycookie');
  expect(s.cache()).toMatchObject([{ domain: name, registeredAt: '2017-06-15T10:00:00.000Z' }]);
  expect(s.row()).toMatchObject({
    trustTier: 'caution',
    trustReasons: ['owner reason', `RDAP lists ${name} as registered on 2017-06-15 (UTC)`],
  });
  tmp.db.close();
  tmp.db = TempDb.open(tmp.file);
  const other = insertStore(tmp.db, { host: `west.${name}`, trustTier: 'known' });
  s.h.advance(380 * 24 * 3600_000);
  await s.service().enrich(other, s.request());
  await s.service().enrich(s.storeId, s.request());
  expect(s.net.hops).toHaveLength(4);
  expect(s.cache()).toHaveLength(1);
  expect(s.row()?.trustReasons).toHaveLength(2);
});

it('respects registry robots after a bootstrap redirect', async () => {
  const s = setup('respect');
  s.replies[`${registry}/robots.txt`] = robots('User-agent: *\nDisallow: /record/');
  await s.service().enrich(s.storeId, s.request());
  expect(s.net.hops.map((h) => h.url)).toEqual([
    `${bootstrap}/robots.txt`,
    bUrl,
    `${registry}/robots.txt`,
  ]);
  expect(s.cache()).toEqual([]);
  expect(s.row()?.trustReasons).toEqual(['owner reason']);
});

it.each([
  [
    'missing registration event',
    json(record(name, [{ eventAction: 'last changed', eventDate: date }])),
    true,
  ],
  ['registry no record', json({ errorCode: 404 }, 404), true],
  ['different domain', json(record('another.co.uk')), false],
  [
    'unparseable date',
    json(record(name, [{ eventAction: 'registration', eventDate: 'soon' }])),
    false,
  ],
  [
    'conflicting dates',
    json(
      record(name, [
        { eventAction: 'registration', eventDate: date },
        { eventAction: 'registration', eventDate: '2019-02-01T00:00:00Z' },
      ]),
    ),
    false,
  ],
  ['temporary limit', { status: 429 }, false],
] as const)(
  'distinguishes %s from missing or unreliable data',
  async (_label, response, cached) => {
    const s = setup();
    s.replies[rUrl] = response;
    await s.service().enrich(s.storeId, s.request());
    expect(s.cache().map((r) => r.registeredAt)).toEqual(cached ? [null] : []);
    expect(s.row()?.trustTier).toBe('caution');
    expect(s.row()?.trustReasons).toEqual(
      cached
        ? ['owner reason', `RDAP provides no registration date for ${name}`]
        : ['owner reason'],
    );
  },
);

it('skips blocked stores, private hosting tenants, local names and IP addresses before DNS', async () => {
  const s = setup();
  const rdap = s.service();
  tmp.db.orm.update(schema.store).set({ trustTier: 'blocked' }).run();
  const ids = [
    s.storeId,
    ...['merchant.github.io', 'private.internal', '127.0.0.1'].map((host) =>
      insertStore(tmp.db, { host }),
    ),
  ];
  for (const id of ids) await rdap.enrich(id, s.request());
  expect(s.net.lookups).toEqual([]);
  expect(s.cache()).toEqual([]);
});

it('bounds physical exchanges in a sliding ten-second window across service instances and restart', async () => {
  const clock = new Clock();
  const hosts = Array.from({ length: 12 }, (_, i) => `orchard${i}.ca`);
  const ids = hosts.map((host) => insertStore(tmp.db, { host }));
  const replies: Record<string, PageReply> = {};
  for (const host of hosts) {
    const url = `${registry}/record/${host}`;
    replies[`${bootstrap}/domain/${host}`] = { status: 302, headers: [['location', url]] };
    replies[url] = json(record(host));
  }
  const net = scriptedNetwork({
    dns: { 'rdap.org': ['93.184.216.34'], 'registry.example': ['93.184.216.35'] },
    replies,
  });
  const run = (id: number) => {
    // Separate pacers mirror independent callers sharing a database. Each sees the
    // same wall clock; neither the bootstrap nor the registry advances it.
    const fetcher = createFetcher({
      network: net.network,
      jars: new CookieJars(),
      classify: classifyResponse,
      pacing: memoryPacingStore(),
      playbook: memoryPlaybookStore(),
      robotsMode: () => 'ignore',
      now: clock.now,
      sleep: async () => {},
    });
    return createRdapTrust({ db: tmp.db, fetcher, now: clock.now }).enrich(id, {
      deadline: clock.now() + 20000,
      signal: new AbortController().signal,
    });
  };
  await Promise.all(ids.slice(0, 8).map(run));
  expect(net.hops).toHaveLength(10);
  expect(tmp.db.orm.select().from(schema.rdapRequestStart).all()).toHaveLength(10);
  tmp.db.close();
  tmp.db = TempDb.open(tmp.file);
  clock.advance(9999);
  await run(ids[9] as number);
  expect(net.hops).toHaveLength(10);
  clock.advance(1);
  await run(ids[10] as number);
  expect(net.hops).toHaveLength(12);
});

it('stops a redirect chain within four exchanges', async () => {
  const s = setup();
  s.replies[rUrl] = { status: 302, headers: [['location', bUrl]] };
  await s.service().enrich(s.storeId, s.request());
  expect(s.net.hops.length).toBeLessThanOrEqual(4);
  expect(s.cache()).toEqual([]);
});

it('stops on a redirect the classifier identifies as a wall', async () => {
  const s = setup();
  s.replies[bUrl] = {
    status: 302,
    headers: [
      ['cf-mitigated', 'challenge'],
      ['location', rUrl],
    ],
  };
  await s.service().enrich(s.storeId, s.request());
  expect(s.net.hops.map((h) => h.url)).toEqual([bUrl]);
  expect(s.cache()).toEqual([]);
});
