// The composed fetcher (S§5.1): robots, the playbook's gate, pacing, the budget and fetchPage.
export { createRequestBudget, type RequestBudget } from './budget.ts';
export {
  bindReaderGet,
  createFetcher,
  type Fetcher,
  type FetcherDeps,
  type FetcherRequest,
  type FetcherResult,
  type ReadBinding,
  type ReaderGetRequest,
} from './fetcher.ts';
