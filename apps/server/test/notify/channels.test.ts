// Channel management, the Test button, the routes and secrets at rest (S§5.11, S§5.13, S§5.15).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@agentic-dasher/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ChannelError,
  type ChannelService,
  createChannelService,
  createNotifyRoutes,
  recordEvent,
  runOutboxPass,
} from '../../src/notify/index.ts';
import type { SecretBox } from '../../src/secrets/index.ts';
import {
  deliveriesOf,
  eventsOf,
  FakeClock,
  FakeServer,
  PROFILE,
  refusedUrl,
  TempDb,
  testSecrets,
} from './harness.ts';

const TOKEN = 'tk_secret_ntfy_token_8c1e3b5d7f9a0c2e';
const HOOK_SECRET = 'whsec_secret_webhook_4d6f8a0c2e4b';

let tmp: TempDb;
let clock: FakeClock;
let secrets: SecretBox;
let channels: ChannelService;
let servers: FakeServer[];

beforeEach(() => {
  tmp = new TempDb();
  clock = new FakeClock();
  secrets = testSecrets();
  servers = [];
  channels = createChannelService({ db: tmp.db, secrets, now: clock.now });
});

afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  tmp.dispose();
});

async function server(script: ConstructorParameters<typeof FakeServer>[0] = []) {
  const s = await new FakeServer(script).start();
  servers.push(s);
  return s;
}

