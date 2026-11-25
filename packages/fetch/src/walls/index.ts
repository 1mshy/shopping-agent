// The wall classifier, the browser rung's challenge wait and the walled-session drop (S§5.1).
export {
  CHALLENGE_POLL_MS,
  CHALLENGE_WAIT_MS,
  FILL_IN_MIN_VISIBLE_CHARS,
  type PageContent,
  type StatusAfterWaitInput,
  statusAfterWait,
  worthWaiting,
} from './challenge-wait.ts';
export {
  BLOCK_PAGE_MAX_BYTES,
  BLOCK_PAGE_MAX_VISIBLE_CHARS,
  CHALLENGE_COPY_MAX_VISIBLE_CHARS,
  classifyPage,
  EMPTY_MAX_DOCUMENT_BYTES,
  EMPTY_MAX_VISIBLE_CHARS,
  findWall,
  isEmptyPage,
  judgePage,
} from './classify-page.ts';
export { type BodyKind, bodyKind, classifyResponse } from './classify-response.ts';
export type {
  MarkupPlace,
  MarkupSignal,
  PageEvidence,
  PageOutcome,
  PageVerdict,
  Wall,
} from './evidence.ts';
export {
  decodeEntities,
  HTML_SCAN_MAX_CHARS,
  type HtmlEvidence,
  MAX_SIGNALS,
  readHtml,
  SIGNAL_MAX_CHARS,
  TITLE_MAX_CHARS,
  VISIBLE_TEXT_EXCERPT_CHARS,
} from './html.ts';
export {
  cookieDomainOfSite,
  dropsSession,
  planSessionDrop,
  type SessionDrop,
  type SessionDropInput,
  sessionSite,
} from './session-drop.ts';
