// Secrets at rest (S§5.13): channel tokens, API keys and any other value the app must keep but
// never show. Authenticated encryption (AES-256-GCM, node:crypto) with a random 96-bit nonce per
// value, in a versioned envelope so the scheme can change without guessing what old bytes are:
//
//   byte 0      envelope version (1 = AES-256-GCM, 12-byte nonce, 16-byte tag)
//   bytes 1-12  nonce
//   bytes 13-28 GCM tag
//   bytes 29-   ciphertext
//
// An optional `context` (for example "channel:3:secret") is authenticated as associated data, so a
// value copied into another row or purpose fails to decrypt. The key is 32 bytes from SECRET_KEY
// (base64) or, without it, a key file in the data directory created on first use with owner-only
// permissions. No function here logs, and no error message carries a secret, a plaintext or a key.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENVELOPE_V1 = 1;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;

/** The key file's name inside the data directory. */
export const KEY_FILE_NAME = 'secret.key';

/** A failure of this module. Its message never contains a secret, a plaintext or key material. */
export class SecretError extends Error {
  override name = 'SecretError';
  readonly code: 'bad_key' | 'bad_envelope' | 'decrypt_failed' | 'key_file';
  constructor(code: SecretError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface SecretBox {
  /** Encrypts bytes or a UTF-8 string into a version-1 envelope. */
  encrypt(value: Uint8Array | string, context?: string): Buffer;
  /** Decrypts an envelope to its bytes. Throws SecretError on a wrong key, context or tampering. */
  decrypt(envelope: Uint8Array, context?: string): Buffer;
  /** Decrypts an envelope holding a UTF-8 string. */
  decryptString(envelope: Uint8Array, context?: string): string;
}

function checkKey(key: Uint8Array): Buffer {
  if (key.byteLength !== KEY_BYTES) {
    throw new SecretError('bad_key', `a secret key is ${KEY_BYTES} bytes`);
  }
  return Buffer.from(key);
}

/** The SecretBox for one key. The key is copied; the caller may wipe its own buffer. */
export function createSecretBox(key: Uint8Array): SecretBox {
  const k = checkKey(key);
  const aad = (context: string | undefined) => Buffer.from(context ?? '', 'utf8');

  function decrypt(envelope: Uint8Array, context?: string): Buffer {
    const buf = Buffer.from(envelope);
    if (buf.byteLength < HEADER_BYTES || buf[0] !== ENVELOPE_V1) {
      throw new SecretError('bad_envelope', 'not a secret envelope this build can read');
    }
    const nonce = buf.subarray(1, 1 + NONCE_BYTES);
    const tag = buf.subarray(1 + NONCE_BYTES, HEADER_BYTES);
    const body = buf.subarray(HEADER_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', k, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad(context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      // node:crypto's message says nothing secret, but it is replaced so none ever can.
      throw new SecretError(
        'decrypt_failed',
        'a stored secret could not be decrypted (wrong key, wrong context or a damaged value)',
      );
    }
  }

  return {
    encrypt(value, context) {
      const plain = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', k, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(context));
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([Buffer.from([ENVELOPE_V1]), nonce, cipher.getAuthTag(), body]);
    },
    decrypt,
    decryptString(envelope, context) {
      return decrypt(envelope, context).toString('utf8');
    },
  };
}

const BASE64_KEY = /^[A-Za-z0-9+/]{43}=?$/;

/** Reads a base64 32-byte key; the message of a refusal never repeats the value. */
export function parseKey(text: string, where: string): Buffer {
  const trimmed = text.trim();
  if (!BASE64_KEY.test(trimmed)) {
    throw new SecretError(
      'bad_key',
      `${where} must be ${KEY_BYTES} bytes in base64 (44 characters)`,
    );
  }
  const key = Buffer.from(trimmed, 'base64');
  if (key.byteLength !== KEY_BYTES) {
    throw new SecretError(
      'bad_key',
      `${where} must be ${KEY_BYTES} bytes in base64 (44 characters)`,
    );
  }
  return key;
}

export interface LoadKeyOptions {
  /** The data directory (DATA_DIR); the key file lives here when SECRET_KEY is not set. */
  readonly dataDir: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface LoadedKey {
  readonly key: Buffer;
  /** Where it came from, for Diagnostics (never the key itself). */
  readonly source: 'env' | 'file' | 'created';
}

/**
 * The secrets key: SECRET_KEY (base64, 32 bytes) when set, else `<dataDir>/secret.key`, created
 * on first use with mode 0600. An existing key file readable by group or others is tightened to
 * 0600. Losing the key loses every stored secret (they must be entered again), so the file belongs
 * on the data volume and in its backups' protection.
 */
export function loadOrCreateKey(options: LoadKeyOptions): LoadedKey {
  const fromEnv = options.env?.SECRET_KEY;
  if (fromEnv !== undefined && fromEnv !== '') {
    return { key: parseKey(fromEnv, 'SECRET_KEY'), source: 'env' };
  }
  mkdirSync(options.dataDir, { recursive: true });
  const file = join(options.dataDir, KEY_FILE_NAME);
  try {
    // `wx`: created only when absent, so two processes starting together cannot both write one.
    writeFileSync(file, `${randomBytes(KEY_BYTES).toString('base64')}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return { key: readKeyFile(file), source: 'created' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw new SecretError(
        'key_file',
        `the secret key file could not be created in the data directory (${errnoOf(error)})`,
      );
    }
  }
  return { key: readKeyFile(file), source: 'file' };
}

function errnoOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unknown error';
}

function readKeyFile(file: string): Buffer {
  let text: string;
  try {
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new SecretError('key_file', `the secret key file could not be read (${errnoOf(error)})`);
  }
  return parseKey(text, `the key file ${KEY_FILE_NAME}`);
}
