// The contract of the matcher's code tiers (S§5.4 tiers 1-2, `packages/core/matching`, plan P1
// workstream 4) as the fixture corpus states it. Shared by the areas match-title-rules,
// match-identifiers, match-owner-rulings and known-failure-wrong-variant, which re-export it.
//
// The subject decides how one listing relates to what was asked. It answers with a relation
// label (MATCH_RELATIONS) and the attributes that differ, never with a numeric score. `unknown`
// means the code tiers cannot decide: the listing goes to the model judge (tier 3) or stays
// "unconfirmed" (S§5.4). No price is an input: the outlier rule (S§5.5) is another unit.
//
// Signature for Phase 1:  matchListing(input: MatchInput): MatchOutput  (pure, no I/O).
import {
  AttributeName,
  distinct,
  Gtin14,
  Listing,
  MATCH_RELATIONS,
  type MatchRelation,
  MatchRelation as MatchRelationSchema,
  PlannerIntent,
  type SearchIntent,
} from '@agentic-dasher/shared';
import { z } from 'zod';

/**
 * What was asked: the identity part of SearchIntent (S§5.4). `name` is the text the title rules
 * read; brand, model, MPN and GTIN are the identifiers tier 1 compares. Every case ported from the
 * predecessor sets only `name` (its query, verbatim) and leaves the identifiers null, because the
 * predecessor's query was one string: it never had structured identifiers on the asked side.
 */
export type MatchAsked = Pick<
  SearchIntent,
  'name' | 'brand' | 'model' | 'mpn' | 'gtin' | 'mustHave' | 'packQuantity'
>;

/** What the listing shows, as a reader produced it (S§4.1 listing, plus its identifiers). */
export interface MatchListing {
  /** `Listing.title`. */
  readonly title: string;
  /** The brand the store states as a field (structured data), not one parsed from the title. */
  readonly brand: string | null;
  /** The MPN or model number the page states as its own product's (structured data or label). */
  readonly mpn: string | null;
  /** The GTIN as read, not validated: tier 1 validates the check digit (S§5.4). */
  readonly gtin: string | null;
  /** `Listing.variant`: the selected variant's options as the store names them. */
  readonly variant: Readonly<Record<string, string>>;
  /** `Listing.urlCanonical`. The predecessor read model numbers from the URL path (specSilent). */
  readonly url: string | null;
}

export interface MatchInput {
  readonly asked: MatchAsked;
  readonly listing: MatchListing;
}

/** The answer. `exact` has no differing attribute (S§5.4, as `MatchVerdict` enforces). */
export interface MatchOutput {
  readonly relation: MatchRelation;
  /** Distinct `AttributeName`s. No ported case asserts them: the predecessor recorded none. */
  readonly differingAttrs: readonly string[];
}

/**
 * What a case expects. `relation`: the evidence fixes one label. `oneOf`: the evidence supports only
 * this set (two or more labels, never `exact`: an exact expectation rests on positive evidence, so
 * it is never one option among others).
 */
export type MatchExpected =
  | { readonly relation: MatchRelation }
  | { readonly oneOf: readonly MatchRelation[] };

/**
 * Where a case's input or expectation comes from.
 * - test: an assertion of a predecessor test (`pricewatch/tests/<file>::<test>`, with the row);
 * - review: a hand-review label (`scripts/eval/<file>` product.store);
 * - report: a predecessor report or log line (`reports/<file>:<line>`);
 * - code: reading a predecessor function or its comment (`<file>:<line>`);
 * - run: the pure predecessor function run offline (`matching.score` etc. and its value);
 * - spec: the clause of docs/spec.md that fixes the label (never the only evidence).
 */
export type EvidenceKind = 'test' | 'review' | 'report' | 'code' | 'run' | 'spec';

export interface Evidence {
  readonly kind: EvidenceKind;
  readonly ref: string;
}

export interface MatchCase {
  /** Kebab-case, unique in its area. */
  readonly id: string;
  /** One line: what the case pins. */
  readonly what: string;
  readonly input: MatchInput;
  readonly expected: MatchExpected;
  readonly from: readonly Evidence[];
  /** How the relation label was decided from the evidence. */
  readonly label: string;
  /** The predecessor did otherwise; the case follows the spec. Says what and why. */
  readonly divergence?: string;
  /** The predecessor had this behaviour and the spec does not mention it. */
  readonly specSilent?: true;
  /** A question for the owner before Phase 1 relies on this label. */
  readonly ownerCheck?: string;
}

