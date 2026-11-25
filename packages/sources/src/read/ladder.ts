// The reader ladder (S§5.2): platform endpoints first, then one page fetch read by JSON-LD,
// microdata and OpenGraph, then the candidate rule (decide.ts). One typed result: a ListingRead
// with what each method saw, or a failed read with its reason, the page fetch outcome when the
// fetch failed (a wall, a 404, a refusal pass through untouched, never turned into "no price"),
// and every candidate.
//
// Order, precisely:
//
// 1. Each endpoint reader whose `applies` is true, in the order given, until one reads. Its read
//    is the result and the page is not fetched: the platform's own JSON answers for the exact
//    variant and costs one request (S§5.1 ladder, `api` first). Its `variant_not_found`,
//    `multiple_prices` or `converted_currency` is final too: the store's own data refused, and a
//    page tag must not answer instead (the page usually shows the default variant). Any other
//    refusal (`fetch_failed`, `no_price`, `unreadable_price`) or `not_applicable` moves on.
// 2. One GET of the request URL on the `http` rung. Anything but `ok` with a response ends the
//    ladder as `fetch_failed` with that outcome.
// 3. JSON-LD, microdata and OpenGraph each read the page (all three: they cost nothing more and
//    every method's figures are kept), and decide.ts picks the read or the refusal.
//
// The browser rung (S§5.2 "→ browser (add-on)") is not here: it arrives with the browser add-on.
//
// Where the candidates go: a read's `read.candidates` (at most 20, the deciding method's first) is
// what the caller stores as the observation's raw_candidates_json. A failed read writes no
// observation (S§4.1), so its `candidates`, `reason`, `detail` and `fetch` are logged by the caller
// as one structured log record of the failed read (with the listing and the time), which is where
// S§5.2's "each read stores its candidate list" lands for a failed read. Nothing here logs.
import type { FetchOutcome, RawCandidate } from '@agentic-dasher/shared';
import { readJsonLd } from '../structured/jsonld.ts';
import { readMicrodata } from '../structured/microdata.ts';
import { readOpenGraph } from '../structured/opengraph.ts';
import type { EndpointReader, ListingRead, ReaderContext, ReadRequest } from './contract.ts';
import {
  decide,
  type FailReason,
  FINAL_REASONS,
  MAX_READ_CANDIDATES,
  type MethodRecord,
  mergeCandidates,
} from './decide.ts';

export type ListingReadResult =
  | {
      readonly kind: 'read';
      readonly read: ListingRead;
      /** What each method that ran answered, in ladder order. */
      readonly methods: readonly MethodRecord[];
      /** Every candidate any method saw, the deciding method's first. */
      readonly candidates: readonly RawCandidate[];
    }
  | {
      readonly kind: 'failed';
      /** A reader refusal, `fetch_failed`, or `no_structured_data` (no method found its kind of data). */
      readonly reason: FailReason;
      /** Code-written, for logs and Diagnostics. */
      readonly detail: string;
      /** The page fetch outcome when the page fetch failed; null otherwise. */
      readonly fetch: FetchOutcome | null;
      readonly methods: readonly MethodRecord[];
      readonly candidates: readonly RawCandidate[];
    };

const DOCUMENT_READERS = [
  ['json_ld', readJsonLd],
  ['microdata', readMicrodata],
  ['opengraph', readOpenGraph],
] as const;

/** Reads one listing through the ladder. Makes at most one page request beyond the endpoint readers' own. */
export async function readListing(
  request: ReadRequest,
  endpointReaders: readonly EndpointReader[],
  context: ReaderContext,
): Promise<ListingReadResult> {
  const methods: MethodRecord[] = [];

  for (const reader of endpointReaders) {
    if (!reader.applies(request)) continue;
    const outcome = await reader.read(request, context);
    const record: MethodRecord = {
      method: reader.method,
      rung: outcome.kind === 'read' ? outcome.read.rung : 'api',
      outcome,
      unconfirmed: false,
    };
    methods.push(record);
    if (outcome.kind === 'read') {
      return {
        kind: 'read',
        read: outcome.read,
        methods,
        candidates: mergeCandidates(methods, record),
      };
    }
    if (outcome.kind === 'no_read' && FINAL_REASONS.has(outcome.reason)) {
      return {
        kind: 'failed',
        reason: outcome.reason,
        detail: `${reader.method}: ${outcome.detail}`,
        fetch: null,
        methods,
        candidates: mergeCandidates(methods, record),
      };
    }
  }

  const fetched = await context.get({ url: request.url, rung: 'http' });
  if (fetched.outcome.kind !== 'ok' || fetched.response === null) {
    return {
      kind: 'failed',
      reason: 'fetch_failed',
      detail: `the page fetch ended ${fetched.outcome.kind}`,
      fetch: fetched.outcome,
      methods,
      candidates: mergeCandidates(methods),
    };
  }

  const page = fetched.response;
  const pageRecords: MethodRecord[] = DOCUMENT_READERS.map(([method, read]) => {
    const reading = read(request, page);
    return { method, rung: 'http', outcome: reading.outcome, unconfirmed: reading.unconfirmed };
  });
  methods.push(...pageRecords);
  const decision = decide(methods);
  if (decision.kind === 'read') {
    return {
      kind: 'read',
      read: { ...decision.read, candidates: decision.candidates.slice(0, MAX_READ_CANDIDATES) },
      methods,
      candidates: decision.candidates,
    };
  }
  return {
    kind: 'failed',
    reason: decision.reason,
    detail: decision.detail,
    fetch: null,
    methods,
    candidates: decision.candidates,
  };
}
