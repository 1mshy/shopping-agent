// The PlaybookStore on the `host_access` table (migration 0001), through Drizzle. Rows are read back
// through the vocabularies of @agentic-dasher/shared, so a row this code did not write is refused
// rather than trusted.
import { type Database, schema } from '@agentic-dasher/db';
import { PageKind, PlaybookOutcomeKind, Rung, WallVendor } from '@agentic-dasher/shared';
import { and, eq } from 'drizzle-orm';
import { fromStoredInstant, toStoredInstant } from '../pacing/stored.ts';
import type { PlaybookEntry } from './rules.ts';
import { assertStorableEntry, type PlaybookStore } from './store.ts';

const { hostAccess } = schema;

const instant = (text: string | null): number | null =>
  text === null ? null : fromStoredInstant(text);
const stored = (ms: number | null): string | null => (ms === null ? null : toStoredInstant(ms));

/** `host_access` rows in the app database. */
export function sqlitePlaybookStore(db: Database): PlaybookStore {
  return {
    read(host, pageKind) {
      const row = db.orm
        .select()
        .from(hostAccess)
        .where(and(eq(hostAccess.host, host), eq(hostAccess.pageKind, pageKind)))
        .get();
      if (row === undefined) return null;
      return {
        host: row.host,
        pageKind: PageKind.parse(row.pageKind),
        rung: Rung.parse(row.rung),
        lastOutcome: PlaybookOutcomeKind.parse(row.lastOutcome),
        wallVendor: row.wallVendor === null ? null : WallVendor.parse(row.wallVendor),
        expiresAt: instant(row.expiresAt),
        backoffUntil: instant(row.backoffUntil),
        attempts: row.attempts,
      };
    },
    write(entry: PlaybookEntry) {
      assertStorableEntry(entry);
      const values = {
        rung: Rung.parse(entry.rung),
        lastOutcome: PlaybookOutcomeKind.parse(entry.lastOutcome),
        wallVendor: entry.wallVendor === null ? null : WallVendor.parse(entry.wallVendor),
        expiresAt: stored(entry.expiresAt),
        backoffUntil: stored(entry.backoffUntil),
        attempts: entry.attempts,
      };
      db.orm
        .insert(hostAccess)
        .values({ host: entry.host, pageKind: PageKind.parse(entry.pageKind), ...values })
        .onConflictDoUpdate({ target: [hostAccess.host, hostAccess.pageKind], set: values })
        .run();
    },
  };
}
