// Readers and the store directory (S§5.2): platform JSON, structured data, in-store search
// routes and hand-written adapters. Each part lives in its own directory under `src/` and is
// re-exported here.

export { amazonStorefront, searchAmazon } from './directory/amazon.ts';
export { searchBestBuyCanada } from './directory/bestbuy.ts';
export {
  FINGERPRINT_MAX_REQUESTS,
  type FingerprintInput,
  fingerprintStore,
  type StoreFingerprint,
} from './directory/fingerprint.ts';
export {
  type DirectoryCandidate,
  type StoreSearch,
  type StoreSearchResult,
  searchMagento,
  searchShopify,
  searchWoo,
} from './directory/search.ts';
export { searchDeclaredTemplate } from './directory/template.ts';
export * from './platform/index.ts';
export type * from './read/contract.ts';
export {
  type Decision,
  decide,
  type FailReason,
  type MethodRecord,
  RANK,
} from './read/decide.ts';
export { type ListingReadResult, readListing } from './read/ladder.ts';
export {
  CONFIDENCE,
  type DocumentReading,
  jsonLdReader,
  LIMITS,
  microdataReader,
  openGraphReader,
  readJsonLd,
  readMicrodata,
  readOpenGraph,
} from './structured/index.ts';
