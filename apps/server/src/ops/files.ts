// Who may read the data directory's files (S§5.13). The database holds the owner's password hash,
// the sessions' token hashes and everything the app knows; its backups are copies of it. They are
// for the user the server runs as and nobody else on the machine. (The secrets key file is made
// owner-only where it is created, secrets/index.ts.)
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';

const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;

/**
 * Makes `dir` (and its parents) when missing, for the owner only. A directory that already exists
 * keeps its mode: someone may have opened it to a backup tool's group on purpose.
 */
export function ownerOnlyDir(dir: string): void {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR });
}

/** Sets a file owner-only; false where the file system does not take a mode. */
export function ownerOnlyFile(file: string): boolean {
  try {
    chmodSync(file, OWNER_ONLY_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Before the database is opened: a missing file is created empty and owner-only (an empty file is
 * a new SQLite database, and the WAL and shared-memory files SQLite makes beside it take the main
 * file's mode); an existing one, and its WAL files, are narrowed. False when a mode could not be
 * set (the caller says so once; the server still starts).
 */
export function prepareDatabaseFile(file: string): boolean {
  let ok = true;
  try {
    if (!existsSync(file)) closeSync(openSync(file, 'a', OWNER_ONLY_FILE));
  } catch {
    ok = false;
  }
  for (const path of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(path) && !ownerOnlyFile(path)) ok = false;
  }
  return ok;
}
