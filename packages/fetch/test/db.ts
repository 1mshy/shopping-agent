// A migrated SQLite database in a temporary file, for the store tests. Reopening the same file is
// how a restart is simulated.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Database, migrate, openDatabase } from '@agentic-dasher/db';

export interface TempDatabase {
  readonly file: string;
  /** Opens the file (migrating it on first open); every handle is closed by `dispose`. */
  open(): Database;
  dispose(): void;
}

export function tempDatabase(): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-store-'));
  const file = join(dir, 'app.db');
  const handles: Database[] = [];
  return {
    file,
    open() {
      const db = openDatabase(file);
      migrate(db);
      handles.push(db);
      return db;
    },
    dispose() {
      for (const db of handles) {
        try {
          db.close();
        } catch {
          // Already closed by the test.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
