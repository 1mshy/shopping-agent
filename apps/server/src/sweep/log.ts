// The sweep's structured log. A failed read writes no observation (S§4.1, S§2.10), so its reason,
// detail, fetch outcome and candidate list land here, as one record per failed read (the ladder's
// module comment, packages/sources/src/read/ladder.ts). Injected; the default writes one JSON line
// to stderr. Records hold no secret: URLs of shops, figures as text, outcome kinds.

export type SweepLogLevel = 'info' | 'warn' | 'error';

export interface SweepLogRecord {
  readonly level: SweepLogLevel;
  /** What happened: `failed_read`, `deferred_read`, `currency_differs`, `check_error`, … */
  readonly event: string;
  readonly at: string;
  readonly [field: string]: unknown;
}

export type SweepLogger = (record: SweepLogRecord) => void;

export const stderrLogger: SweepLogger = (record) => {
  try {
    process.stderr.write(`${JSON.stringify({ source: 'sweep', ...record })}\n`);
  } catch {
    // A log that cannot be written never stops a sweep.
  }
};

/** Keeps the error's name and message only: a stack or a cause may carry a URL with a token. */
export function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return String(error).slice(0, 500);
}
