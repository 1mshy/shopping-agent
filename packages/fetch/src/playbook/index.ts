// The fetch playbook (S§5.1, S§4.1 `host_access`): its rules and its stores.
export {
  type Advice,
  advise,
  backoffFor,
  closedUntil,
  NEGATIVE_BACKOFF_MS,
  type PlaybookEntry,
  type PlaybookKey,
  recordOutcome,
  SUCCESS_HINT_TTL_MS,
} from './rules.ts';
export { sqlitePlaybookStore } from './sqlite-store.ts';
export { assertStorableEntry, memoryPlaybookStore, type PlaybookStore } from './store.ts';
