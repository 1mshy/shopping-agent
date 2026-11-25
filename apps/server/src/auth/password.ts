// The owner password (S§5.13): argon2id through Node's built-in `crypto.argon2`, kept as a PHC
// string. Node returns the raw tag bytes, so the string is built and parsed here:
//
//   $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<tag>
//
// salt and tag in standard base64 without padding (the PHC string format). The parameters travel
// with the hash, so they can be raised later: a verification uses the stored ones, and a successful
// login with weaker stored parameters rehashes under the current ones (service.ts).
//
// Nothing here logs, and no error carries the password, the salt or the tag.
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashable, normalizePassword } from './rules.ts';

export interface Argon2Params {
  /** Memory in KiB. */
  readonly memoryKiB: number;
  /** Passes over the memory (t). */
  readonly passes: number;
  /** Lanes (p). */
  readonly parallelism: number;
  /** Tag length in bytes. */
  readonly tagBytes: number;
  /** Salt length in bytes. */
  readonly saltBytes: number;
}

/**
 * The parameters new hashes use. OWASP's first argon2id recommendation (m = 19 MiB, t = 2, p = 1),
 * chosen for a small self-hosted box: a Raspberry Pi or a NAS with 1-2 GB of RAM shared with the
 * browser add-on. 19 MiB per hash keeps a burst of logins (which the throttle caps anyway) far from
 * the 150 MB idle and 400 MB search RSS budgets (S§5.14), while still costing an offline attacker
 * 19 MiB and two passes per guess. One lane, because the throttle, not latency, bounds the login
 * rate, and extra lanes only shorten the defender's wall time on multi-core boxes. RFC 9106's
 * defaults (64 MiB or 2 GiB) were judged too heavy for that hardware. Measured cost on the build
 * machine: see the report of unit P1-8a and test/auth/password.test.ts.
 */
export const ARGON2_PARAMS: Argon2Params = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  tagBytes: 32,
  saltBytes: 16,
};

/**
 * Bounds on parameters read back from a stored string. A row outside them is not verified at all,
 * so a tampered or corrupt database cannot make one login allocate gigabytes or spin for minutes.
 */
const STORED_LIMITS = {
  memoryKiB: { min: 8, max: 1_048_576 },
  passes: { min: 1, max: 16 },
  parallelism: { min: 1, max: 16 },
  tagBytes: { min: 16, max: 64 },
  saltBytes: { min: 8, max: 64 },
} as const;

/** argon2 version 1.3 (0x13), the only one Node implements. */
const VERSION = 19;

const PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export interface ParsedHash {
  readonly params: Argon2Params;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

function unb64(text: string): Buffer | null {
  // Unpadded base64: a length of 1 mod 4 cannot be produced by any byte string.
  if (text.length % 4 === 1) return null;
  const bytes = Buffer.from(text, 'base64');
  return b64(bytes) === text ? bytes : null;
}

function within(value: number, range: { min: number; max: number }): boolean {
  return Number.isSafeInteger(value) && value >= range.min && value <= range.max;
}

/** Builds the PHC string of one hash. */
export function formatPhc(params: Argon2Params, salt: Uint8Array, tag: Uint8Array): string {
  return `$argon2id$v=${VERSION}$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

/** Parses a stored PHC string; null when it is not an argon2id v19 string within the bounds. */
export function parsePhc(text: string): ParsedHash | null {
  const match = PHC.exec(text);
  if (match === null) return null;
  const [, v, m, t, p, saltText, tagText] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (Number(v) !== VERSION) return null;
  const salt = unb64(saltText);
  const tag = unb64(tagText);
  if (salt === null || tag === null) return null;
  const params: Argon2Params = {
    memoryKiB: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagBytes: tag.byteLength,
    saltBytes: salt.byteLength,
  };
  if (
    !within(params.memoryKiB, STORED_LIMITS.memoryKiB) ||
    !within(params.passes, STORED_LIMITS.passes) ||
    !within(params.parallelism, STORED_LIMITS.parallelism) ||
    !within(params.tagBytes, STORED_LIMITS.tagBytes) ||
    !within(params.saltBytes, STORED_LIMITS.saltBytes) ||
    params.memoryKiB < 8 * params.parallelism
  ) {
    return null;
  }
  return { params, salt, tag };
}

function derive(password: string, salt: Uint8Array, params: Argon2Params): Promise<Buffer> {
  // The callers check the length rules; this is the last line before argon2 sees the input.
  if (!hashable(password)) return Promise.reject(new Error('password too long to hash'));
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(normalizePassword(password), 'utf8'),
        nonce: salt,
        memory: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.tagBytes,
      },
      (error, tag) => {
        // Node's error names the failing parameter, never the message; it is replaced anyway.
        if (error) reject(new Error('argon2 failed'));
        else resolve(tag);
      },
    );
  });
}

/** Hashes a password into a PHC string under `params`, with a fresh random salt. */
export async function hashPassword(
  password: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<string> {
  const salt = randomBytes(params.saltBytes);
  const tag = await derive(password, salt, params);
  return formatPhc(params, salt, tag);
}

export interface Verification {
  readonly ok: boolean;
  /** True when the stored parameters differ from `current`, so a successful login rehashes. */
  readonly needsRehash: boolean;
}

/**
 * Verifies a password against a stored PHC string, in constant time over the tag. An unparseable or
 * out-of-bounds string verifies nothing.
 */
export async function verifyPassword(
  password: string,
  stored: string,
  current: Argon2Params = ARGON2_PARAMS,
): Promise<Verification> {
  const parsed = parsePhc(stored);
  if (parsed === null) return { ok: false, needsRehash: false };
  const tag = await derive(password, parsed.salt, parsed.params);
  const ok = tag.byteLength === parsed.tag.byteLength && timingSafeEqual(tag, parsed.tag);
  const p = parsed.params;
  const needsRehash =
    p.memoryKiB !== current.memoryKiB ||
    p.passes !== current.passes ||
    p.parallelism !== current.parallelism ||
    p.tagBytes !== current.tagBytes ||
    p.saltBytes !== current.saltBytes;
  return { ok, needsRehash };
}
