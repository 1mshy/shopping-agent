import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/index.ts';

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
});
