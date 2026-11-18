// Contract of save-first watch intake (S§5.8 "Intake": "Save first (Invariant 9). URL
// normalisation strips tracking parameters and keeps variant parameters. … The baseline and
// currency are adopted only from the first real read. The default rule is a 5% drop."; predecessor
// service.py `_watch_input`, `add_watch`). A pure decision over what the user typed, the rules they
// gave and the watches already saved: what to save, before any retailer is contacted.
//
// Units: money is `Money`; the drop rule is integer basis points; the cooldown is integer seconds.
import type { Id, Money, WatchKind } from '@agentic-dasher/shared';

export interface IntakeRules {
  readonly targetPrice: Money | null;
  /** Basis points; 500 = 5%. */
  readonly dropBasisPoints: number | null;
  readonly restock: boolean;
  /** Null: the default (12 h = 43200 s). */
  readonly cooldownSeconds: number | null;
}

export interface IntakeInput {
  /** What the user pasted or typed, as given. */
  readonly input: string;
  readonly rules: IntakeRules;
  /** Watches already saved, with their dedupe keys. */
  readonly existing: readonly {
    readonly watchId: Id;
    readonly key: string;
    readonly active: boolean;
  }[];
}

/**
 * Proposed vocabulary: why intake refuses. `not_one_link_or_name`: empty, multi-line or over 1,000
 * characters; `not_an_http_link`: a link that is not http(s) or carries login details;
 * `target_not_positive`; `drop_out_of_range` (not 0 < bp < 10000); `cooldown_too_short` (< 1 h).
 */
export type IntakeRefusal =
  | 'not_one_link_or_name'
  | 'not_an_http_link'
  | 'target_not_positive'
  | 'drop_out_of_range'
  | 'cooldown_too_short';

export type IntakeDecision =
  | {
      readonly ok: true;
      readonly action: 'create';
      /** `product` for a pasted link, `query` for a name (S§4.2 watch.kind). */
      readonly kind: Extract<WatchKind, 'product' | 'query'>;
      /** watch.input: the normalised link, or the name with its whitespace collapsed. */
      readonly normalised: string;
      /** Dedupe key (ported format): `url:` + normalised link, `query:` + case-folded name. */
      readonly key: string;
      /** The rules saved, with the defaults applied. */
      readonly rules: {
        readonly targetPrice: Money | null;
        readonly dropBasisPoints: number | null;
        readonly restock: boolean;
        readonly cooldownSeconds: number;
      };
      /** What is written before any retailer is contacted (S§2.9): no currency, no reference. */
      readonly saved: {
        readonly currency: null;
        readonly referencePrice: null;
        readonly lookup: 'queued';
      };
    }
  | {
      readonly ok: true;
      readonly action: 'existing';
      readonly watchId: Id;
      readonly key: string;
      /** The existing watch's settings are kept; a paused watch stays paused. */
      readonly status: 'active' | 'paused';
    }
  | { readonly ok: false; readonly refusal: IntakeRefusal };

/**
 * The subject (Phase 1). Normalisation, ported from `_watch_input`: trim; refuse empty, multi-line
 * or over 1,000 characters; a bare `host.tld/…` gets `https://`; a link must be http(s) with a host
 * and no user-info; scheme and host are lower-cased, the path kept (`/` when empty), the fragment
 * dropped, query parameters named `utm_*`, `fbclid`, `gclid`, `ref`, `ref_` or `tag` (any case)
 * removed, the rest kept (blank values too) and sorted. A name has its whitespace collapsed; its
 * key is case-folded. With no target, no drop and no restock rule, the drop rule is 500 bp.
 * The regional storefront rewrite of S§5.8 is not part of this subject (regional URL area).
 */
export type IntakeWatch = (input: IntakeInput) => IntakeDecision;

export type Provenance = 'test-assertion' | 'function-reading' | 'offline-run' | 'spec';

export interface CaseSource {
  readonly how: Provenance;
  readonly ref: string;
}

export interface IntakeCase {
  readonly id: string;
  readonly what: string;
  readonly input: IntakeInput;
  readonly expected: IntakeDecision;
  readonly from: readonly [CaseSource, ...CaseSource[]];
  readonly notes?: string;
  readonly divergence?: string;
  readonly specDerived?: true;
  readonly specSilent?: true;
}
