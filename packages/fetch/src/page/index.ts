// The `api` and `http` rungs (S§5.1): one guarded GET, its typed outcome and what was read.
export {
  type ClassifierVerdict,
  type Classify,
  type ClassifyInput,
  defaultClassify,
  type PageResponse,
} from './classify.ts';
export {
  fetchPage,
  type HttpRung,
  JSON_MAX_BODY_BYTES,
  PAGE_MAX_BODY_BYTES,
  type PageFetcherDeps,
  type PageRequest,
  type PageResult,
} from './fetch-page.ts';
export { API_ACCEPT, type RefererHeaders, refererFor, sameSite } from './headers.ts';
export { parseHttpDate, parseRetryAfter } from './retry-after.ts';
export { statusOutcome } from './status.ts';
