import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROFILE_ID, schema } from '@agentic-dasher/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AuthService,
  createAuthService,
  createLoginThrottle,
  parsePhc,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_RENEW_AFTER_MS,
} from '../../src/auth/index.ts';
import { CHEAP, Clock, OTHER_PASSWORD, PASSWORD, TempDb } from './harness.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let temp: TempDb;
afterEach(() => temp?.dispose());

function service(clock = new Clock(), argon2 = CHEAP): { auth: AuthService; clock: Clock } {
  temp ??= new TempDb();
  return { auth: createAuthService({ db: temp.db, now: clock.now, argon2 }), clock };
}

function fresh() {
  temp = new TempDb();
  return service();
}

function sessions() {
  return temp.db.orm.select().from(schema.session).all();
}

function storedHash(): string | undefined {
  return temp.db.orm.select().from(schema.ownerPassword).get()?.passwordHash;
}

async function signedUp(auth: AuthService): Promise<string> {
  const result = await auth.setup(PASSWORD);
  if (result.kind !== 'created') throw new Error(result.kind);
  return result.token;
}

describe('setup', () => {
  it('sets the password once, as a PHC string, and opens a session', async () => {
    const { auth, clock } = fresh();
    expect(auth.passwordSet()).toBe(false);
    const result = await auth.setup(PASSWORD);
    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(auth.passwordSet()).toBe(true);

    const row = temp.db.orm.select().from(schema.ownerPassword).get();
    expect(row?.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(row?.setAt).toBe(new Date(clock.t).toISOString());
    expect(parsePhc(row?.passwordHash ?? '')?.params).toEqual(CHEAP);

    // The session row holds the token's SHA-256 only.
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [s] = sessions();
    expect(s?.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(s?.createdAt).toBe(new Date(clock.t).toISOString());
    expect(s?.expiresAt).toBe(new Date(clock.t + SESSION_IDLE_MS).toISOString());
    expect(auth.authenticate(result.token)).toEqual({ id: s?.id, profileId: DEFAULT_PROFILE_ID });
  });

  it('never twice: a second setup is already_set and changes nothing', async () => {
    const { auth } = fresh();
    await signedUp(auth);
    const before = storedHash();
    expect(await auth.setup(OTHER_PASSWORD)).toEqual({ kind: 'already_set' });
    expect(storedHash()).toBe(before);
    expect(sessions()).toHaveLength(1);
  });

  it('of two concurrent setups exactly one wins', async () => {
    const { auth } = fresh();
    const results = await Promise.all([auth.setup(PASSWORD), auth.setup(OTHER_PASSWORD)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['already_set', 'created']);
    expect(sessions()).toHaveLength(1);
    const winner = results[0]?.kind === 'created' ? PASSWORD : OTHER_PASSWORD;
    const loser = winner === PASSWORD ? OTHER_PASSWORD : PASSWORD;
    expect((await auth.login(winner, 'c')).kind).toBe('ok');
    expect((await auth.login(loser, 'c')).kind).toBe('invalid_credentials');
  });

  it('refuses a short password', async () => {
    const { auth } = fresh();
    expect(await auth.setup('short')).toEqual({ kind: 'invalid', reason: 'too_short' });
    expect(auth.passwordSet()).toBe(false);
  });
});

describe('login', () => {
  it('opens a session for the right password and refuses a wrong one', async () => {
    const { auth } = fresh();
    await signedUp(auth);
    const ok = await auth.login(PASSWORD, 'c');
    expect(ok.kind).toBe('ok');
    expect(await auth.login(OTHER_PASSWORD, 'c')).toEqual({ kind: 'invalid_credentials' });
    expect(await auth.login('', 'c')).toEqual({ kind: 'invalid_credentials' });
    expect(await auth.login('x'.repeat(10_000), 'c')).toEqual({ kind: 'invalid_credentials' });
    expect(sessions()).toHaveLength(2);
  });

  it('answers invalid_credentials before any password exists', async () => {
    const { auth } = fresh();
    expect(await auth.login(PASSWORD, 'c')).toEqual({ kind: 'invalid_credentials' });
  });

  it('is throttled, and a locked client is refused even with the right password', async () => {
    const { auth, clock } = fresh();
    await signedUp(auth);
    for (let i = 0; i < 6; i++) await auth.login(OTHER_PASSWORD, 'c');
    expect(await auth.login(PASSWORD, 'c')).toEqual({ kind: 'throttled', retryAfterMs: 1_000 });
    expect((await auth.login(PASSWORD, 'other-client')).kind).toBe('ok');
    clock.advance(1_000);
    expect((await auth.login(PASSWORD, 'c')).kind).toBe('ok');
  });

  it('rehashes under the current parameters after a successful login', async () => {
    temp = new TempDb();
    const clock = new Clock();
    const old = createAuthService({ db: temp.db, now: clock.now, argon2: CHEAP });
    await signedUp(old);
    const setAt = temp.db.orm.select().from(schema.ownerPassword).get()?.setAt;
    const raised = { ...CHEAP, memoryKiB: 128, passes: 2 };
    const current = createAuthService({ db: temp.db, now: clock.now, argon2: raised });
    expect((await current.login(OTHER_PASSWORD, 'c')).kind).toBe('invalid_credentials');
    expect(parsePhc(storedHash() ?? '')?.params).toEqual(CHEAP);
    expect((await current.login(PASSWORD, 'c')).kind).toBe('ok');
    expect(parsePhc(storedHash() ?? '')?.params).toEqual(raised);
    expect(temp.db.orm.select().from(schema.ownerPassword).get()?.setAt).toBe(setAt);
    expect((await current.login(PASSWORD, 'c')).kind).toBe('ok');
  });

  it('cleans up expired sessions', async () => {
    const { auth, clock } = fresh();
    await signedUp(auth);
    clock.advance(SESSION_IDLE_MS);
    await auth.login(PASSWORD, 'c');
    expect(sessions()).toHaveLength(1);
  });
});

describe('authenticate', () => {
  it('refuses an unknown, malformed or tampered token', async () => {
    const { auth } = fresh();
    const token = await signedUp(auth);
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [flipped, '', 'x', `${token}x`, token.toUpperCase(), 'A'.repeat(43)]) {
      expect(auth.authenticate(bad), bad).toBeNull();
    }
    // The stored hash is not a token either.
    expect(auth.authenticate(sessions()[0]?.tokenHash ?? '')).toBeNull();
    expect(auth.authenticate(token)).not.toBeNull();
  });

  it('expires an idle session and deletes its row', async () => {
    const { auth, clock } = fresh();
    const token = await signedUp(auth);
    clock.advance(SESSION_IDLE_MS - 1);
    expect(auth.authenticate(token)).not.toBeNull();
    clock.advance(SESSION_IDLE_MS);
    expect(auth.authenticate(token)).toBeNull();
    expect(sessions()).toHaveLength(0);
  });

  it('slides the idle window, written at most once an hour', async () => {
    const { auth, clock } = fresh();
    const token = await signedUp(auth);
    const created = clock.t;
    clock.advance(SESSION_RENEW_AFTER_MS / 2);
    auth.authenticate(token);
    expect(sessions()[0]?.lastSeenAt).toBe(new Date(created).toISOString());
    clock.advance(SESSION_RENEW_AFTER_MS / 2);
    auth.authenticate(token);
    expect(sessions()[0]?.lastSeenAt).toBe(new Date(clock.t).toISOString());
    expect(sessions()[0]?.expiresAt).toBe(new Date(clock.t + SESSION_IDLE_MS).toISOString());
    // Used every 13 days, it outlives the 14-day idle window …
    for (let day = 13; day < 88; day += 13) {
      clock.t = created + day * DAY;
      expect(auth.authenticate(token), `day ${day}`).not.toBeNull();
    }
    // … but never its 90 days from login.
    clock.t = created + SESSION_MAX_MS - 1;
    expect(auth.authenticate(token)).not.toBeNull();
    expect(sessions()[0]?.expiresAt).toBe(new Date(created + SESSION_MAX_MS).toISOString());
    clock.t = created + SESSION_MAX_MS;
    expect(auth.authenticate(token)).toBeNull();
  });

  it('sweepExpired deletes every expired row and only those', async () => {
    const { auth, clock } = fresh();
    await signedUp(auth);
    clock.advance(10 * DAY);
    await auth.login(PASSWORD, 'c');
    clock.advance(5 * DAY);
    expect(auth.sweepExpired()).toBe(1);
    expect(sessions()).toHaveLength(1);
  });
});

describe('logout and password change', () => {
  it('logout deletes the row', async () => {
    const { auth } = fresh();
    const token = await signedUp(auth);
    const session = auth.authenticate(token);
    if (session === null) throw new Error('no session');
    auth.logout(session.id);
    expect(auth.authenticate(token)).toBeNull();
    expect(sessions()).toHaveLength(0);
  });

  it('needs the current password and ends every other session', async () => {
    const { auth } = fresh();
    const first = await signedUp(auth);
    const second = await auth.login(PASSWORD, 'c');
    const third = await auth.login(PASSWORD, 'c');
    if (second.kind !== 'ok' || third.kind !== 'ok') throw new Error('login');
    const current = auth.authenticate(first);
    if (current === null) throw new Error('no session');

    expect(await auth.changePassword(current, OTHER_PASSWORD, OTHER_PASSWORD, 'c')).toEqual({
      kind: 'invalid_credentials',
    });
    expect(await auth.changePassword(current, PASSWORD, 'short', 'c')).toEqual({
      kind: 'invalid',
      reason: 'too_short',
    });
    expect(sessions()).toHaveLength(3);

    expect(await auth.changePassword(current, PASSWORD, OTHER_PASSWORD, 'c')).toEqual({
      kind: 'changed',
      endedSessions: 2,
    });
    expect(auth.authenticate(first)).not.toBeNull();
    expect(auth.authenticate(second.token)).toBeNull();
    expect(auth.authenticate(third.token)).toBeNull();
    expect((await auth.login(PASSWORD, 'd')).kind).toBe('invalid_credentials');
    expect((await auth.login(OTHER_PASSWORD, 'd')).kind).toBe('ok');
  });

  it('is throttled like login', async () => {
    temp = new TempDb();
    const clock = new Clock();
    const throttle = createLoginThrottle({ now: clock.now });
    const auth = createAuthService({ db: temp.db, now: clock.now, argon2: CHEAP, throttle });
    const token = await signedUp(auth);
    const current = auth.authenticate(token);
    if (current === null) throw new Error('no session');
    for (let i = 0; i < 6; i++) await auth.changePassword(current, OTHER_PASSWORD, PASSWORD, 'c');
    expect(await auth.changePassword(current, PASSWORD, OTHER_PASSWORD, 'c')).toEqual({
      kind: 'throttled',
      retryAfterMs: 1_000,
    });
  });
});

describe('what the database holds', () => {
  it('never the password or a token, only their hashes', async () => {
    const { auth } = fresh();
    const tokens = [await signedUp(auth)];
    const login = await auth.login(PASSWORD, 'c');
    if (login.kind === 'ok') tokens.push(login.token);
    temp.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const bytes = readFileSync(temp.file);
    expect(bytes.includes(Buffer.from(PASSWORD))).toBe(false);
    for (const token of tokens) expect(bytes.includes(Buffer.from(token))).toBe(false);
    const hash = storedHash() ?? '';
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(
      temp.db.orm
        .select()
        .from(schema.setting)
        .where(eq(schema.setting.key, 'owner_password'))
        .all(),
    ).toHaveLength(0);
  });
});
