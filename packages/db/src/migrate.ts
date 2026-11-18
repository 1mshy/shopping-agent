// The migration runner: versioned SQL applied at start-up (S§3.3, S§5.14). Safe to run at every
// start: an up-to-date database is left as it is.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { MIGRATIONS } from './migrations.ts';
import type { Database } from './open.ts';

/**
 * One versioned SQL file (migrations/NNNN_name.sql). Once released it never changes. Its SQL must
 * not contain transaction control: the runner wraps all pending migrations in one transaction.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationReport {
  /** The highest applied version: the migration level that health reports (S§5.14). */
  readonly level: number;
  /** Versions applied by this call, in order; empty when the database was up to date. */
  readonly applied: readonly number[];
}

export type MigrationErrorCode =
  /** The database records a migration this build does not know: a newer build wrote it. */
  | 'ahead'
  /** A recorded migration's name or SQL differs from this build's. */
  | 'changed'
  /** A migration this build has is missing below the database's level. */
  | 'out_of_order'
  /** Rows violate a foreign key after the pending migrations ran. */
  | 'foreign_key'
  /** The list given to the runner is not numbered 1, 2, 3, … in order. */
  | 'invalid_list';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migration (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', applied_at) IS applied_at)
) STRICT;`;

function checksum(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function hasLedger(db: Database): boolean {
  const row = db.orm.get<{ n: number }>(
    sql`select count(*) as n from sqlite_schema where type = 'table' and name = 'schema_migration'`,
  );
  return (row?.n ?? 0) > 0;
}

/** The database's migration level: the highest applied version, 0 for a new database. */
export function migrationLevel(db: Database): number {
  if (!hasLedger(db)) return 0;
  return (
    db.orm.get<{ level: number | null }>(sql`select max(version) as level from schema_migration`)
      ?.level ?? 0
  );
}

function checkList(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    const previous = i === 0 ? 0 : (migrations[i - 1]?.version ?? 0);
    if (!Number.isSafeInteger(m.version) || m.version <= previous) {
      throw new MigrationError(
        'invalid_list',
        `migration ${m.name}: version ${m.version} does not follow ${previous}`,
      );
    }
  });
}

/**
 * Applies the pending migrations in order, in one transaction, and records each with a checksum
 * of its SQL. Refuses a database that is ahead of this build, one whose recorded migrations differ
 * from this build's, and a pending migration below the current level. Foreign-key enforcement is
 * off while migrations run (SQLite's procedure for table rebuilds) and every key is checked before
 * the commit.
 */
export function migrate(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationReport {
  checkList(migrations);
  const enforced =
    db.orm.get<{ foreign_keys: number }>(sql`pragma foreign_keys`)?.foreign_keys === 1;
  // PRAGMA foreign_keys is a no-op inside a transaction, so it is switched before BEGIN.
  if (enforced) db.exec('PRAGMA foreign_keys = OFF');
  try {
    // IMMEDIATE takes the write lock before the ledger is read, so two processes cannot both
    // decide to apply the same migration.
    db.exec('BEGIN IMMEDIATE');
    try {
      const report = applyPending(db, migrations);
      db.exec('COMMIT');
      return report;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite already rolled back (some errors end the transaction themselves).
      }
      throw error;
    }
  } finally {
    if (enforced) db.exec('PRAGMA foreign_keys = ON');
  }
}

function applyPending(db: Database, migrations: readonly Migration[]): MigrationReport {
  db.exec(LEDGER);
  const recorded = db.orm.all<{ version: number; name: string; checksum: string }>(
    sql`select version, name, checksum from schema_migration order by version`,
  );
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const r of recorded) {
    const m = known.get(r.version);
    if (m === undefined) {
      throw new MigrationError(
        'ahead',
        `the database has migration ${r.version} (${r.name}), which this build does not know; ` +
          'it was written by a newer build',
      );
    }
    if (m.name !== r.name || checksum(m.sql) !== r.checksum) {
      throw new MigrationError(
        'changed',
        `migration ${r.version} (${r.name}) differs from the one applied to this database`,
      );
    }
  }

  const level = recorded.at(-1)?.version ?? 0;
  const done = new Set(recorded.map((r) => r.version));
  const pending = migrations.filter((m) => !done.has(m.version));
  const early = pending.find((m) => m.version < level);
  if (early !== undefined) {
    throw new MigrationError(
      'out_of_order',
      `migration ${early.version} (${early.name}) is missing below level ${level}`,
    );
  }

  for (const m of pending) {
    db.exec(m.sql);
    db.orm.run(
      sql`insert into schema_migration (version, name, checksum, applied_at)
          values (${m.version}, ${m.name}, ${checksum(m.sql)}, ${new Date().toISOString()})`,
    );
  }
  if (pending.length > 0) {
    const violations = db.orm.all(sql`pragma foreign_key_check`);
    if (violations.length > 0) {
      throw new MigrationError(
        'foreign_key',
        `${violations.length} rows violate a foreign key after migrating`,
      );
    }
  }
  return { level: pending.at(-1)?.version ?? level, applied: pending.map((m) => m.version) };
}
