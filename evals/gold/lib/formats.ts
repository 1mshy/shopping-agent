// File formats of a gold set (S§5.16). Each is a plain JSON file a person can diff and edit;
// objects are strict, so a misspelt key is an error rather than silently ignored.
import { Condition, ListingCurrency, MatchRelation, SellerKind } from '@agentic-dasher/shared';
import { z } from 'zod';

/** Written into every manifest and worklist the tools produce. Bump on a behaviour change. */
export const GOLD_TOOL_VERSION = 'gold-tools/1';

/** A stable id: lower-case letters, digits, `.`, `_`, `-`. Doubles as a file name. */
export const GoldId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/, 'a lower-case slug id');
/** An opaque labeller handle such as `l1`: never a name or an email. */
export const LabellerId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, 'an opaque handle');
/** ISO 3166-1 alpha-2 market code. */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'an ISO 3166-1 alpha-2 code');
const Text = z.string().trim().min(1);

/** GTIN-8/12/13/14 with a valid check digit, normalised to 14 digits (S§5.4); else null. */
export function normaliseGtin(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  const g = digits.padStart(14, '0');
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(g[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[13]) ? g : null;
}

/** Lower-case, NFKC, letters and digits only: `Brand-X 100/B` and `brandx100b` are equal. */
export const normaliseToken = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * What a matcher is asked to find. Mirrors the identity part of SearchIntent (S§5.4) but is kept
 * self-contained; align the two once the project's SearchIntent schema lands.
 */
export const ProductIdentity = z.strictObject({
  brand: Text,
  model: Text.optional(),
  mpn: Text.optional(),
  gtin: z
    .string()
    .refine((g) => normaliseGtin(g) !== null, 'GTIN check digit')
    .optional(),
  /** Attributes a listing must have to be `exact`, e.g. `{ "capacity": "256 GB" }`. */
  mustHave: z.record(z.string(), Text),
  condition: Condition,
  packQuantity: z.int().min(1),
});

export const GoldProduct = z.strictObject({
  id: GoldId,
  /** Owner-chosen category id; the set has six (S§5.16). */
  category: GoldId,
  /** The market whose stores the snapshots come from. */
  country: CountryCode,
  identity: ProductIdentity,
  notes: z.string().optional(),
});
export type GoldProduct = z.infer<typeof GoldProduct>;

/** The frozen fields a matcher sees. Values are as read from the page: a GTIN here is not validated. */
export const ListingFields = z.strictObject({
  title: Text,
  brand: Text.optional(),
  model: Text.optional(),
  mpn: Text.optional(),
  gtin: Text.optional(),
  variantAttributes: z.record(z.string(), z.string()),
  condition: Condition,
  sellerKind: SellerKind,
  storeHost: Text,
});

export const ListingSnapshot = z.strictObject({
  id: GoldId,
  /** The gold product this listing was retrieved for. */
  productId: GoldId,
  capture: z.strictObject({
    url: z.url(),
    country: CountryCode,
    capturedAt: z.iso.datetime({ offset: true }),
  }),
  listing: ListingFields,
  /**
   * Context for the labeller only, NOT an input to matching. A price is the text as read plus
   * its currency code (or `unknown`), never a number (S§2.1, S§2.2).
   */
  context: z.strictObject({ priceText: z.string(), currency: ListingCurrency }).optional(),
});
export type ListingSnapshot = z.infer<typeof ListingSnapshot>;

/**
 * `primary`: the label of record. `second`: the independent second label on a worklist item.
 * `adjudicated`: a later ruling that replaces the primary label as gold; agreement is always
 * computed between primary and second, so adjudication never changes the agreement figure.
 */
export const LABEL_PASSES = ['primary', 'second', 'adjudicated'] as const;

export const RelationLabel = z.strictObject({
  snapshotId: GoldId,
  /** The relation vocabulary of S§4.1/S§5.4, from @agentic-dasher/shared. */
  relation: MatchRelation,
  labellerId: LabellerId,
  labelledAt: z.iso.datetime({ offset: true }),
  pass: z.enum(LABEL_PASSES),
  note: z.string().optional(),
});
export type RelationLabel = z.infer<typeof RelationLabel>;

export const SPLIT_SIDES = ['dev', 'held_out'] as const;
export type SplitSide = (typeof SPLIT_SIDES)[number];

export const SplitManifest = z.strictObject({
  formatVersion: z.literal(1),
  seed: z.string().min(1),
  /** The tool version of the last run that wrote this file. */
  toolVersion: z.string(),
  assignments: z.array(
    z.strictObject({
      productId: GoldId,
      side: z.enum(SPLIT_SIDES),
      /** 1 for the first run, then +1 for each run that assigned or retired something. */
      run: z.int().min(1),
      /** A rotated-out product stays listed on its side and is no longer measured. */
      retired: z.strictObject({ run: z.int().min(1), reason: Text }).optional(),
    }),
  ),
});
export type SplitManifest = z.infer<typeof SplitManifest>;

/** What the second labeller sees: the product identity and the frozen listing, never a label. */
export const DoubleLabelWorklist = z.strictObject({
  formatVersion: z.literal(1),
  seed: z.string().min(1),
  toolVersion: z.string(),
  rate: z.number().gt(0).max(1),
  items: z.array(
    z.strictObject({
      snapshotId: GoldId,
      productId: GoldId,
      identity: ProductIdentity,
      listing: ListingFields,
    }),
  ),
});
export type DoubleLabelWorklist = z.infer<typeof DoubleLabelWorklist>;

export interface GoldSet {
  products: GoldProduct[];
  snapshots: ListingSnapshot[];
  labels: RelationLabel[];
  split?: SplitManifest;
  worklist?: DoubleLabelWorklist;
}

/** Keys that identify the same real-world product: normalised GTIN, normalised brand + MPN. */
export function identityKeys(p: GoldProduct): string[] {
  const keys: string[] = [];
  const gtin = p.identity.gtin ? normaliseGtin(p.identity.gtin) : null;
  if (gtin) keys.push(`gtin:${gtin}`);
  if (p.identity.mpn) {
    keys.push(`mpn:${normaliseToken(p.identity.brand)}|${normaliseToken(p.identity.mpn)}`);
  }
  return keys;
}
