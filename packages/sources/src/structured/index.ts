// The structured-data readers of the S§5.2 ladder: JSON-LD, microdata and OpenGraph price tags.
// Each is a DocumentReader (src/read/contract.ts): a pure function of the fetched page and the
// request, with no request and no clock.
import { HTML_LIMITS } from './html.ts';
import { MAX_CANDIDATES } from './product.ts';

export { jsonLdReader, readJsonLd } from './jsonld.ts';
export { microdataReader, readMicrodata } from './microdata.ts';
export { openGraphReader, readOpenGraph } from './opengraph.ts';
export { CONFIDENCE, type DocumentReading } from './product.ts';

/** The bounds the readers keep to on any page (see html.ts, json.ts, jsonld.ts). */
export const LIMITS = {
  jsonLdBlocks: HTML_LIMITS.jsonLdBlocks,
  microdataItems: HTML_LIMITS.microdataItems,
  candidatesPerMethod: MAX_CANDIDATES,
} as const;
