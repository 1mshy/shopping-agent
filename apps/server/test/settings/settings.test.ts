import { readFileSync } from 'node:fs';
import { schema } from '@agentic-dasher/db';
import { SettingsResponse } from '@agentic-dasher/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSecretBox } from '../../src/secrets/index.ts';
import {
  createSettingsService,
  defineSetting,
  SETTING_DEFINITIONS,
  SettingError,
} from '../../src/settings/index.ts';
import {
  call,
  type Harness,
  harness,
  setUp,
  TEMP_SECRET,
  TEST_KEY,
  TempDb,
} from '../auth/harness.ts';

let h: Harness | undefined;
let temp: TempDb | undefined;
afterEach(() => {
  h?.dispose();
  h = undefined;
  temp?.dispose();
  temp = undefined;
});

function service(env: Record<string, string> = {}) {
  temp = new TempDb();
  return createSettingsService({ db: temp.db, secrets: createSecretBox(TEST_KEY), env });
}

describe('the registry', () => {
  it('holds the Phase 1 settings in order, with their defaults and variables', () => {
    expect(SETTING_DEFINITIONS.map((d) => [d.key, d.default ?? null, d.env, d.secret])).toEqual([
      ['market.country', null, 'MARKET_COUNTRY', false],
      ['market.currency', null, 'MARKET_CURRENCY', false],
      ['market.language', null, 'MARKET_LANGUAGE', false],
      ['fetch.robots', 'ignore', 'FETCH_ROBOTS', false],
      ['auth.cookieSecure', 'auto', 'AUTH_COOKIE_SECURE', false],
      ['auth.trustProxy', false, 'AUTH_TRUST_PROXY', false],
    ]);
  });

  it('refuses a malformed key or a default its schema refuses', () => {
    expect(() => defineSetting({ key: 'nodot', schema: z.string(), description: '' })).toThrow();
    expect(() =>
      defineSetting({ key: 'a.b', schema: z.string(), default: 3 as never, description: '' }),
    ).toThrow();
  });
});

describe('sources: default, then env, then db, then delete', () => {
  it('walks fetch.robots through every source', () => {
    temp = new TempDb();
    const secrets = createSecretBox(TEST_KEY);
    const noEnv = createSettingsService({ db: temp.db, secrets, env: {} });
    expect(noEnv.get('fetch.robots')).toBe('ignore');
    expect(noEnv.view('fetch.robots')).toMatchObject({ source: 'default', value: 'ignore' });

    const settings = createSettingsService({
      db: temp.db,
      secrets,
      env: { FETCH_ROBOTS: 'report' },
    });
    expect(settings.view('fetch.robots')).toMatchObject({ source: 'env', value: 'report' });

    expect(settings.set('fetch.robots', 'respect')).toMatchObject({
      source: 'db',
      value: 'respect',
      isSet: true,
    });
    expect(settings.get('fetch.robots')).toBe('respect');
    const row = temp.db.orm
      .select()
      .from(schema.setting)
      .where(eq(schema.setting.key, 'fetch.robots'))
      .get();
    expect(row).toEqual({ key: 'fetch.robots', value: 'respect', valueEnc: null });

    expect(settings.reset('fetch.robots')).toMatchObject({ source: 'env', value: 'report' });
    expect(noEnv.view('fetch.robots')).toMatchObject({ source: 'default', value: 'ignore' });
  });

  it('reads a boolean from the environment as JSON text', () => {
    const settings = service({ AUTH_TRUST_PROXY: 'true' });
    expect(settings.get('auth.trustProxy')).toBe(true);
  });

  it('reports an invalid environment value without repeating it, and falls back', () => {
    const settings = service({ FETCH_ROBOTS: 'sometimes', MARKET_CURRENCY: 'usd' });
    expect(settings.view('fetch.robots')).toMatchObject({
      source: 'default',
      value: 'ignore',
      problem: 'env_invalid',
    });
    expect(settings.view('market.currency')).toMatchObject({
      isSet: false,
      source: null,
      problem: 'env_invalid',
    });
    expect(JSON.stringify(settings.list())).not.toContain('sometimes');
  });

  it('reports a database value its schema no longer accepts, and falls back', () => {
    const settings = service();
    temp?.db.orm.insert(schema.setting).values({ key: 'fetch.robots', value: 'never' }).run();
    expect(settings.view('fetch.robots')).toMatchObject({
      source: 'default',
      value: 'ignore',
      problem: 'db_invalid',
    });
  });
});

