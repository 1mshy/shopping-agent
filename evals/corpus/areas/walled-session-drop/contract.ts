// What a walled render clears from the one persistent Chrome profile (S§5.1 "Sessions": "A walled
// render clears only that site's cookies (including parent-domain bot-manager cookies) and origin
// storage"). Types only.
//
// Bot managers keep their verdict in the session (Akamai's _abck, DataDome's datadome, PerimeterX's
// _px*), so a session kept after a wall makes the wall stick. Every other site's session stays, and
// a challenge that cleared keeps its clearance cookie.
import type { FetchOutcome } from '@agentic-dasher/shared';

export interface SessionDropInput {
  /** The URL the render was asked for; its host names the site. */
  readonly pageUrl: string;
  /** How the render ended, as the wall classifier judged it. */
  readonly outcome: FetchOutcome;
  /** The cookie domains in the profile when the render ended, as the browser lists them. */
  readonly jar: readonly string[];
}

export interface SessionDrop {
  /** The jar entries whose cookies are cleared, in jar order; empty when nothing is cleared. */
  readonly cookieDomains: readonly string[];
  /**
   * Origins whose storage is cleared (local storage, IndexedDB, cache storage and service workers,
   * as the predecessor cleared them); empty when nothing is cleared.
   */
  readonly origins: readonly string[];
}

/** The subject. Pure: decides what to clear; clearing it is the browser client's job. */
export type PlanSessionDrop = (input: SessionDropInput) => SessionDrop;

export type Established = 'test' | 'read' | 'ran' | 'spec';

export interface SessionDropCase {
  readonly id: string;
  readonly what: string;
  readonly input: SessionDropInput;
  readonly expected: SessionDrop;
  readonly from: string;
  readonly established: readonly Established[];
  readonly divergence?: string;
  readonly specSilent?: true;
  readonly note?: string;
}
