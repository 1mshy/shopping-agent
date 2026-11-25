import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Database,
  ensureDefaultProfile,
  migrate,
  migrationLevel,
  openDatabase,
} from '@agentic-dasher/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_JOB_NAME, backupJob, runBackup } from '../../src/ops/backup.ts';

const at = (iso: string) => () => Date.parse(iso);

describe('runBackup', () => {
  let dir: string;
  let db: Database;
  let backups: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sa-backup-'));
    backups = join(dir, 'backups');
    db = openDatabase(join(dir, 'live.db'));
    migrate(db);
    ensureDefaultProfile(db);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a complete copy named by the UTC second, and the copy opens at the same level', () => {
    const result = runBackup({ db, dir: backups, now: at('2026-11-25T03:15:00.123Z') });
    expect(result.file).toBe('agentic-dasher-20261125T031500Z.db');
    expect(result.written).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.removed).toEqual([]);
    expect(readdirSync(backups)).toEqual(['agentic-dasher-20261125T031500Z.db']);

    const copy = openDatabase(join(backups, result.file));
    try {
      expect(migrationLevel(copy)).toBe(migrationLevel(db));
      expect(copy.orm.all<{ id: number }>(sql`select id from profile`)).toEqual([{ id: 1 }]);
    } finally {
      copy.close();
    }
  });

  it('keeps the newest copies and removes only older backups it named', () => {
    writeFileSync(join(dir, 'unrelated.db'), 'x');
    mkdtempSync(join(dir, 'x-'));
    for (const day of ['21', '22', '23', '24']) {
      runBackup({ db, dir: backups, now: at(`2026-11-${day}T03:15:00.000Z`), keep: 10 });
    }
    writeFileSync(join(backups, 'notes.txt'), 'kept');
    writeFileSync(join(backups, 'agentic-dasher-old.db'), 'kept: not a name this module writes');

    const result = runBackup({ db, dir: backups, now: at('2026-11-25T03:15:00.000Z'), keep: 2 });
    expect(result.removed).toEqual([
      'agentic-dasher-20261121T031500Z.db',
      'agentic-dasher-20261122T031500Z.db',
      'agentic-dasher-20261123T031500Z.db',
    ]);
    expect(readdirSync(backups).sort()).toEqual([
      'agentic-dasher-20261124T031500Z.db',
      'agentic-dasher-20261125T031500Z.db',
      'agentic-dasher-old.db',
      'notes.txt',
    ]);
  });

  it('removes a partial file left by an interrupted backup and never leaves one behind', () => {
    runBackup({ db, dir: backups, now: at('2026-11-24T03:15:00.000Z') });
    writeFileSync(join(backups, 'agentic-dasher-20261124T040000Z.db.partial'), 'truncated');
    runBackup({ db, dir: backups, now: at('2026-11-25T03:15:00.000Z') });
    expect(readdirSync(backups).sort()).toEqual([
      'agentic-dasher-20261124T031500Z.db',
      'agentic-dasher-20261125T031500Z.db',
    ]);
  });

  it('leaves an existing backup of the same second as it is', () => {
    const now = at('2026-11-25T03:15:00.000Z');
    const first = runBackup({ db, dir: backups, now });
    const second = runBackup({ db, dir: backups, now });
    expect(second).toEqual({ ...first, written: false });
    expect(readdirSync(backups)).toHaveLength(1);
  });

  it('refuses a keep below 1', () => {
    expect(() =>
      runBackup({ db, dir: backups, now: at('2026-11-25T03:15:00.000Z'), keep: 0 }),
    ).toThrow(RangeError);
  });

  it('is a daily scheduler job without a network gate', async () => {
    const job = backupJob({ db, dir: backups, now: at('2026-11-25T03:15:00.000Z') });
    expect(job).toMatchObject({ name: BACKUP_JOB_NAME, cron: '15 3 * * *', networkGate: false });
    expect(readdirSync(dir)).not.toContain('backups');
  });
});
