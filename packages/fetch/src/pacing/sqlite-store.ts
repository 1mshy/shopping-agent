// The PacingStore on the `host_pacing` table (migration 0002), through Drizzle.
import { type Database, schema } from '@agentic-dasher/db';
import { eq, sql } from 'drizzle-orm';
import type { PacingStore } from './store.ts';
import { assertStorableHost, fromStoredInstant, toStoredInstant } from './stored.ts';

const { hostPacing } = schema;

/** `host_pacing` rows in the app database. */
export function sqlitePacingStore(db: Database): PacingStore {
  return {
    read(host) {
      const row = db.orm
        .select({ nextStartAt: hostPacing.nextStartAt })
        .from(hostPacing)
        .where(eq(hostPacing.host, host))
        .get();
      return row === undefined ? null : fromStoredInstant(row.nextStartAt);
    },
    write(host, nextStartAt) {
      assertStorableHost(host);
      const at = toStoredInstant(nextStartAt);
      db.orm
        .insert(hostPacing)
        .values({ host, nextStartAt: at })
        .onConflictDoUpdate({
          target: hostPacing.host,
          set: { nextStartAt: sql`excluded.next_start_at` },
        })
        .run();
    },
  };
}
