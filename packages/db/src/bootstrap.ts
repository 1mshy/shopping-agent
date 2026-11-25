// What a database needs before the app serves a request, beyond its schema.
import { sql } from 'drizzle-orm';
import type { Database } from './open.ts';

/** v1 has one owner and one profile (S§1.2); every user-owned row carries this id (S§4). */
export const DEFAULT_PROFILE_ID = 1;

/** Creates the one profile of a v1 install when it is missing. Safe at every start. */
export function ensureDefaultProfile(db: Database): void {
  db.orm.run(
    sql`insert into profile (id) values (${DEFAULT_PROFILE_ID}) on conflict (id) do nothing`,
  );
}