/** Every relation but `exact`: the evidence says "not the product" and nothing more. */
export const NOT_EXACT: readonly MatchRelation[] = MATCH_RELATIONS.filter((r) => r !== 'exact');

/** A decided rejection: not the product, and not `unknown` (the predecessor's rules decided). */
export const REJECTED: readonly MatchRelation[] = NOT_EXACT.filter((r) => r !== 'unknown');

/** The relations a case accepts. */
export function acceptedRelations(expected: MatchExpected): readonly MatchRelation[] {
  return 'relation' in expected ? [expected.relation] : expected.oneOf;
}

/** An asked side carrying only the text, as every predecessor query was. */
export function asked(name: string): MatchAsked {
  return {
    name,
    brand: null,
    model: null,
    mpn: null,
    gtin: null,
    mustHave: [],
    packQuantity: null,
  };
}

/** A listing with a title and, optionally, the other fields a reader may set. */
export function listing(
  title: string,
  more: Partial<Omit<MatchListing, 'title'>> = {},
): MatchListing {
  return { title, brand: null, mpn: null, gtin: null, variant: {}, url: null, ...more };
}

// ── runtime checks: a malformed case fails its test with a TypeError, not as pending ──────────

const AskedSchema = PlannerIntent.pick({
  name: true,
  brand: true,
  model: true,
  mustHave: true,
  packQuantity: true,
}).extend({
  mpn: z.string().min(1).max(64).nullable(),
  gtin: Gtin14.nullable(),
});

const ListingSchema = Listing.pick({ title: true, variant: true }).extend({
  brand: z.string().min(1).max(200).nullable(),
  mpn: z.string().min(1).max(200).nullable(),
  gtin: z.string().min(1).max(64).nullable(),
  url: Listing.shape.urlCanonical.nullable(),
});

const POSITIVE: readonly EvidenceKind[] = ['test', 'review', 'report', 'run'];

/** Throws a TypeError naming the problem when a case is malformed. */
export function checkCase(c: MatchCase): void {
  const fail = (why: string): never => {
    throw new TypeError(`case ${c.id}: ${why}`);
  };
  const a = AskedSchema.safeParse(c.input.asked);
  if (!a.success) fail(`asked: ${a.error.message}`);
  const l = ListingSchema.safeParse(c.input.listing);
  if (!l.success) fail(`listing: ${l.error.message}`);
  if (c.what.trim() === '' || c.label.trim() === '') fail('what and label must say something');
  if (c.from.length === 0) fail('names no evidence');
  if (c.from.every((e) => e.kind === 'spec')) fail('the spec alone is not evidence of a behaviour');
  for (const e of c.from) if (e.ref.trim() === '') fail('an evidence ref is empty');
  if (c.divergence !== undefined && c.divergence.trim() === '') fail('empty divergence');
  if (c.ownerCheck !== undefined && c.ownerCheck.trim() === '') fail('empty ownerCheck');
  if ('relation' in c.expected) {
    if (!MatchRelationSchema.safeParse(c.expected.relation).success) fail('unknown relation');
    if (c.expected.relation === 'exact' && !c.from.some((e) => POSITIVE.includes(e.kind))) {
      fail('an exact expectation needs a positive assertion: a test, review, report or run');
    }
  } else {
    const set = c.expected.oneOf;
    if (set.length < 2) fail('oneOf needs two or more relations; use relation');
    if (new Set(set).size !== set.length) fail('oneOf repeats a relation');
    for (const r of set)
      if (!MatchRelationSchema.safeParse(r).success) fail(`unknown relation ${r}`);
    if (set.includes('exact')) fail('exact is never one option among others');
  }
}

const OutputSchema = z
  .strictObject({ relation: MatchRelationSchema, differingAttrs: distinct(AttributeName, 10) })
  .refine((o) => o.relation !== 'exact' || o.differingAttrs.length === 0, {
    message: 'an exact match has no differing attribute (S§5.4)',
  });

/** Throws when an answer breaks the output contract; returns the relations the case accepts. */
export function checkOutput(c: MatchCase, actual: MatchOutput): readonly MatchRelation[] {
  const parsed = OutputSchema.safeParse(actual);
  if (!parsed.success) throw new TypeError(`case ${c.id}: output: ${parsed.error.message}`);
  return acceptedRelations(c.expected);
}
