// The hook the wall classifier plugs into (S§5.1 "Wall classifier"; another unit writes it). It
// sees every response that was read, before the status is mapped, and either decides the outcome
// or has no opinion. Only the settled rule ships here: "a bare 403 with no wall marker is a wall
// whose vendor is unknown" (S§5.1), with mode `challenge`.
import type { FetchOutcome, Rung } from '@agentic-dasher/shared';

/** What fetchPage read: everything the readers and the wall classifier decide from. */
export interface PageResponse {
  readonly status: number;
  /** The URL the response came from, after redirects (canonical, without fragment). */
  readonly finalUrl: string;
  /** Response headers, names lower-cased, repeated ones joined with ", "; Set-Cookie apart. */
  readonly headers: Readonly<Record<string, string>>;
  /** Every Set-Cookie value of the final response, as sent (the jar has already stored them). */
  readonly setCookies: readonly string[];
  /** The Content-Type header, or null. */
  readonly contentType: string | null;
  /** The body as received (decompressed), under the body cap. */
  readonly body: Uint8Array;
  /** The body decoded with the Content-Type charset, UTF-8 when none or unknown. */
  readonly text: string;
}

export interface ClassifyInput extends PageResponse {
  /** The rung that fetched the page. */
  readonly rung: Extract<Rung, 'api' | 'http'>;
}

type WithoutRung<T> = T extends unknown ? Omit<T, 'rung'> : never;

/**
 * A classifier's verdict: any outcome a response can have, without the rung (fetchPage adds it).
 * Network errors and policy refusals are the transport's and the guard's, never a classifier's.
 */
export type ClassifierVerdict = WithoutRung<
  Exclude<FetchOutcome, { kind: 'network_error' | 'refused_by_policy' }>
>;

/** Decides the outcome of a response, or returns null for no opinion. Must be pure and sync. */
export type Classify = (input: ClassifyInput) => ClassifierVerdict | null;

/** The settled rule only: a 403 is a wall of unknown vendor, mode `challenge`; else no opinion. */
export const defaultClassify: Classify = (input) =>
  input.status === 403 ? { kind: 'wall', vendor: null, mode: 'challenge' } : null;
