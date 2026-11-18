// The only module that imports better-sqlite3 (new-major dependency, S§3.3).
import BetterSqlite3 from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';

export interface Database {
  readonly orm: BetterSQLite3Database;
  /** Runs one or more parameterless SQL statements (migrations, transaction control). */
  exec(sqlText: string): void;
  /** Cheap liveness probe used by `/api/health`. */
  ping(): boolean;
  close(): void;
}

/**
 * Opens (creating if needed) the SQLite file with the pragmas the app relies on:
 * WAL for concurrent readers during writes, enforced foreign keys and a busy timeout
 * so the scheduler and request handlers do not fail on brief lock contention.
 */
export function openDatabase(file: string): Database {
  const sqlite = new BetterSqlite3(file);
  // First, so the switch to WAL waits on another process opening the same new file instead of
  // failing with SQLITE_BUSY.
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  // Connection settings, not schema: a PRAGMA inside a migration's transaction is a no-op. Foreign
  // keys are enforced by this setting, and migrate() runs foreign_key_check before it commits.
  sqlite.pragma('foreign_keys = ON');
  // A REPLACE then fires DELETE triggers on the rows it removes. A second line only: the guarded
  // tables also refuse a conflicting INSERT themselves (migrations/0001_initial.sql).
  sqlite.pragma('recursive_triggers = ON');

  const ping = sqlite.prepare('select 1 as ok');

  return {
    orm: drizzle({ client: sqlite }),
    exec(sqlText) {
      sqlite.exec(sqlText);
    },
    ping() {
      try {
        return (ping.get() as { ok: number } | undefined)?.ok === 1;
      } catch {
        return false;
      }
    },
    close() {
      sqlite.close();
    },
  };
}