function thrown(act: () => unknown): unknown {
  try {
    act();
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

/** Every byte the database keeps on disk: the main file and its WAL. */
function databaseBytes(): Buffer {
  tmp.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  return Buffer.concat(
    readdirSync(tmp.dir)
      .filter((f) => f.startsWith('agentic-dasher.db'))
      .map((f) => readFileSync(join(tmp.dir, f))),
  );
}

describe('the channel service', () => {
  it('creates, lists, gets, updates, disables, enables and removes', () => {
    const created = channels.create(PROFILE, {
      type: 'ntfy',
      name: ' Phone ',
      config: { serverUrl: 'http://192.168.1.20:8090', topic: 'dasher', priority: 5 },
      secret: TOKEN,
    });
    expect(created).toMatchObject({
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: 'http://192.168.1.20:8090', topic: 'dasher', priority: 5 },
      hasSecret: true,
      enabled: true,
      createdAt: new Date(clock.ms).toISOString(),
    });
    const listed = channels.list(PROFILE);
    expect(listed.map((c) => c.type)).toEqual(['ntfy', 'in_app']);
    expect(channels.get(PROFILE, created.id)).toEqual(created);

    const renamed = channels.update(PROFILE, created.id, { name: 'Pixel', secret: null });
    expect(renamed).toMatchObject({ name: 'Pixel', hasSecret: false });
    expect(channels.update(PROFILE, created.id, { secret: TOKEN }).hasSecret).toBe(true);

    clock.advance(1000);
    expect(channels.setEnabled(PROFILE, created.id, false)).toMatchObject({
      enabled: false,
      disabledAt: new Date(clock.ms).toISOString(),
    });
    expect(channels.setEnabled(PROFILE, created.id, true)).toMatchObject({
      enabled: true,
      disabledAt: null,
    });
    const removed = channels.remove(PROFILE, created.id);
    expect(removed.removedAt).toBe(new Date(clock.ms).toISOString());
    expect(channels.list(PROFILE).map((c) => c.id)).not.toContain(created.id);
    expect(channels.list(PROFILE, { includeRemoved: true }).map((c) => c.id)).toContain(created.id);
    expect(
      (thrown(() => channels.update(PROFILE, created.id, { name: 'x' })) as ChannelError).code,
    ).toBe('removed');
  });

  it('validates each type and refuses what this build cannot send through', () => {
    const cases: [unknown, string][] = [
      [{ type: 'ntfy', name: 'a', config: { serverUrl: 'ftp://x', topic: 't' } }, 'invalid'],
      [
        { type: 'ntfy', name: 'a', config: { serverUrl: 'http://u:p@host', topic: 't' } },
        'invalid',
      ],
      [
        { type: 'ntfy', name: 'a', config: { serverUrl: 'http://h', topic: 'bad topic' } },
        'invalid',
      ],
      [
        { type: 'ntfy', name: 'a', config: { serverUrl: 'http://h', topic: 't', token: 'x' } },
        'invalid',
      ],
      [
        { type: 'webhook', name: 'a', config: { url: 'http://h', secretHeader: 'Content-Type' } },
        'invalid',
      ],
      [{ type: 'webhook', name: '', config: { url: 'http://h' } }, 'invalid'],
      [{ type: 'web_push', name: 'a', config: {} }, 'not_available'],
      [{ type: 'telegram', name: 'a', config: {} }, 'not_available'],
      [{ type: 'in_app', name: 'a', config: {} }, 'in_app_fixed'],
      [{ type: 'smoke_signal', name: 'a', config: {} }, 'invalid'],
    ];
    for (const [input, code] of cases) {
      const error = thrown(() => channels.create(PROFILE, input as never));
      expect(error, JSON.stringify(input)).toBeInstanceOf(ChannelError);
      expect((error as ChannelError).code, JSON.stringify(input)).toBe(code);
    }
  });

  it('keeps the in-app channel always on', () => {
    const inApp = channels.list(PROFILE).find((c) => c.type === 'in_app');
    if (inApp === undefined) throw new Error('no in-app channel');
    for (const act of [
      () => channels.setEnabled(PROFILE, inApp.id, false),
      () => channels.remove(PROFILE, inApp.id),
      () => channels.update(PROFILE, inApp.id, { secret: 'x' }),
    ]) {
      expect((thrown(act) as ChannelError).code).toBe('in_app_fixed');
    }
    expect(channels.update(PROFILE, inApp.id, { name: 'Feed' }).name).toBe('Feed');
  });

  it('answers not_found for another profile’s channel', () => {
    const c = channels.create(PROFILE, { type: 'webhook', name: 'w', config: { url: 'http://h' } });
    expect((thrown(() => channels.get(2, c.id)) as ChannelError).code).toBe('not_found');
  });
});

describe('secrets never leave secret_enc', () => {
  it('are not in list or get output, config_json, any other column, or the file outside secret_enc', () => {
    const phone = channels.create(PROFILE, {
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: 'http://127.0.0.1:1', topic: 'dasher' },
      secret: TOKEN,
    });
    channels.create(PROFILE, {
      type: 'webhook',
      name: 'Hook',
      config: { url: 'http://127.0.0.1:1/hook' },
      secret: HOOK_SECRET,
    });
    const shown = JSON.stringify([channels.list(PROFILE), channels.get(PROFILE, phone.id)]);
    expect(shown).not.toContain(TOKEN);
    expect(shown).not.toContain(HOOK_SECRET);
    const rows = tmp.db.orm.select().from(schema.channel).all();
    for (const r of rows) {
      const { secretEnc, ...rest } = r;
      expect(JSON.stringify(rest)).not.toContain(TOKEN.slice(3, 20));
      expect(JSON.stringify(rest)).not.toContain(HOOK_SECRET.slice(6, 20));
    }
    const bytes = databaseBytes();
    expect(bytes.includes(Buffer.from(TOKEN))).toBe(false);
    expect(bytes.includes(Buffer.from(HOOK_SECRET))).toBe(false);
    // ...and it is there, encrypted, for the adapter.
    const stored = tmp.db.orm.all<{ n: number }>(
      sql`select count(*) as n from channel where secret_enc is not null`,
    );
    expect(stored[0]?.n).toBe(2);
  });

  it('are not in a thrown error, even when the value itself is refused', () => {
    const bad = 'tk with spaces is refused';
    const error = thrown(() =>
      channels.create(PROFILE, {
        type: 'ntfy',
        name: 'Phone',
        config: { serverUrl: 'http://h', topic: 't' },
        secret: bad,
      }),
    ) as ChannelError;
    expect(error.code).toBe('invalid');
    expect(error.fields).toEqual(['secret']);
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(bad);
  });

  it('are redacted from what a channel answered, and from an outcome', async () => {
    const leaky = await server([{ status: 401, body: 'echo-auth' }]);
    const phone = channels.create(PROFILE, {
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: leaky.url, topic: 'dasher' },
      secret: TOKEN,
    });
    const outcome = await channels.test(PROFILE, phone.id);
    expect(leaky.received[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(outcome.errorClass).toBe('auth');
    expect(outcome.detail).toContain('[redacted]');
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });

  it('are not passed to an error handler or a pass result', async () => {
    const leaky = await server([{ status: 400, body: 'echo-auth' }]);
    channels.create(PROFILE, {
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: leaky.url, topic: 'dasher' },
      secret: TOKEN,
    });
    recordEvent(tmp.db, {
      profileId: PROFILE,
      now: clock.now,
      event: { kind: 'system', key: 'system:1', text: 'hello' },
    });
    const seen: unknown[] = [];
    const result = await runOutboxPass({
      db: tmp.db,
      secrets,
      now: clock.now,
      sleep: clock.sleep,
      onError: (e) => seen.push(e),
      report: (p) => seen.push(p),
    });
    expect(result.failed).toBe(1);
    expect(JSON.stringify([result, seen.map(String), seen])).not.toContain(TOKEN);
  });
});

