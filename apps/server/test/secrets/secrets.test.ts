// Secrets at rest (S§5.13): AES-256-GCM envelopes and the key from the environment or a 0600 file.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSecretBox,
  ENVELOPE_V1,
  KEY_FILE_NAME,
  loadOrCreateKey,
  SecretError,
} from '../../src/secrets/index.ts';

const SECRET = 'tk_live_7f3a9c0e5b2d4f6a8c1e3b5d7f9a0c2e';

describe('createSecretBox', () => {
  const box = createSecretBox(randomBytes(32));

  it('round-trips strings and bytes, with a fresh nonce per value', () => {
    const a = box.encrypt(SECRET);
    const b = box.encrypt(SECRET);
    expect(a[0]).toBe(ENVELOPE_V1);
    expect(a.equals(b)).toBe(false);
    expect(box.decryptString(a)).toBe(SECRET);
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    expect([...box.decrypt(box.encrypt(bytes))]).toEqual([0, 1, 2, 255]);
    expect(box.decryptString(box.encrypt(''))).toBe('');
  });

  it('never stores the plaintext in the envelope', () => {
    expect(box.encrypt(SECRET).includes(Buffer.from(SECRET))).toBe(false);
  });

  it('refuses a wrong key, a wrong context and a tampered value, without saying what was inside', () => {
    const envelope = box.encrypt(SECRET, 'channel:1:secret');
    const other = createSecretBox(randomBytes(32));
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    for (const act of [
      () => other.decrypt(envelope, 'channel:1:secret'),
      () => box.decrypt(envelope, 'channel:2:secret'),
      () => box.decrypt(envelope),
      () => box.decrypt(tampered, 'channel:1:secret'),
    ]) {
      let caught: unknown;
      try {
        act();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SecretError);
      expect((caught as SecretError).code).toBe('decrypt_failed');
      expect(String(caught)).not.toContain(SECRET);
    }
    expect(box.decryptString(envelope, 'channel:1:secret')).toBe(SECRET);
  });

  it('refuses an unknown envelope version and a short value', () => {
    const envelope = box.encrypt(SECRET);
    envelope[0] = 2;
    expect(() => box.decrypt(envelope)).toThrow(/not a secret envelope/);
    expect(() => box.decrypt(Buffer.from([1, 2, 3]))).toThrow(/not a secret envelope/);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createSecretBox(randomBytes(16))).toThrow(SecretError);
  });
});

describe('loadOrCreateKey', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dasher-secrets-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes SECRET_KEY when set, and writes no file', () => {
    const key = randomBytes(32);
    const loaded = loadOrCreateKey({ dataDir: dir, env: { SECRET_KEY: key.toString('base64') } });
    expect(loaded.source).toBe('env');
    expect(loaded.key.equals(key)).toBe(true);
    expect(() => statSync(join(dir, KEY_FILE_NAME))).toThrow();
  });

  it('refuses a malformed SECRET_KEY without echoing it', () => {
    const bad = 'not-a-key-but-a-secret-value';
    let message = '';
    try {
      loadOrCreateKey({ dataDir: dir, env: { SECRET_KEY: bad } });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/SECRET_KEY must be 32 bytes/);
    expect(message).not.toContain(bad);
    const short = randomBytes(16).toString('base64');
    expect(() => loadOrCreateKey({ dataDir: dir, env: { SECRET_KEY: short } })).toThrow(
      SecretError,
    );
  });

  it('creates a 0600 key file on first use and reads the same key afterwards', () => {
    const data = join(dir, 'data');
    const first = loadOrCreateKey({ dataDir: data, env: {} });
    expect(first.source).toBe('created');
    const file = join(data, KEY_FILE_NAME);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = loadOrCreateKey({ dataDir: data, env: { SECRET_KEY: '' } });
    expect(again.source).toBe('file');
    expect(again.key.equals(first.key)).toBe(true);
    // What one key encrypted, the reloaded key decrypts.
    const envelope = createSecretBox(first.key).encrypt(SECRET);
    expect(createSecretBox(again.key).decryptString(envelope)).toBe(SECRET);
  });

  it('tightens a key file readable by others to 0600', () => {
    const file = join(dir, KEY_FILE_NAME);
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o644 });
    loadOrCreateKey({ dataDir: dir });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses a damaged key file without printing its content', () => {
    const file = join(dir, KEY_FILE_NAME);
    writeFileSync(file, 'garbage-key-material', { mode: 0o600 });
    let message = '';
    try {
      loadOrCreateKey({ dataDir: dir });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/key file secret\.key must be 32 bytes/);
    expect(message).not.toContain('garbage-key-material');
    expect(readFileSync(file, 'utf8')).toBe('garbage-key-material');
  });
});
