# Migrations

Hand-written, versioned SQL (S§4), applied in order at start-up by `migrate()` in `src/migrate.ts`.

- **Never generated from the Drizzle definitions.** `src/schema/` types queries and does not hold the CHECK constraints, the triggers or `STRICT`; a migration generated from it (drizzle-kit or otherwise) would silently drop them. `test/schema.test.ts` compares the two for columns, keys and indexes only, and separately checks that the migrated database still has every table STRICT and every named CHECK and trigger.
- **A released file never changes.** The runner records each migration's SHA-256 and refuses a database whose recorded migration differs. A change is a new file.
- **Names:** `NNNN_snake_case.sql`, numbered from `0001` with no gaps.
- **Line endings stay LF** (`.gitattributes`: `*.sql text eol=lf`). The checksum is over the bytes, so a CRLF checkout would read as a changed migration.
- **No transaction control** in a file: the runner wraps all pending migrations in one transaction. PRAGMAs are no-ops inside it; foreign keys are enforced by the connection settings (`src/open.ts`) and checked with `foreign_key_check` before the commit.
- **After adding or editing a file**, run `pnpm --filter @agentic-dasher/db migrations:embed` to regenerate `src/migrations.ts` (the bundled server carries the SQL as a module). A test fails when the module and the files differ.
- **Adding a column later:** a nullable column is a plain `ALTER TABLE … ADD COLUMN`. A NOT NULL column without a default, a new CHECK or a changed one needs a table rebuild (SQLite's twelve-step procedure), so decide nullability with that in mind.
