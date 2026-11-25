// Online backup (S§5.14): `VACUUM INTO` on a schedule, with a bounded number of copies kept.
//
// The copy is written under a `.partial` name and renamed when SQLite has finished, so a file
// with the final name is always a complete database: a crash or a full disk mid-backup leaves a
// `.partial`, which the next run removes. Only files this module named are ever deleted.
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '@agentic-dasher/db';
import type { JobDefinition } from '../scheduler/index.ts';
import { ownerOnlyDir, ownerOnlyFile } from './files.ts';

/** `agentic-dasher-20261125T031500Z.db`: the UTC second the backup started. */
const BACKUP_NAME = /^agentic-dasher-\d{8}T\d{6}Z\.db$/;
const PARTIAL_NAME = /^agentic-dasher-\d{8}T\d{6}Z\.db\.partial$/;

/** Backups kept by default: a week of daily copies. */
export const DEFAULT_BACKUPS_KEPT = 7;

export interface BackupOptions {
  readonly db: Database;
  /** The directory backups are written to; created when missing. */
  readonly dir: string;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** How many backups to keep, newest first. At least 1. */
  readonly keep?: number;
}

export interface BackupResult {
  /** The backup's file name inside `dir`. */
  readonly file: string;
  readonly bytes: number;
  /** False when a backup of this same second already existed and was left as it was. */
  readonly written: boolean;
  /** Older backups removed to stay within `keep`, oldest first. */
  readonly removed: readonly string[];
}

function backupName(ms: number): string {
  const stamp = new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  return `agentic-dasher-${stamp}.db`;
}

/** Writes one backup of the live database and prunes old ones. Safe while the app is running. */
export function runBackup(options: BackupOptions): BackupResult {
  const keep = options.keep ?? DEFAULT_BACKUPS_KEPT;
  if (!Number.isInteger(keep) || keep < 1) {
    throw new RangeError(`keep must be a positive integer, got ${keep}`);
  }
  ownerOnlyDir(options.dir);
  for (const name of readdirSync(options.dir)) {
    if (PARTIAL_NAME.test(name)) rmSync(join(options.dir, name), { force: true });
  }

  const file = backupName(options.now());
  const target = join(options.dir, file);
  let written = false;
  if (!existsSync(target)) {
    const partial = `${target}.partial`;
    options.db.backupTo(partial);
    // A copy of the database is as private as the database (ops/files.ts).
    ownerOnlyFile(partial);
    renameSync(partial, target);
    written = true;
  }

  // Names sort by time: the stamp is fixed-width UTC.
  const backups = readdirSync(options.dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort();
  const removed = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of removed) rmSync(join(options.dir, name), { force: true });

  return { file, bytes: statSync(target).size, written, removed };
}

export const BACKUP_JOB_NAME = 'backup';

export interface BackupJobOptions extends BackupOptions {
  /** croner syntax, UTC. Daily at 03:15 by default. */
  readonly cron?: string;
  readonly deadlineMs?: number;
}

/** The backup as a scheduler job. It needs no network, so it has no DNS gate. */
export function backupJob(options: BackupJobOptions): JobDefinition {
  const { cron = '15 3 * * *', deadlineMs = 10 * 60_000, ...backup } = options;
  return {
    name: BACKUP_JOB_NAME,
    cron,
    deadlineMs,
    networkGate: false,
    handler: async () => {
      const result = runBackup(backup);
      return { ...result, removed: [...result.removed] };
    },
  };
}
