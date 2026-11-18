// The wall classifier's contract (S§5.1 "Wall classifier"; plan P1 workstream 1). Types only.
//
// "Decides from status, final URL, title, visible text and document size against saved real
// pages. It does not match bare substrings." The classifier is a pure function of what a reader
// extracted from one loaded page: it never sees the body itself (S§5.1: bodies are not part of the
// contract) and does no I/O.
//
// Mode rule, applied to every case (S§5.1: "report a captcha or 'Access Denied' at once"; a wall
// that is neither is a challenge that did not clear on this rung):
//   1. `captcha` when the page sets a puzzle for a person: an image or text captcha, a captcha
//      iframe, a press-and-hold button. This wins over the page's wording.
//   2. `access_denied` when the page states that access is denied.
//   3. `challenge` otherwise.
// Vendor: named only when the evidence names it (a vendor's title, markup or redirect); otherwise
// null, which the shared contract defines as "saw a wall but cannot name its vendor".
import type { FetchOutcome, FetchOutcomeKind, Rung } from '@agentic-dasher/shared';

/** Where in the markup a bot-manager signal was found, outside the visible text. */
export type MarkupPlace = 'iframe_src' | 'script_src' | 'inline_script' | 'element_id';

/**
 * One bot-manager signal in the markup. Signals carry their place, so a classifier can tell a
 * captcha iframe from the same host name quoted in a store's own script.
 */
export interface MarkupSignal {
  readonly in: MarkupPlace;
  /** Lower-cased. A URL without its query string; for inline script, the fragment that mattered. */
  readonly value: string;
}

/** What the classifier reads from one loaded page. A reader builds it; the classifier gets nothing else. */
export interface PageEvidence {
  /** The rung that loaded the page. The outcome names the same rung. */
  readonly rung: Rung;
  /** HTTP status of the final document (on the browser rung, after the challenge wait). */
  readonly status: number;
  /** The URL the page ended on after every redirect, tracking and session parameters removed. */
  readonly finalUrl: string;
  /** Response headers the classifier may use, names lower-cased (for example `retry-after`). */
  readonly headers: Readonly<Record<string, string>>;
  /** The document's `<title>`, whitespace collapsed and trimmed, case as served; '' when none. */
  readonly title: string;
  /**
   * The body's visible text: scripts, styles and templates dropped, whitespace collapsed, title
   * not included. An excerpt (marked with "…") when `visibleChars` is larger than its length.
   */
  readonly visibleText: string;
  /** Length in characters of the whole visible body text, of which `visibleText` may be an excerpt. */
  readonly visibleChars: number;
  /** Bot-manager signals found in the markup outside the visible text; empty when none. */
  readonly markup: readonly MarkupSignal[];
  /** Size in bytes of the whole document as received. */
  readonly documentBytes: number;
}

/** What a loaded page can be. A network error or a policy refusal happens before there is a page. */
export type PageOutcome = Exclude<FetchOutcome, { kind: 'network_error' | 'refused_by_policy' }>;

/** The subject. Pure: same evidence, same outcome, no I/O. */
export type ClassifyPage = (page: PageEvidence) => PageOutcome;

/**
 * A case expects one outcome exactly, or, where the evidence cannot decide between kinds, any kind
 * of a listed set (used once: a 38-byte page that is neither clearly `ok` nor clearly `empty`).
 */
export type ExpectedPageOutcome =
  | PageOutcome
  | { readonly kindIn: readonly FetchOutcomeKind[]; readonly rung: Rung };

/** How a case's expected value was established. */
export type Established =
  /** A predecessor test asserts it. */
  | 'test'
  /** Read from the predecessor function (file and line in `from`). */
  | 'read'
  /** The predecessor's pure function was run offline on this input. */
  | 'ran'
  /** The spec decides it (S§ in `from`). */
  | 'spec';

export interface WallCase {
  readonly id: string;
  readonly what: string;
  readonly input: PageEvidence;
  readonly expected: ExpectedPageOutcome;
  /** Predecessor file, test or line, and report line where one explains the case. */
  readonly from: string;
  readonly established: readonly Established[];
  /** The saved page this evidence was reduced from, and what was stripped. */
  readonly reducedFrom?: string;
  /** What the predecessor did and why the spec differs. The case follows the spec. */
  readonly divergence?: string;
  /** The spec does not mention this behaviour; it is ported from the predecessor. */
  readonly specSilent?: true;
  /** How the predecessor's boolean "blocked" was mapped to an outcome, and anything else to know. */
  readonly note?: string;
}