describe('market.currency', () => {
  it('has no value until one is set (no default currency, S§2.2)', () => {
    const settings = service();
    expect(settings.get('market.currency')).toBeUndefined();
    expect(settings.view('market.currency')).toEqual({
      key: 'market.currency',
      secret: false,
      isSet: false,
      source: null,
      value: null,
      env: 'MARKET_CURRENCY',
      problem: null,
    });
    expect(settings.set('market.currency', 'CAD')).toMatchObject({ source: 'db', value: 'CAD' });
    expect(settings.get('market.currency')).toBe('CAD');
    expect(settings.reset('market.currency')).toMatchObject({ isSet: false, source: null });
  });

  it('takes a value from the environment', () => {
    expect(service({ MARKET_CURRENCY: 'EUR' }).view('market.currency')).toMatchObject({
      source: 'env',
      value: 'EUR',
    });
  });
});

describe('validation', () => {
  it('refuses a value the schema refuses, naming the path only', () => {
    const settings = service();
    const refusals: [string, unknown][] = [
      ['market.currency', 'XAU'], // no minor unit
      ['market.currency', 'usd'],
      ['market.currency', 'unknown'],
      ['market.country', 'UK'],
      ['market.country', 'ZZ'],
      ['market.country', 'ca'],
      ['market.language', 'not a tag'],
      ['market.language', 'und'],
      ['fetch.robots', 'sometimes'],
      ['auth.trustProxy', 'yes'],
      ['auth.cookieSecure', 3],
      ['fetch.robots', null],
    ];
    for (const [key, value] of refusals) {
      let caught: unknown;
      try {
        settings.set(key, value);
      } catch (error) {
        caught = error;
      }
      expect(caught, `${key} = ${String(value)}`).toBeInstanceOf(SettingError);
      expect((caught as SettingError).code).toBe('invalid');
      expect((caught as SettingError).fields).toEqual(['value']);
      expect((caught as SettingError).message).not.toContain(String(value));
    }
    expect(temp?.db.orm.select().from(schema.setting).all()).toEqual([]);
  });

  it('stores the canonical form of a language tag', () => {
    const settings = service();
    expect(settings.set('market.language', 'fr-ca').value).toBe('fr-CA');
    expect(settings.set('market.country', 'CA').value).toBe('CA');
  });

  it('answers not_found for an unknown key', () => {
    const settings = service();
    expect(() => settings.set('no.such', 1)).toThrow(SettingError);
    expect(() => settings.reset('no.such')).toThrow(SettingError);
  });
});

const TEST_DEFINITIONS = [
  ...SETTING_DEFINITIONS,
  defineSetting({
    key: 'test.apiKey',
    schema: z.string().min(1),
    env: 'TEST_API_KEY',
    secret: true,
    description: 'a secret for the tests',
  }),
] as const;

describe('secret settings', () => {
  it('are encrypted under setting:<key> and never returned', () => {
    temp = new TempDb();
    const secrets = createSecretBox(TEST_KEY);
    const settings = createSettingsService({
      db: temp.db,
      secrets,
      env: {},
      definitions: TEST_DEFINITIONS,
    });
    expect(settings.view('test.apiKey')).toMatchObject({ secret: true, isSet: false, value: null });
    const view = settings.set('test.apiKey', TEMP_SECRET);
    expect(view).toEqual({
      key: 'test.apiKey',
      secret: true,
      isSet: true,
      source: 'db',
      value: null,
      env: 'TEST_API_KEY',
      problem: null,
    });
    expect(settings.get('test.apiKey')).toBe(TEMP_SECRET);

    const row = temp.db.orm
      .select()
      .from(schema.setting)
      .where(eq(schema.setting.key, 'test.apiKey'))
      .get();
    expect(row?.value).toBeNull();
    expect(row?.valueEnc).toBeInstanceOf(Buffer);
    expect(secrets.decryptString(row?.valueEnc ?? Buffer.alloc(0), 'setting:test.apiKey')).toBe(
      JSON.stringify(TEMP_SECRET),
    );
    temp.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    expect(readFileSync(temp.file).includes(Buffer.from(TEMP_SECRET))).toBe(false);
    expect(JSON.stringify(settings.list())).not.toContain(TEMP_SECRET);
  });

  it('do not decrypt under another key (a copied row is unreadable)', () => {
    temp = new TempDb();
    const secrets = createSecretBox(TEST_KEY);
    const twoSecrets = [
      ...TEST_DEFINITIONS,
      defineSetting({ key: 'test.other', schema: z.string(), secret: true, description: '' }),
    ] as const;
    const settings = createSettingsService({
      db: temp.db,
      secrets,
      env: {},
      definitions: twoSecrets,
    });
    settings.set('test.apiKey', TEMP_SECRET);
    const row = temp.db.orm
      .select()
      .from(schema.setting)
      .where(eq(schema.setting.key, 'test.apiKey'))
      .get();
    temp.db.orm
      .insert(schema.setting)
      .values({ key: 'test.other', value: null, valueEnc: row?.valueEnc ?? null })
      .run();
    expect(settings.view('test.other')).toMatchObject({
      isSet: false,
      problem: 'db_unreadable',
      value: null,
    });
    expect(settings.get('test.other')).toBeUndefined();
  });

  it('a secret from the environment says env and shows nothing', () => {
    temp = new TempDb();
    const settings = createSettingsService({
      db: temp.db,
      secrets: createSecretBox(TEST_KEY),
      env: { TEST_API_KEY: TEMP_SECRET },
      definitions: TEST_DEFINITIONS,
    });
    expect(settings.view('test.apiKey')).toMatchObject({ source: 'env', isSet: true, value: null });
  });

  it('a plaintext row under a secret key is never used or shown', () => {
    temp = new TempDb();
    temp.db.orm.insert(schema.setting).values({ key: 'test.apiKey', value: TEMP_SECRET }).run();
    const settings = createSettingsService({
      db: temp.db,
      secrets: createSecretBox(TEST_KEY),
      env: {},
      definitions: TEST_DEFINITIONS,
    });
    expect(settings.view('test.apiKey')).toMatchObject({ isSet: false, problem: 'db_invalid' });
  });
});

