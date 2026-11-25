// Product identity, S§5.4 tiers 1-2: deterministic, no I/O, no model.
export { compareCodes, mpnForms, sameMpn } from './codes.ts';
export {
  canonicalText,
  cleanUrl,
  fnv1a64,
  type ListingIdentity,
  listingFingerprint,
  listingFingerprintParts,
  specFingerprint,
  type VerdictKeyParts,
  verdictKey,
} from './fingerprint.ts';
export { gtinCheckDigitHolds, normaliseGtin } from './gtin.ts';
export { brandFieldMatches, mpnConflict, normaliseBrand, tier1 } from './identifiers.ts';
export { decideMatch, MATCHER_VERSION, matchListing } from './match.ts';
export { attributeKey, checkMustHave } from './must-have.ts';
export { titleRules } from './rules.ts';
export type {
  MatchAsked,
  MatchDecision,
  MatchInput,
  MatchListing,
  MatchOutput,
  MatchTier,
} from './types.ts';
export { type CurrentVersions, effectiveVerdict, isCurrent } from './verdicts.ts';
