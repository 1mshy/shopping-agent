// Compile-time checks for the transport and stream contracts (checked by `tsc` only).
import type {
  CoverageSourceKind,
  DealVerdictLabel,
  FetchOutcome,
  FetchOutcomeKind,
  MarketplaceOutcome,
  MarketplaceOutcomeKind,
  Money,
  PlaybookOutcome,
  PlaybookOutcomeKind,
  StreamBlock,
  StreamBlockType,
  StreamEvent,
} from '../src/index.ts';
import { changesPlaybook, countsAgainstHealth } from '../src/index.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Each union covers its vocabulary exactly.
export type _FetchKinds = Expect<Equal<FetchOutcome['kind'], FetchOutcomeKind>>;
export type _MarketKinds = Expect<Equal<MarketplaceOutcome['kind'], MarketplaceOutcomeKind>>;
export type _BlockTypes = Expect<Equal<StreamBlock['type'], StreamBlockType>>;
export type _Events = Expect<Equal<StreamEvent['event'], 'block' | 'patch' | 'end'>>;
export type _Deals = Expect<
  Equal<
    Extract<StreamBlock, { type: 'verdict' }>['deal'] extends infer D
      ? D extends { label: infer L }
        ? L
        : never
      : never,
    DealVerdictLabel
  >
>;
export type _Sources = Expect<
  Equal<
    Extract<StreamBlock, { type: 'coverage' }>['coverage']['sources'][number]['kind'],
    CoverageSourceKind
  >
>;

// Only ok, wall and empty may change the playbook (S§5.1): the narrowed type says so.
export type _Playbook = Expect<Equal<PlaybookOutcome['kind'], PlaybookOutcomeKind>>;

export function playbookOnly(outcome: FetchOutcome): PlaybookOutcomeKind | null {
  if (changesPlaybook(outcome)) return outcome.kind;
  // @ts-expect-error outside the guard the kind is not narrowed to the playbook kinds
  const kind: PlaybookOutcomeKind = outcome.kind;
  return kind === 'ok' ? null : null;
}

export function healthOnly(outcome: MarketplaceOutcome): 'parse_error' | null {
  return countsAgainstHealth(outcome) ? outcome.kind : null;
}

// A price in a block is Money: a number of minor units plus a currency, never a string.
type Priced = Extract<StreamBlock, { type: 'store_read' }>['price'];
export type _PriceIsMoney = Expect<Equal<Priced, Money | null>>;