describe('the Test button', () => {
  it('sends one labelled message straight through the adapter and writes nothing', async () => {
    const s = await server();
    const hook = channels.create(PROFILE, {
      type: 'webhook',
      name: 'Hook',
      config: { url: `${s.url}/in` },
      secret: HOOK_SECRET,
    });
    channels.setEnabled(PROFILE, hook.id, false); // a disabled channel can be tested before use
    const before = JSON.stringify([eventsOf(tmp.db), deliveriesOf(tmp.db), channels.list(PROFILE)]);
    const outcome = await channels.test(PROFILE, hook.id);
    expect(outcome).toEqual({ attempt: { kind: 'accepted' }, errorClass: null, detail: null });
    expect(s.received).toHaveLength(1);
    const body = JSON.parse(s.received[0]?.body ?? '');
    expect(body).toMatchObject({
      test: true,
      title: 'Agentic Dasher test',
      alert: null,
      url: null,
    });
    expect(body.text).toMatch(/test message .* "Hook"/);
    expect(s.received[0]?.headers['x-agentic-dasher-secret']).toBe(HOOK_SECRET);
    expect(JSON.stringify([eventsOf(tmp.db), deliveriesOf(tmp.db), channels.list(PROFILE)])).toBe(
      before,
    );
  });

  it('returns a typed failure: status, Retry-After, error class; never retried', async () => {
    const s = await server([{ status: 503, headers: { 'retry-after': '120' } }]);
    const phone = channels.create(PROFILE, {
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: s.url, topic: 'dasher' },
    });
    const outcome = await channels.test(PROFILE, phone.id);
    expect(outcome).toEqual({
      attempt: { kind: 'http_status', status: 503, retryAfter: '120' },
      errorClass: 'server',
      detail: 'HTTP 503',
    });
    expect(s.received).toHaveLength(1);
  });

  it('does not follow a redirect (a target cannot bounce the token elsewhere)', async () => {
    const elsewhere = await server();
    const s = await server([{ status: 302, headers: { location: `${elsewhere.url}/steal` } }]);
    const phone = channels.create(PROFILE, {
      type: 'ntfy',
      name: 'Phone',
      config: { serverUrl: s.url, topic: 'dasher' },
      secret: TOKEN,
    });
    const outcome = await channels.test(PROFILE, phone.id);
    expect(outcome).toMatchObject({
      attempt: { kind: 'http_status', status: 302 },
      errorClass: 'redirect',
    });
    expect(elsewhere.received).toHaveLength(0);
  });

  it('classifies a refused connection and a timeout as transport errors', async () => {
    const slow = await server([
      { status: 200, before: () => new Promise((r) => setTimeout(r, 300)) },
    ]);
    const quick = createChannelService({
      db: tmp.db,
      secrets,
      now: clock.now,
      requestTimeoutMs: 50,
    });
    const phone = quick.create(PROFILE, {
      type: 'ntfy',
      name: 'Slow',
      config: { serverUrl: slow.url, topic: 'dasher' },
    });
    expect((await quick.test(PROFILE, phone.id)).attempt).toEqual({
      kind: 'transport_error',
      cause: 'timeout',
    });
    const dead = channels.create(PROFILE, {
      type: 'webhook',
      name: 'Dead',
      config: { url: await refusedUrl() },
    });
    expect((await channels.test(PROFILE, dead.id)).attempt).toEqual({
      kind: 'transport_error',
      cause: 'connect',
    });
  });
});

