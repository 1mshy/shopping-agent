// These definitions type queries; they are not the schema's source. Migrations are hand-written
// SQL (migrations/README.md) and are never generated from them: Drizzle does not hold the CHECKs,
// the triggers or STRICT, so a generated migration would silently drop every one of them.
import {
  dealFeedItem,
  fxRate,
  hostAccess,
  listing,
  matchVerdict,
  priceObservation,
  product,
  store,
} from './catalogue.ts';
import { searchRun, watch, watchListing } from './intent.ts';
import {
  channel,
  delivery,
  job,
  jobRun,
  llmEndpoint,
  notificationEvent,
  run,
  runStep,
  setting,
} from './operations.ts';
import { candidate, event, feedCard } from './personalisation.ts';
import { profile } from './profile.ts';

export * from './catalogue.ts';
export * from './intent.ts';
export * from './operations.ts';
export * from './personalisation.ts';
export { profile } from './profile.ts';

/** Every table of the schema, in migration order (the drift test compares it with the database). */
export const TABLES = [
  profile,
  store,
  hostAccess,
  product,
  listing,
  priceObservation,
  matchVerdict,
  fxRate,
  watch,
  watchListing,
  searchRun,
  event,
  candidate,
  feedCard,
  dealFeedItem,
  job,
  jobRun,
  run,
  runStep,
  notificationEvent,
  delivery,
  channel,
  llmEndpoint,
  setting,
] as const;