describe('the settings API', () => {
  it('lists every definition with value, source and secrecy', async () => {
    h = harness({ env: { FETCH_ROBOTS: 'report' } });
    const token = await setUp(h);
    const res = await call(h.app, '/api/settings', { cookie: token });
    expect(res.status).toBe(200);
    const body = SettingsResponse.parse(await res.json());
    expect(body.settings.map((s) => [s.key, s.source, s.value])).toEqual([
      ['market.country', null, null],
      ['market.currency', null, null],
      ['market.language', null, null],
      ['fetch.robots', 'env', 'report'],
      ['auth.cookieSecure', 'default', 'auto'],
      ['auth.trustProxy', 'default', false],
    ]);
  });

  it('PUT validates and stores; DELETE goes back to env or default', async () => {
    h = harness();
    const token = await setUp(h);
    const put = await call(h.app, '/api/settings/market.currency', {
      method: 'PUT',
      cookie: token,
      body: { value: 'JPY' },
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ setting: { source: 'db', value: 'JPY' } });

    const bad = await call(h.app, '/api/settings/market.currency', {
      method: 'PUT',
      cookie: token,
      body: { value: 'XXX' },
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: { code: string; fields: string[] } };
    expect(badBody.error).toMatchObject({ code: 'invalid', fields: ['value'] });
    expect(JSON.stringify(badBody)).not.toContain('XXX');

    const noValue = await call(h.app, '/api/settings/market.currency', {
      method: 'PUT',
      cookie: token,
      body: { other: 1 },
    });
    expect(noValue.status).toBe(400);

    const unknown = await call(h.app, '/api/settings/no.such', {
      method: 'PUT',
      cookie: token,
      body: { value: 1 },
    });
    expect(unknown.status).toBe(404);

    const del = await call(h.app, '/api/settings/market.currency', {
      method: 'DELETE',
      cookie: token,
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ setting: { isSet: false, source: null } });
  });

  it('never returns a secret', async () => {
    h = harness({ definitions: TEST_DEFINITIONS });
    const token = await setUp(h);
    const put = await call(h.app, '/api/settings/test.apiKey', {
      method: 'PUT',
      cookie: token,
      body: { value: TEMP_SECRET },
    });
    expect(put.status).toBe(200);
    expect(await put.text()).not.toContain(TEMP_SECRET);
    const list = await call(h.app, '/api/settings', { cookie: token });
    const text = await list.text();
    expect(text).not.toContain(TEMP_SECRET);
    expect(JSON.parse(text).settings.at(-1)).toMatchObject({ key: 'test.apiKey', isSet: true });
  });
});

describe('GET /api/setup', () => {
  it('reports the wizard steps: password, then locale once all three market settings exist', async () => {
    h = harness({ env: { MARKET_LANGUAGE: 'en-CA' } });
    let res = await call(h.app, '/api/setup');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ password: false, locale: false });

    const token = await setUp(h);
    // Once the owner exists, only a session reads it.
    expect((await call(h.app, '/api/setup')).status).toBe(401);
    res = await call(h.app, '/api/setup', { cookie: token });
    expect(await res.json()).toEqual({ password: true, locale: false });

    for (const [key, value] of [
      ['market.country', 'CA'],
      ['market.currency', 'CAD'],
    ]) {
      const put = await call(h.app, `/api/settings/${key}`, {
        method: 'PUT',
        cookie: token,
        body: { value },
      });
      expect(put.status).toBe(200);
    }
    res = await call(h.app, '/api/setup', { cookie: token });
    expect(await res.json()).toEqual({ password: true, locale: true });
  });
});
