// The candidate rule of S§5.2 across methods: which method's reading is the read, or why there is
// none. Pure: it sees only what each method answered.
//
// The rule, precisely:
//
// 1. Rank. JSON-LD (3) outranks platform values, platform JSON and hand-written adapters (2),
//    which outrank the generic tags, microdata and OpenGraph (1).
// 2. Participants. A method takes part when it read a listing, or when it refused with
//    `variant_not_found`, `multiple_prices` or `converted_currency`: those are statements about
//    the store's data. A `variant_not_found` flagged `unconfirmed` (the method's data has no
//    variants to check the selector against) does not take part, nor do `no_price`,
//    `unreadable_price`, `fetch_failed` and `not_applicable`: they abstain.
// 3. The highest rank among participants decides. If any participant of that rank refused, the
//    result is that refusal: a lower-ranked read never overrules it (so an OpenGraph tag holding
//    the default variant's price cannot answer for a JSON-LD ProductGroup with none selected).
// 4. The reads of that rank must agree. Two reads with a sticker agree when currency and amount
//    are equal. A read with currency `unknown` beside a read with a sticker cannot be compared, and
//    two unknown-currency reads agree only when their figure texts are equal. Any disagreement at
//    the top rank is `multiple_prices`: no ranking rule settles a tie.
// 5. Otherwise the first read of the top rank with a sticker wins (else the first read of that
//    rank), and disagreeing reads of a lower rank are settled by rank 1 (they stay in the
//    candidate list).
// 6. Nothing took part: the most telling abstention is the reason (an unconfirmed
//    `variant_not_found`, then `unreadable_price`, then `no_price`), else `no_structured_data`.
//
// Every method's candidates are kept, the deciding method's first.
import type { RawCandidate, ReadMethod } from '@agentic-dasher/shared';
import type { ListingRead, NoReadReason, ReaderOutcome } from './contract.ts';

export interface MethodRecord {
  readonly method: ReadMethod;
  /** The rung of the method's request: `api` for an endpoint reader, `http` for the page. */
  readonly rung: 'api' | 'http';
  readonly outcome: ReaderOutcome;
  /** A `variant_not_found` that only means "no variant data here to check the selector". */
  readonly unconfirmed: boolean;
}

export type FailReason = NoReadReason | 'no_structured_data';

export type Decision =
  | {
      readonly kind: 'read';
      readonly read: ListingRead;
      readonly candidates: readonly RawCandidate[];
    }
  | {
      readonly kind: 'failed';
      readonly reason: FailReason;
      readonly detail: string;
      readonly candidates: readonly RawCandidate[];
    };

export const RANK: Readonly<Record<ReadMethod, number>> = {
  json_ld: 3,
  platform_json: 2,
  adapter: 2,
  microdata: 1,
  opengraph: 1,
};

/** Refusals that speak for the store's data and take part in the decision. */
export const FINAL_REASONS: ReadonlySet<NoReadReason> = new Set([
  'variant_not_found',
  'multiple_prices',
  'converted_currency',
]);

export const MAX_READ_CANDIDATES = 20;

function candidatesOf(outcome: ReaderOutcome): readonly RawCandidate[] {
  if (outcome.kind === 'read') return outcome.read.candidates;
  if (outcome.kind === 'no_read') return outcome.candidates;
  return [];
}

/** Every record's candidates, `first` first, exact duplicates (method and value) dropped. */
export function mergeCandidates(
  records: readonly MethodRecord[],
  first?: MethodRecord,
): RawCandidate[] {
  const ordered = first === undefined ? records : [first, ...records.filter((r) => r !== first)];
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  for (const r of ordered) {
    for (const c of candidatesOf(r.outcome)) {
      const key = `${c.method}\u0000${c.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
  }
  return out;
}

const participates = (r: MethodRecord): boolean =>
  r.outcome.kind === 'read' ||
  (r.outcome.kind === 'no_read' && FINAL_REASONS.has(r.outcome.reason) && !r.unconfirmed);

function figureKey(read: ListingRead): string {
  return (read.candidates[0]?.value ?? '').replace(/\s+/g, '');
}

export function decide(records: readonly MethodRecord[]): Decision {
  const participants = records.filter(participates);
  if (participants.length === 0) return nothingRead(records);

  const top = Math.max(...participants.map((r) => RANK[r.method]));
  const atTop = participants.filter((r) => RANK[r.method] === top);
  const refusal = atTop.find((r) => r.outcome.kind === 'no_read');
  if (refusal !== undefined && refusal.outcome.kind === 'no_read') {
    return {
      kind: 'failed',
      reason: refusal.outcome.reason,
      detail: `${refusal.method}: ${refusal.outcome.detail}`,
      candidates: mergeCandidates(records, refusal),
    };
  }

  const reads = atTop.filter(
    (r): r is MethodRecord & { outcome: { kind: 'read'; read: ListingRead } } =>
      r.outcome.kind === 'read',
  );
  const priced = reads.filter((r) => r.outcome.read.sticker !== null);
  const unknown = reads.filter((r) => r.outcome.read.currency === 'unknown');
  const disagree = (detail: string): Decision => ({
    kind: 'failed',
    reason: 'multiple_prices',
    detail,
    candidates: mergeCandidates(records),
  });
  const amounts = new Set(
    priced.map((r) => `${r.outcome.read.currency}:${r.outcome.read.sticker}`),
  );
  if (amounts.size > 1) {
    return disagree(
      `${priced.map((r) => r.method).join(' and ')} disagree on the price and rank equally`,
    );
  }
  if (priced.length > 0 && unknown.length > 0) {
    return disagree(`${unknown[0]?.method} has no currency to compare with ${priced[0]?.method}`);
  }
  if (priced.length === 0 && new Set(unknown.map((r) => figureKey(r.outcome.read))).size > 1) {
    return disagree('methods of equal rank read different figures in an unknown currency');
  }

  const winner = priced[0] ?? reads[0];
  if (winner === undefined) return nothingRead(records);
  const candidates = mergeCandidates(records, winner);
  return {
    kind: 'read',
    read: { ...winner.outcome.read, candidates: candidates.slice(0, MAX_READ_CANDIDATES) },
    candidates,
  };
}

const ABSTENTION_ORDER: readonly NoReadReason[] = [
  'variant_not_found',
  'unreadable_price',
  'no_price',
];

function nothingRead(records: readonly MethodRecord[]): Decision {
  for (const reason of ABSTENTION_ORDER) {
    const r = records.find((x) => x.outcome.kind === 'no_read' && x.outcome.reason === reason);
    if (r !== undefined && r.outcome.kind === 'no_read') {
      return {
        kind: 'failed',
        reason,
        detail: `${r.method}: ${r.outcome.detail}`,
        candidates: mergeCandidates(records, r),
      };
    }
  }
  return {
    kind: 'failed',
    reason: 'no_structured_data',
    detail: 'no method found its kind of data on the page',
    candidates: mergeCandidates(records),
  };
}
