// Drizzle definitions mirror migrations/0001_initial.sql column for column (test/schema.test.ts
// checks it). TypeScript keys follow the contract casing (packages/shared common.ts): the camelCase
// of the column, `*_json` without its suffix. CHECK constraints and triggers live in the SQL only.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** A row id: INTEGER PRIMARY KEY, the rowid. */
export const id = () => integer('id').primaryKey();

/** A UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ` (S§4); the migration checks the format. */
export const timestamp = (name: string) => text(name);

/** The owner of every user-owned row. v1 has one profile (S§9 #9). */
export const profile = sqliteTable('profile', { id: id() });

/** `profile_id` of a user-owned table (S§4). A profile with data cannot be deleted. */
export const profileId = () =>
  integer('profile_id')
    .notNull()
    .references(() => profile.id, { onDelete: 'restrict' });
