// The matcher's input and output (S§5.4 tiers 1-2). The fixture corpus states the same contract in
// evals/corpus/areas/match-title-rules/contract.ts; core cannot import from evals, so the shapes
// are defined here and the corpus tests check that this function satisfies that contract.
import type { MatchRelation, SearchIntent } from '@agentic-dasher/shared';

/**
 * What was asked: the identity part of SearchIntent. `name` is the text the title rules read;
 * brand, model, MPN and GTIN are what tier 1 compares; `mustHave` is checked after the label.
 */
export type MatchAsked = Pick<
  SearchIntent,
  'name' | 'brand' | 'model' | 'mpn' | 'gtin' | 'mustHave' | 'packQuantity'
>;

/** What a listing shows, as a reader produced it (S§4.1 listing, plus its identifiers). */
export interface MatchListing {
  readonly title: string;
  /** The brand the store states as a field, not one parsed from the title. */
  readonly brand: string | null;
  /** The MPN or model number the page states as its own product's. */
  readonly mpn: string | null;
  /** The GTIN as read, not validated: tier 1 validates the check digit. */
  readonly gtin: string | null;
  /** The selected variant's options as the store names them. */
  readonly variant: Readonly<Record<string, string>>;
  /** The canonical URL. A model number in its path is supporting evidence, never identity. */
  readonly url: string | null;
}

export interface MatchInput {
  readonly asked: MatchAsked;
  readonly listing: MatchListing;
}

/** Which tier decided (S§4.1 `match_verdict.decided_by`, the two code values). */
export type MatchTier = 'identifier' | 'rules';

/** The answer: a relation label and the attributes that differ, never a score. */
export interface MatchOutput {
  readonly relation: MatchRelation;
  /** Distinct attribute names (`AttributeName`). Empty for `exact`. */
  readonly differingAttrs: readonly string[];
}

/** The answer with the tier that decided it and the rule that fired, for the verdict record. */
export interface MatchDecision extends MatchOutput {
  readonly decidedBy: MatchTier;
  /** A short machine-readable name of the rule that fired (diagnostic, never shown as a fact). */
  readonly rule: string;
}
