// What the wall classifier reads from one loaded page (S§5.1 "Wall classifier"), and what a
// loaded page can be. The classifier never sees a body: a reader (`readHtml` for the HTTP rungs,
// the browser client on the browser rung) reduces it to this evidence first.
import type { FetchOutcome, Rung, WallMode, WallVendor } from '@agentic-dasher/shared';

/**
 * Where in the markup a bot-manager signal was found, outside the visible text. `form_action`
 * is this package's addition to the corpus contract's four places: Amazon's captcha page is
 * recognised by the path its form posts to (`/errors/validateCaptcha`), not by its words.
 */
export type MarkupPlace =
  | 'iframe_src'
  | 'script_src'
  | 'inline_script'
  | 'element_id'
  | 'form_action';

/**
 * One bot-manager signal in the markup. Signals carry their place, so the classifier can tell a
 * captcha iframe from the same host name quoted in a store's own script.
 */
export interface MarkupSignal {
  readonly in: MarkupPlace;
  /** Lower-cased. A URL without its query string; for inline script, the fragment that mattered. */
  readonly value: string;
}

/** What the classifier reads from one loaded page; it gets nothing else. */
export interface PageEvidence {
  /** The rung that loaded the page. The outcome names the same rung. */
  readonly rung: Rung;
  /** HTTP status of the final document (on the browser rung, after the challenge wait). */
  readonly status: number;
  /** The URL the page ended on after every redirect. */
  readonly finalUrl: string;
  /** Response headers, names lower-cased. */
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

/** A wall, without the rung. `vendor` is null when nothing names it (S§5.1). */
export interface Wall {
  readonly kind: 'wall';
  readonly vendor: WallVendor | null;
  readonly mode: WallMode;
}

/** The classifier's own decisions: a wall, or a page with nothing to read. */
export type PageVerdict = Wall | { readonly kind: 'empty' };
