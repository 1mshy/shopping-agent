// The matcher's code tiers (S§5.4 tiers 1-2): identifiers, then title rules, then the must-have
// check. Pure: no I/O, no clock, no model. `unknown` means the code tiers cannot decide, and the
// listing goes to the model judge (tier 3) or stays "unconfirmed".
import type { MatchRelation } from '@agentic-dasher/shared';
import { analyseAsked, analyseListing } from './analyse.ts';
import { mpnConflict, tier1 } from './identifiers.ts';
import { attributeKey, checkMustHave } from './must-have.ts';
import { applyRules } from './rules.ts';
import type { MatchDecision, MatchInput, MatchOutput } from './types.ts';

/** Title relations that deny identity outright (a variant still names the product). */
const REJECTIONS: ReadonlySet<MatchRelation> = new Set([
  'accessory_or_part',
  'other_line',
  'other_model',
  'bundle',
]);

/**
 * Bumped whenever a rule, a word class or the precedence changes, so that cached verdicts made
 * by an older matcher are not reused (S§5.4 verdict cache key).
 */
export const MATCHER_VERSION = 'matcher-t12.3';

const decision = (
  relation: MatchRelation,
  attrs: readonly string[],
  decidedBy: MatchDecision['decidedBy'],
  rule: string,
): MatchDecision => ({
  relation,
  differingAttrs: relation === 'exact' ? [] : [...new Set(attrs.map(attributeKey))],
  decidedBy,
  rule,
});

/**
 * The decision with the tier that made it and the rule that fired:
 * 1. identifiers and title rules agree, or one is silent: the title's label, or `exact` when an
 *    identifier confirms a title that names nothing against it;
 * 2. an identifier match against a title the rules reject: `unknown` (neither decides);
 * 3. an `exact` is then checked against the must-have attributes (a stated conflict is a
 *    `variant`), and, when no identifier confirmed it, against the page's own identifiers: two
 *    valid GTINs that differ, or another part number, leave it `unknown`.
 */
export function decideMatch(input: MatchInput): MatchDecision {
  const { asked, listing } = input;
  const a = analyseAsked(asked);
  const l = analyseListing(listing);
  const title = applyRules(a, l, asked, listing);
  // The asked MPN when the intent has one; otherwise the model codes its name states (a name such
  // as "dewalt dcd793d1" carries its model number, and the brand still has to be confirmed).
  const askedMpns = typeof asked.mpn === 'string' && asked.mpn !== '' ? [asked.mpn] : a.codes;
  const ids = tier1({
    askedGtin: asked.gtin,
    askedMpns,
    brandConfirmed: title.brandConfirmed,
    listingGtin: listing.gtin,
    listingMpn: listing.mpn,
  });
  const byIdentifier = ids.kind === 'gtin' || ids.kind === 'mpn';

  if (byIdentifier && REJECTIONS.has(title.relation)) {
    return decision('unknown', [], 'rules', `${ids.kind}_vs_${title.rule}`);
  }
  const exact = title.relation === 'exact' || (byIdentifier && title.relation === 'unknown');
  if (!exact) return decision(title.relation, title.differingAttrs, 'rules', title.rule);

  const decidedBy = byIdentifier ? 'identifier' : 'rules';
  const check = checkMustHave(asked.mustHave, l.own, l.prepared, l.variantTokens);
  if (check.kind === 'conflict') return decision('variant', check.attrs, decidedBy, 'must_have');
  if (check.kind === 'incomparable') {
    return decision('unknown', [], decidedBy, 'must_have_incomparable');
  }
  if (!byIdentifier) {
    // The title names the product, but the page's own identifiers say another item. A match
    // needs positive evidence, and here the evidence disagrees, so the code tiers do not decide.
    if (ids.kind === 'gtin_differs') return decision('unknown', [], 'rules', 'gtin_differs');
    if (mpnConflict(asked.mpn, a.codes, listing.mpn)) {
      return decision('unknown', [], 'rules', 'mpn_differs');
    }
  }
  return decision('exact', [], decidedBy, byIdentifier ? ids.kind : title.rule);
}

/** The matcher of S§5.4 tiers 1-2: a relation label and the attributes that differ. */
export function matchListing(input: MatchInput): MatchOutput {
  const d = decideMatch(input);
  return { relation: d.relation, differingAttrs: d.differingAttrs };
}
