// The fetch playbook's rules (S§5.1 "Typed outcome", S§4.1 `host_access`). One entry per host and
// page kind: the rung that last worked or failed there, and what that means for the next request.
// Pure: the clock is an argument.
//
//   - Only `ok`, `wall` and `empty` may change the playbook (`changesPlaybook`). Every other
//     outcome (a 404 among them) leaves the entry exactly as it was: a 404 never moves a rung, and
//     a rate limit, a server error, a network error, a login or payment wall or a policy refusal
//     says nothing about which rung works.
//   - `ok` is a success hint for its rung, good for `SUCCESS_HINT_TTL_MS`; it resets the count.
//   - `wall` and `empty` are negative verdicts: the rung is closed for the page kind until
//     `backoff_until`, on the growing `NEGATIVE_BACKOFF_MS` schedule. `attempts` counts the
//     consecutive negatives on that rung; only `ok` resets it, so a failed read never improves the
//     playbook.
import {
  changesPlaybook,
  type FetchOutcome,
  type PageKind,
  type PlaybookOutcomeKind,
  RUNGS,
  type Rung,
} from '@agentic-dasher/shared';

/** S§5.1: "Success hints expire after 24 h." */
export const SUCCESS_HINT_TTL_MS = 24 * 60 * 60 * 1_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * S§5.1: "negative verdicts back off on a growing schedule". The spec gives no numbers. The n-th
 * consecutive negative closes the rung for the n-th entry; from the fifth on, for the last.
 * Starts at the predecessor's flat 5 minutes (`pw_blocked_retry_seconds`), so a challenge that
 * clears by itself is retried soon; roughly triples; caps at 6 hours, so a walled host is still
 * probed about four times a day and a wall that lifts is noticed the same day.
 */
export const NEGATIVE_BACKOFF_MS: readonly number[] = [
  5 * MINUTE,
  15 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
];

export interface PlaybookKey {
  /** Lower case, ASCII (see `hostKey`). */
  readonly host: string;
  readonly pageKind: PageKind;
}

/** One `host_access` row, with instants as epoch milliseconds. */
export interface PlaybookEntry extends PlaybookKey {
  /** The rung the last playbook outcome came from. */
  readonly rung: Rung;
  readonly lastOutcome: PlaybookOutcomeKind;
  /** The classifier's vendor of the last wall; null for `ok`, `empty` or an unnamed wall. */
  readonly wallVendor: string | null;
  /** When a success hint stops counting; null on a negative verdict. */
  readonly expiresAt: number | null;
  /** Until when the rung is closed for this page kind; null on a success hint. */
  readonly backoffUntil: number | null;
  /** Consecutive negative verdicts on `rung`; 0 after a success. */
  readonly attempts: number;
}

/** The back-off after the `attempts`-th consecutive negative verdict (attempts >= 1). */
export function backoffFor(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`attempts must be a positive integer, got ${attempts}`);
  }
  const last = NEGATIVE_BACKOFF_MS.length - 1;
  return NEGATIVE_BACKOFF_MS[Math.min(attempts - 1, last)] ?? 0;
}

const isNegative = (entry: PlaybookEntry): boolean => entry.lastOutcome !== 'ok';

/**
 * The entry after `outcome`, or null when the outcome may not change the playbook (the entry, or
 * its absence, stays as it is).
 */
export function recordOutcome(
  previous: PlaybookEntry | null,
  key: PlaybookKey,
  outcome: FetchOutcome,
  now: number,
): PlaybookEntry | null {
  if (previous !== null && (previous.host !== key.host || previous.pageKind !== key.pageKind)) {
    throw new RangeError('the previous entry is for another host or page kind');
  }
  if (!Number.isFinite(now)) throw new RangeError(`now must be a number, got ${now}`);
  if (!changesPlaybook(outcome)) return null;
  const { host, pageKind } = key;
  const { rung } = outcome;
  if (outcome.kind === 'ok') {
    return {
      host,
      pageKind,
      rung,
      lastOutcome: 'ok',
      wallVendor: null,
      expiresAt: now + SUCCESS_HINT_TTL_MS,
      backoffUntil: null,
      attempts: 0,
    };
  }
  const attempts =
    previous !== null && isNegative(previous) && previous.rung === rung ? previous.attempts + 1 : 1;
  return {
    host,
    pageKind,
    rung,
    lastOutcome: outcome.kind,
    wallVendor: outcome.kind === 'wall' ? outcome.vendor : null,
    expiresAt: null,
    backoffUntil: now + backoffFor(attempts),
    attempts,
  };
}

/**
 * When `rung` is closed for the entry's host and page kind: a negative verdict on that very rung
 * that is still backing off. Null when the rung may be tried now.
 */
export function closedUntil(entry: PlaybookEntry | null, rung: Rung, now: number): number | null {
  if (entry === null || !isNegative(entry) || entry.rung !== rung) return null;
  return entry.backoffUntil !== null && entry.backoffUntil > now ? entry.backoffUntil : null;
}

export type Advice =
  | { readonly kind: 'start'; readonly rung: Rung }
  /** Every rung of the ladder is closed: do not try before `until`. */
  | { readonly kind: 'wait'; readonly until: number };

const rank = (rung: Rung): number => RUNGS.indexOf(rung);

/**
 * Which rung to start on now, from `ladder`: the rungs the caller can use for this page kind, in
 * ladder order (Phase 1: `api` and `http`; the browser rung joins in Phase 6 with no change here).
 *   - No entry, an expired hint, or a back-off that has run out: the first rung.
 *   - A success hint on a rung of the ladder: that rung.
 *   - A negative verdict still backing off: the first rung above it, or "wait until" when none.
 */
export function advise(entry: PlaybookEntry | null, ladder: readonly Rung[], now: number): Advice {
  const first = ladder[0];
  if (first === undefined) throw new RangeError('the ladder has no rung');
  if (entry === null) return { kind: 'start', rung: first };
  if (!isNegative(entry)) {
    const holds = entry.expiresAt !== null && entry.expiresAt > now;
    return { kind: 'start', rung: holds && ladder.includes(entry.rung) ? entry.rung : first };
  }
  const until = closedUntil(entry, entry.rung, now);
  if (until === null) return { kind: 'start', rung: first };
  const above = ladder.find((rung) => rank(rung) > rank(entry.rung));
  return above !== undefined ? { kind: 'start', rung: above } : { kind: 'wait', until };
}
