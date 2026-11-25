// Where the playbook is kept (S§4.1 `host_access`): one entry per host and page kind. Two
// implementations: in memory (tests, the lab) and SQLite (sqlite-store.ts).
import type { PageKind } from '@agentic-dasher/shared';
import { assertStorableHost } from '../pacing/stored.ts';
import type { PlaybookEntry } from './rules.ts';

/** Synchronous, like better-sqlite3. */
export interface PlaybookStore {
  read(host: string, pageKind: PageKind): PlaybookEntry | null;
  /** Replaces the entry for the entry's host and page kind. */
  write(entry: PlaybookEntry): void;
}

/** Throws a RangeError for an entry the table would refuse. */
export function assertStorableEntry(entry: PlaybookEntry): void {
  assertStorableHost(entry.host);
  if (!Number.isInteger(entry.attempts) || entry.attempts < 0) {
    throw new RangeError(`attempts must be a non-negative integer, got ${entry.attempts}`);
  }
  for (const at of [entry.expiresAt, entry.backoffUntil]) {
    if (at !== null && !Number.isFinite(at)) throw new RangeError(`not an instant: ${at}`);
  }
}

/** A PlaybookStore in process memory. */
export function memoryPlaybookStore(): PlaybookStore & {
  readonly entries: ReadonlyMap<string, PlaybookEntry>;
} {
  const entries = new Map<string, PlaybookEntry>();
  const keyOf = (host: string, pageKind: PageKind) => `${host} ${pageKind}`;
  return {
    entries,
    read: (host, pageKind) => entries.get(keyOf(host, pageKind)) ?? null,
    write(entry) {
      assertStorableEntry(entry);
      entries.set(keyOf(entry.host, entry.pageKind), { ...entry });
    },
  };
}
