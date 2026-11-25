// Where per-host pacing is kept across restarts (S§5.1 Pacing, S§4.4 `host_pacing`): per host, the
// earliest instant the next request may start. Two implementations: in memory (tests, the lab) and
// SQLite (sqlite-store.ts).
import { assertStorableHost } from './stored.ts';

/**
 * The `host_pacing` rows. Synchronous, like better-sqlite3: the pacer reads and writes a host's row
 * only while it holds that host's turn, so a read-then-write never interleaves in one process.
 */
export interface PacingStore {
  /** The stored earliest next start (epoch ms), or null when the host has no row. */
  read(host: string): number | null;
  /** Sets the earliest next start (epoch ms), creating the row when needed. */
  write(host: string, nextStartAt: number): void;
}

/** A PacingStore in process memory. */
export function memoryPacingStore(): PacingStore & {
  /** Every row, for tests. */
  readonly rows: ReadonlyMap<string, number>;
} {
  const rows = new Map<string, number>();
  return {
    rows,
    read: (host) => rows.get(host) ?? null,
    write(host, nextStartAt) {
      assertStorableHost(host);
      if (!Number.isFinite(nextStartAt)) throw new RangeError(`not an instant: ${nextStartAt}`);
      rows.set(host, Math.ceil(nextStartAt));
    },
  };
}
