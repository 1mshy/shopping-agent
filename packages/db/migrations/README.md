# Migrations

Hand-written, versioned SQL (S§4), applied in order at start-up by `migrate()` in `src/migrate.ts`.

- **Never generated from the Drizzle definitions.** `src/schema/` types queries and does not hold the CHECK constraints, the triggers or `STRICT`; a migration generated from it (drizzle-kit or otherwise) would silently drop them. `test/schema.test.ts` compares the two for columns, keys and indexes only, and separately checks that the migrated database still has every table STRICT and every named CHECK and trigger.
- **A released file never changes.** The runner records each migration's SHA-256 and refuses a database whose recorded migration differs. A change is a new file.
- **Names:** `NNNN_snake_case.sql`, numbered from `0001` with no gaps.
- **Line endings stay LF** (`.gitattributes`: `*.sql text eol=lf`). The checksum is over the bytes, so a CRLF checkout would read as a changed migration.
- **No transaction control** in a file: the runner wraps all pending migrations in one transaction. PRAGMAs are no-ops inside it; foreign keys are enforced by the connection settings (`src/open.ts`) and checked with `foreign_key_check` before the commit.
- **After adding or editing a file**, run `pnpm --filter @agentic-dasher/db migrations:embed` to regenerate `src/migrations.ts` (the bundled server carries the SQL as a module). A test fails when the module and the files differ.
- **Adding a column later:** a nullable column is a plain `ALTER TABLE … ADD COLUMN`. A NOT NULL column without a default, a new CHECK or a changed one needs a table rebuild (SQLite's twelve-step procedure), so decide nullability with that in mind.
- **A CHECK on an added column** may name other columns of the row (SQLite treats a column CHECK as a table CHECK), and `ADD COLUMN` tests it against every existing row, failing the migration if one breaks it (then SQLite reports `CHECK constraint failed` without the constraint's name). So a rule over several new columns goes on the last of them, as in `0002_phase1_state.sql`. Its text lands in the table's `CREATE` statement, where the structural tests in `test/schema.test.ts` see it.
- **Changing an index of a released migration** is a `DROP INDEX` and `CREATE INDEX` in a new file (0002 replaced `notification_event_watch_idx`).