describe('the routes', () => {
  const app = () => createNotifyRoutes({ channels });
  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('create, list, get, patch, disable, enable, test and delete, never showing a secret', async () => {
    const s = await server();
    const a = app();
    const created = await a.request(
      '/channels',
      json({
        type: 'ntfy',
        name: 'Phone',
        config: { serverUrl: s.url, topic: 'x' },
        secret: TOKEN,
      }),
    );
    expect(created.status).toBe(201);
    const { channel } = (await created.json()) as { channel: { id: number; hasSecret: boolean } };
    expect(channel.hasSecret).toBe(true);
    const texts: string[] = [];
    const call = async (path: string, init?: RequestInit) => {
      const res = await a.request(path, init);
      texts.push(await res.clone().text());
      return res;
    };
    expect((await call('/channels')).status).toBe(200);
    expect((await call(`/channels/${channel.id}`)).status).toBe(200);
    const patched = await call(`/channels/${channel.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pixel' }),
    });
    expect(((await patched.json()) as { channel: { name: string } }).channel.name).toBe('Pixel');
    expect((await call(`/channels/${channel.id}/disable`, { method: 'POST' })).status).toBe(200);
    expect((await call(`/channels/${channel.id}/enable`, { method: 'POST' })).status).toBe(200);
    const tested = await call(`/channels/${channel.id}/test`, { method: 'POST' });
    expect(await tested.json()).toEqual({
      outcome: { attempt: { kind: 'accepted' }, errorClass: null, detail: null },
    });
    expect((await call(`/channels/${channel.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(texts.join('\n')).not.toContain(TOKEN);
  });

  it('answers refusals with a code and the failing fields, never the submitted secret', async () => {
    const a = app();
    const bad = await a.request(
      '/channels',
      json({
        type: 'ntfy',
        name: 'P',
        config: { serverUrl: 'nope', topic: 'x' },
        secret: 'has space',
      }),
    );
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; fields: string[] } };
    expect(body.error.code).toBe('invalid');
    expect(body.error.fields).toEqual(['secret']);
    expect(JSON.stringify(body)).not.toContain('has space');
    const badConfig = await a.request(
      '/channels',
      json({ type: 'ntfy', name: 'P', config: { serverUrl: 'nope', topic: 'x' } }),
    );
    expect(((await badConfig.json()) as { error: { fields: string[] } }).error.fields).toEqual([
      'config.serverUrl',
    ]);
    expect((await a.request('/channels', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await a.request('/channels/999')).status).toBe(404);
    expect((await a.request('/channels/abc')).status).toBe(404);
    expect((await a.request('/channels', json({ type: 'discord', name: 'D' }))).status).toBe(409);
  });
});
