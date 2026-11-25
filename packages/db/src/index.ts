export { DEFAULT_PROFILE_ID, ensureDefaultProfile } from './bootstrap.ts';
export {
  type Migration,
  MigrationError,
  type MigrationErrorCode,
  type MigrationReport,
  migrate,
  migrationLevel,
} from './migrate.ts';
export { MIGRATIONS } from './migrations.ts';
export { type Database, openDatabase } from './open.ts';
export * as schema from './schema/index.ts';
export { TABLES } from './schema/index.ts';
