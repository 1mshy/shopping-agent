// From the auth review's finding 7: the database (the password hash is in it) and its backups
// were created readable by every local user; only the key file was owner-only.
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from '@agentic-dasher/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBackup } from '../../src/ops/backup.ts';
import { ownerOnlyDir, prepareDatabaseFile } from '../../src/ops/files.ts';

const mode = (path: string) => statSync(path).mode & 0o777;
const posix = process.platform !== 'win32';

describe.runIf(posix)('owner-only data files', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dasher-files-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('creates the data directory for the owner only, and leaves an existing one as it is', () => {
    const fresh = join(root, 'a', 'data');
    ownerOnlyDir(fresh);
    expect(mode(fresh)).toBe(0o700);

    const existing = join(root, 'existing');
    ownerOnlyDir(existing);
    // A directory someone made and opened up on purpose is not narrowed behind their back.
    chmodSync(existing, 0o750);
    ownerOnlyDir(existing);
    expect(mode(existing)).toBe(0o750);
  });

  it('a new database, its WAL files and a database that was world-readable end owner-only', () => {
    const file = join(root, 'agentic-dasher.db');
    expect(prepareDatabaseFile(file)).toBe(true);
    expect(mode(file)).toBe(0o600);
    const db = openDatabase(file);
    migrate(db);
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(file + suffix)) expect(mode(file + suffix), suffix).toBe(0o600);
    }
    db.close();

    const old = join(root, 'old.db');
    writeFileSync(old, '', { mode: 0o644 });
    writeFileSync(`${old}-wal`, '', { mode: 0o644 });
    expect(prepareDatabaseFile(old)).toBe(true);
    expect(mode(old)).toBe(0o600);
    expect(mode(`${old}-wal`)).toBe(0o600);
  });

  it('a backup and the directory made for it are owner-only', () => {
    const file = join(root, 'agentic-dasher.db');
    prepareDatabaseFile(file);
    const db = openDatabase(file);
    migrate(db);
    const dir = join(root, 'backups');
    const result = runBackup({ db, dir, now: () => Date.UTC(2026, 10, 25, 9, 0, 0) });
    db.close();
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, result.file))).toBe(0o600);
  });
});
