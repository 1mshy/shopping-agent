import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Database,
  MIGRATIONS,
  type Migration,
  MigrationError,
  migrate,
  migrationLevel,
  openDatabase,
} from '../src/index.ts';
import { tableNames } from './fixtures.ts';

const latest = MIGRATIONS.at(-1)?.version ?? 0;

const a: Migration = {
  version: 1,
  name: '0001_a',
  sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;',
};
const b: Migration = {
  version: 2,
  name: '0002_b',
  sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a (id)) STRICT;',
};
const c: Migration = {
  version: 3,
  name: '0003_c',
  sql: 'CREATE TABLE c (id INTEGER PRIMARY KEY) STRICT;',
};

function recorded(db: Database) {
  return db.orm.all<{ version: number; name: string }>(
    sql`select version, name from schema_migration order by version`,
  );
}

function schemaText(db: Database): string {
  return db.orm
    .all<{ sql: string | null }>(sql`select sql from sqlite_schema order by type, name`)
    .map((r) => r.sql)
    .join('\n');
}

function expectRefused(act: () => unknown, code: MigrationError['code']) {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).code).toBe(code);
    return;
  }
  expect.fail(`expected a MigrationError with code ${code}`);
}

describe('migrate', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('migrates a fresh database and reports the level', () => {
    const db = openDatabase(':memory:');
    expect(migrationLevel(db)).toBe(0);
    expect(migrate(db)).toEqual({ level: latest, applied: MIGRATIONS.map((m) => m.version) });
    expect(migrationLevel(db)).toBe(latest);
    expect(tableNames(db)).toContain('price_observation');
    expect(recorded(db).map((r) => r.name)).toEqual(MIGRATIONS.map((m) => m.name));
  });

  it('does nothing on a second run', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const before = { schema: schemaText(db), recorded: recorded(db) };
    expect(migrate(db)).toEqual({ level: latest, applied: [] });
    expect({ schema: schemaText(db), recorded: recorded(db) }).toEqual(before);
  });

  it('applies only the pending migrations, in order', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, [a])).toEqual({ level: 1, applied: [1] });
    expect(migrate(db, [a, b, c])).toEqual({ level: 3, applied: [2, 3] });
    expect(recorded(db)).toEqual([
      { version: 1, name: '0001_a' },
      { version: 2, name: '0002_b' },
      { version: 3, name: '0003_c' },
    ]);
  });

  it('applies the pending migrations in one transaction', () => {
    const db = openDatabase(':memory:');
    const broken: Migration = { version: 3, name: '0003_broken', sql: 'CREATE TABLE oops (' };
    expect(() => migrate(db, [a, b, broken])).toThrow();
    expect(migrationLevel(db)).toBe(0);
    expect(tableNames(db)).not.toContain('a');
  });

  it('refuses a database that is ahead of the code', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a, b]);
    const before = schemaText(db);
    expectRefused(() => migrate(db, [a]), 'ahead');
    expect(schemaText(db)).toBe(before);
    expect(migrationLevel(db)).toBe(2);
  });

  it('refuses a recorded migration whose SQL or name has changed', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a]);
    expectRefused(() => migrate(db, [{ ...a, sql: `${a.sql}\n` }]), 'changed');
    expectRefused(() => migrate(db, [{ ...a, name: '0001_renamed' }]), 'changed');
  });

  it('refuses a pending migration older than the level', () => {
    const db = openDatabase(':memory:');
    migrate(db, [a, c]);
    expectRefused(() => migrate(db, [a, b, c]), 'out_of_order');
  });

  it('refuses a list that is not strictly increasing', () => {
    const db = openDatabase(':memory:');
    expectRefused(() => migrate(db, [b, a]), 'invalid_list');
    expectRefused(() => migrate(db, [a, { ...a, name: '0001_again' }]), 'invalid_list');
    expectRefused(() => migrate(db, [{ ...a, version: 0 }]), 'invalid_list');
  });

  it('checks foreign keys before committing and leaves enforcement on', () => {
    const db = openDatabase(':memory:');
    const orphan: Migration = {
      version: 3,
      name: '0003_orphan',
      sql: 'INSERT INTO b (a_id) VALUES (42);',
    };
    expectRefused(() => migrate(db, [a, b, orphan]), 'foreign_key');
    expect(migrationLevel(db)).toBe(0);
    migrate(db, [a, b]);
    expect(db.orm.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)).toEqual({
      foreign_keys: 1,
    });
    expect(() => db.orm.run(sql`insert into b (a_id) values (42)`)).toThrow(/FOREIGN KEY/);
  });

  it('is safe at every start-up of a file database', () => {
    dir = mkdtempSync(join(tmpdir(), 'sa-db-'));
    const file = join(dir, 'agentic-dasher.db');
    const first = openDatabase(file);
    expect(migrate(first).applied).toEqual(MIGRATIONS.map((m) => m.version));
    first.close();
    const second = openDatabase(file);
    try {
      expect(migrate(second)).toEqual({ level: latest, applied: [] });
      expect(migrationLevel(second)).toBe(latest);
    } finally {
      second.close();
    }
  });
});

describe('MIGRATIONS', () => {
  // The SQL files are the versioned source (S§4); src/migrations.ts embeds them so the bundled
  // server needs no file beside it. Regenerate with `pnpm --filter @agentic-dasher/db migrations:embed`.
  it('embeds every file in migrations/ verbatim, numbered from 1', () => {
    const folder = join(import.meta.dirname, '..', 'migrations');
    const files = readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
      expect(m.name.startsWith(String(i + 1).padStart(4, '0'))).toBe(true);
      expect(m.sql).toBe(readFileSync(join(folder, `${m.name}.sql`), 'utf8'));
    });
  });
});
