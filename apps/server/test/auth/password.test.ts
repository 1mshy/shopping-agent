import { argon2Sync } from 'node:crypto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  ARGON2_PARAMS,
  checkNewPassword,
  formatPhc,
  hashable,
  hashPassword,
  parsePhc,
  verifyPassword,
} from '../../src/auth/index.ts';
import { CHEAP, PASSWORD } from './harness.ts';

describe('argon2id through node:crypto', () => {
  it('is RFC 9106 argon2id version 0x13, so the PHC string may say $argon2id$v=19', () => {
    // RFC 9106 section 5.3 test vector.
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('the PHC string', () => {
  it('is built from the parameters, salt and tag, and parses back', async () => {
    const phc = await hashPassword(PASSWORD, CHEAP);
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    const parsed = parsePhc(phc);
    expect(parsed?.params).toEqual(CHEAP);
    // The tag is the raw argon2id output for the normalised password and the stored salt.
    const again = argon2Sync('argon2id', {
      message: Buffer.from(PASSWORD, 'utf8'),
      nonce: parsed?.salt ?? Buffer.alloc(0),
      parallelism: 1,
      tagLength: 32,
      memory: 64,
      passes: 1,
    });
    expect(again.equals(parsed?.tag ?? Buffer.alloc(0))).toBe(true);
    expect(formatPhc(CHEAP, parsed?.salt ?? Buffer.alloc(0), again)).toBe(phc);
  });

  it('uses a fresh salt each time', async () => {
    expect(await hashPassword(PASSWORD, CHEAP)).not.toBe(await hashPassword(PASSWORD, CHEAP));
  });

  it('refuses strings that are not argon2id v19 or whose parameters are out of bounds', () => {
    const salt = 'c29tZXNhbHRzb21lc2FsdA';
    const tag = 'A'.repeat(43);
    for (const bad of [
      `$argon2i$v=19$m=64,t=1,p=1$${salt}$${tag}`,
      `$argon2id$v=16$m=64,t=1,p=1$${salt}$${tag}`,
      `$argon2id$v=19$m=4194304,t=1,p=1$${salt}$${tag}`, // 4 GiB
      `$argon2id$v=19$m=64,t=1000,p=1$${salt}$${tag}`,
      `$argon2id$v=19$m=64,t=1,p=64$${salt}$${tag}`,
      `$argon2id$v=19$m=64,t=1,p=1$${salt}$${tag}=`,
      `$argon2id$v=19$m=64,t=1,p=1$${salt}$AAAAA`, // 1 mod 4: no byte string encodes to it
      `$argon2id$v=19$m=64,t=1,p=1$c2FsdA$${tag}`, // 4-byte salt
      `$argon2id$v=19$m=64,t=1,p=1$${salt}`,
      'plaintext',
    ]) {
      expect(parsePhc(bad), bad).toBeNull();
    }
  });
});

describe('verifyPassword', () => {
  it('accepts the password and refuses another', async () => {
    const phc = await hashPassword(PASSWORD, CHEAP);
    expect(await verifyPassword(PASSWORD, phc, CHEAP)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword(`${PASSWORD}!`, phc, CHEAP)).ok).toBe(false);
    expect((await verifyPassword('', phc, CHEAP)).ok).toBe(false);
  });

  it('reads the parameters from the stored string and asks for a rehash when they differ', async () => {
    const old = await hashPassword(PASSWORD, CHEAP);
    const stronger = { ...CHEAP, memoryKiB: 128, passes: 2 };
    expect(await verifyPassword(PASSWORD, old, stronger)).toEqual({ ok: true, needsRehash: true });
  });

  it('verifies nothing against a damaged string', async () => {
    const phc = await hashPassword(PASSWORD, CHEAP);
    expect((await verifyPassword(PASSWORD, phc.replace('m=64', 'm=65'), CHEAP)).ok).toBe(false);
    expect((await verifyPassword(PASSWORD, `${phc.slice(0, -2)}AA`, CHEAP)).ok).toBe(false);
    expect((await verifyPassword(PASSWORD, 'garbage', CHEAP)).ok).toBe(false);
  });

  it('hashes the NFKC form, so two spellings of one password verify alike', async () => {
    const phc = await hashPassword('ｃｏｒｒｅｃｔ horse battery staple', CHEAP);
    expect((await verifyPassword('correct horse battery staple', phc, CHEAP)).ok).toBe(true);
  });
});

describe('the length rules', () => {
  it(`needs at least ${PASSWORD_MIN_LENGTH} and at most ${PASSWORD_MAX_LENGTH} characters`, () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(checkNewPassword('a'.repeat(14))).toBe('too_short');
    expect(checkNewPassword('a'.repeat(15))).toBeNull();
    expect(checkNewPassword('a'.repeat(256))).toBeNull();
    expect(checkNewPassword('a'.repeat(257))).toBe('too_long');
    expect(checkNewPassword('')).toBe('too_short');
  });

  it('counts code points, not UTF-16 units', () => {
    expect(checkNewPassword('🔑'.repeat(15))).toBeNull();
    expect(checkNewPassword('🔑'.repeat(14))).toBe('too_short');
    expect(checkNewPassword('🔑'.repeat(256))).toBeNull();
    expect(checkNewPassword('🔑'.repeat(257))).toBe('too_long');
  });

  it('refuses to hash an oversized input at all', async () => {
    expect(hashable('x'.repeat(1_000_000))).toBe(false);
    await expect(hashPassword('x'.repeat(1_000_000), CHEAP)).rejects.toThrow('too long');
  });
});

describe('the real parameters', () => {
  it('are argon2id m=19456 KiB, t=2, p=1, and one hash costs well over 1 ms and well under 1 s', async () => {
    expect(ARGON2_PARAMS).toEqual({
      memoryKiB: 19_456,
      passes: 2,
      parallelism: 1,
      tagBytes: 32,
      saltBytes: 16,
    });
    const started = performance.now();
    const phc = await hashPassword(PASSWORD, ARGON2_PARAMS);
    const hashMs = performance.now() - started;
    const verifyStarted = performance.now();
    const verdict = await verifyPassword(PASSWORD, phc);
    const verifyMs = performance.now() - verifyStarted;
    console.info(
      `argon2id m=19456 t=2 p=1: hash ${hashMs.toFixed(1)} ms, verify ${verifyMs.toFixed(1)} ms`,
    );
    expect(verdict).toEqual({ ok: true, needsRehash: false });
    expect(phc.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hashMs).toBeGreaterThan(2);
    expect(hashMs).toBeLessThan(1_000);
  });
});
