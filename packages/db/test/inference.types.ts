// Day-one check that Drizzle's type inference survives TypeScript 7 (plan P0 workstream 1).
// Checked by `tsc` only (not a Vitest file). If this stops compiling, fall back to TS 6.x.
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Database } from '../src/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const probe = sqliteTable('probe', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  note: text('note'),
  priceMinor: integer('price_minor'),
});

type Row = typeof probe.$inferSelect;
type NewRow = typeof probe.$inferInsert;

export type _Select = Expect<
  Equal<Row, { id: number; name: string; note: string | null; priceMinor: number | null }>
>;
export type _InsertRequired = Expect<Equal<NewRow['name'], string>>;

export function query(db: Database) {
  const rows = db.orm
    .select({ id: probe.id, name: probe.name })
    .from(probe)
    .where(eq(probe.id, 1))
    .all();
  type _Query = Expect<Equal<typeof rows, { id: number; name: string }[]>>;
  return rows;
}
