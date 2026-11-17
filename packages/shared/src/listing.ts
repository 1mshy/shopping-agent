// S§4.1 listing and price_observation.
import { z } from 'zod';
import { AmountMinor, distinct, Id, StoreText, Timestamp } from './common.ts';
import { ListingCurrency, UNKNOWN_CURRENCY } from './currency.ts';
import {
  Availability,
  Condition,
  ListingChannel,
  PriceComponent,
  PriceUnit,
  ReadMethod,
  Rung,
  SellerKind,
  ShippingStatus,
} from './vocab.ts';

const ref = z.string().min(1).max(256).nullable();

/**
 * An http(s) URL without user-info: credentials never sit in a stored URL. Checked on the text
 * (no `@` in the authority), because packages/core loads no DOM or Node types for `URL`.
 */
const CanonicalUrl = z
  .httpUrl()
  .max(2048)
  .regex(/^https?:\/\/[^/?#@]+(?:[/?#]|$)/i, 'a canonical URL carries no user-info');

/**
 * One purchasable thing at one place (S§4.1, S§8). Catalogue data: not user-owned. There is no
 * status field: a listing's state is derived from `goneAt`, `trackable` and `consecutiveErrors`.
 */
export const Listing = z.strictObject({
  id: Id,
  productId: Id.nullable(),
  storeId: Id,
  channel: ListingChannel,
  urlCanonical: CanonicalUrl,
  externalId: ref,
  sku: ref,
  sellerId: ref,
  sellerKind: SellerKind,
  condition: Condition,
  currency: ListingCurrency,
  title: z.string().min(1).max(500),
  /** Variant options as the store names them ("Size": "XL", "option1": "Black"). */
  variant: z.record(StoreText, z.string().min(1).max(200)),
  trackable: z.boolean(),
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
  goneAt: Timestamp.nullable(),
  consecutiveErrors: z.int().nonnegative(),
});
export type Listing = z.infer<typeof Listing>;

/** One price candidate as read, kept as text (S§5.2); the confidence is assigned by code. */
export const RawCandidate = z.strictObject({
  method: ReadMethod,
  confidence: z.number().min(0).max(1),
  value: z.string().min(1).max(256),
});
export type RawCandidate = z.infer<typeof RawCandidate>;

/** Every amount field of an observation: integer minor units of the observation's currency. */
export const OBSERVATION_AMOUNT_FIELDS = [
  'sticker',
  'referenceClaimed',
  'coupon',
  'memberPrice',
  'shipping',
  'tax',
  'dutyEstimate',
  'unitPrice',
  'effective',
  'landed',
] as const;

const amount = AmountMinor.nullable();

const fields = z.strictObject({
  id: Id,
  listingId: Id,
  observedAt: Timestamp,
  currency: ListingCurrency,
  sticker: amount,
  /** A struck-through or "was" price: a claim, never a baseline (S§5.5). */
  referenceClaimed: amount,
  /** An amount off. A percentage coupon becomes an amount only when its base is known. */
  coupon: amount,
  memberPrice: amount,
  shipping: amount,
  shippingStatus: ShippingStatus,
  tax: amount,
  taxIncluded: z.boolean().nullable(),
  dutyEstimate: amount,
  unitPrice: amount,
  unit: PriceUnit.nullable(),
  effective: amount,
  landed: amount,
  missingComponents: distinct(PriceComponent, 4),
  availability: Availability,
  readPath: ReadMethod,
  rung: Rung,
  rawCandidates: z.array(RawCandidate).max(20),
});
type Fields = z.infer<typeof fields>;

/**
 * Whether each component must be listed as missing (true), must not be (false), or is left to
 * the Phase 1 derivation's policy (null). Only rules that need no policy are fixed here.
 */
function mustList(o: Fields): Record<PriceComponent, boolean | null> {
  const shipping = { known: false, estimated: null, conditional: true, unknown: true } as const;
  return {
    sticker: o.sticker === null,
    shipping: shipping[o.shippingStatus],
    // taxIncluded false with no amount: listed or not by the "before tax" policy (S§5.5, S§9 #10).
    tax: o.taxIncluded === null ? true : o.taxIncluded || o.tax !== null ? false : null,
    duty_estimate: o.dutyEstimate !== null ? false : null,
  };
}

/**
 * One read of a listing's price and availability (S§4.1). Append-only. One currency for every
 * amount; with `unknown` every amount is null and the figures read stay as text in rawCandidates.
 *
 * `effective` and `landed` are derived by the Phase 1 function in packages/core. This schema
 * guarantees only: `missingComponents` agrees with the fields it describes as far as `mustList`
 * fixes it; `effective` needs a sticker and is at most the sticker; `landed` needs `effective`,
 * known shipping and an empty missing list (so tax inclusion is known), and is at least
 * `effective`. It does not check the arithmetic, nor which taxes or duties a total includes.
 */
export const PriceObservation = fields.superRefine((o, ctx) => {
  const refuse = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (o.currency === UNKNOWN_CURRENCY) {
    for (const field of OBSERVATION_AMOUNT_FIELDS) {
      if (o[field] !== null) refuse(field, 'currency is unknown, so every amount is null (S§2.2)');
    }
  }
  const shippingHasAmount = o.shippingStatus === 'known' || o.shippingStatus === 'estimated';
  if (shippingHasAmount !== (o.shipping !== null)) {
    refuse('shipping', 'an amount goes with known or estimated shipping only');
  }
  if ((o.unitPrice === null) !== (o.unit === null)) {
    refuse('unit', 'a unit price and its unit come together');
  }
  for (const [component, rule] of Object.entries(mustList(o))) {
    if (rule !== null && rule !== o.missingComponents.includes(component as PriceComponent)) {
      refuse('missingComponents', `${component} must ${rule ? '' : 'not '}be listed as missing`);
    }
  }
  if (o.effective !== null && (o.sticker === null || o.effective > o.sticker)) {
    refuse('effective', 'an effective price needs the sticker and is at most the sticker');
  }
  if (
    o.landed !== null &&
    (o.effective === null ||
      o.landed < o.effective ||
      o.shippingStatus !== 'known' ||
      o.missingComponents.length > 0)
  ) {
    refuse('landed', 'a landed price needs effective (≤ landed), known shipping, nothing missing');
  }
  if (o.sticker !== null && o.rawCandidates.length === 0) {
    refuse('rawCandidates', 'a price keeps the candidates it was read from (S§5.2)');
  }
  const keepsText = o.currency === UNKNOWN_CURRENCY && o.rawCandidates.length > 0;
  if (o.sticker === null && o.availability !== 'out' && !keepsText) {
    refuse('sticker', 'no price, no stock signal and nothing read: a failed read (S§2.10)');
  }
});
export type PriceObservation = z.infer<typeof PriceObservation>;
