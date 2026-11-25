import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDefaultProfile, migrate, migrationLevel, openDatabase } from '../src/index.ts';

describe('openDatabase', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('opens a file in WAL mode with foreign keys on', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const db = openDatabase(join(dir, 'test.db'));
    try {
      expect(db.ping()).toBe(true);
      expect(db.orm.get<{ journal_mode: string }>(sql`pragma journal_mode`)).toEqual({
        journal_mode: 'wal',
      });
      expect(db.orm.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)).toEqual({
        foreign_keys: 1,
      });
    } finally {
      db.close();
    }
  });

  it('reports a closed database as down', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const db = openDatabase(join(dir, 'test.db'));
    db.close();
    expect(db.ping()).toBe(false);
  });

  it('backs up a live database with VACUUM INTO, and the copy opens at the same level', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const db = openDatabase(join(dir, 'live.db'));
    const copy = join(dir, 'backup.db');
    try {
      const { level } = migrate(db);
      ensureDefaultProfile(db);
      db.backupTo(copy);
      expect(existsSync(copy)).toBe(true);
      const restored = openDatabase(copy);
      try {
        expect(migrationLevel(restored)).toBe(level);
        expect(migrate(restored).applied).toEqual([]);
        expect(restored.orm.all<{ id: number }>(sql`select id from profile`)).toEqual([{ id: 1 }]);
      } finally {
        restored.close();
      }
    } finally {
      db.close();
    }
  });

  it('refuses to back up onto an existing file', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const db = openDatabase(join(dir, 'live.db'));
    const copy = join(dir, 'backup.db');
    writeFileSync(copy, 'not a database');
    try {
      expect(() => db.backupTo(copy)).toThrow();
    } finally {
      db.close();
    }
  });

  it('creates the default profile once', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const db = openDatabase(join(dir, 'test.db'));
    try {
      migrate(db);
      ensureDefaultProfile(db);
      ensureDefaultProfile(db);
      expect(db.orm.all<{ id: number }>(sql`select id from profile`)).toEqual([{ id: 1 }]);
    } finally {
      db.close();
    }
  });
});
