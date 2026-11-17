// S§4.1 listing and price_observation.
import { z } from 'zod';
import { AmountMinor, AttributeName, distinct, Id, Timestamp } from './common.ts';
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

/** One purchasable thing at one place (S§4.1, S§8). Catalogue data: not user-owned. */
export const Listing = z.strictObject({
  id: Id,
  productId: Id.nullable(),
  storeId: Id,
  channel: ListingChannel,
  urlCanonical: z.httpUrl().max(2048),
  externalId: ref,
  sku: ref,
  sellerId: ref,
  sellerKind: SellerKind,
  condition: Condition,
  currency: ListingCurrency,
  title: z.string().min(1).max(500),
  variant: z.record(AttributeName, z.string().min(1).max(200)),
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

/**
 * One read of a listing's price and availability (S§4.1). Append-only. One currency for every
 * amount; with `unknown` every amount is null and the figures read stay as text in rawCandidates.
 * `effective` and `landed` are derived by the Phase 1 function in packages/core; this schema
 * guarantees that neither is present without the components it needs.
 */
export const PriceObservation = z
  .strictObject({
    id: Id,
    listingId: Id,
    observedAt: Timestamp,
    currency: ListingCurrency,
    sticker: amount,
    referenceClaimed: amount,
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
  })
  .superRefine((o, ctx) => {
    const refuse = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (o.currency === UNKNOWN_CURRENCY) {
      for (const field of OBSERVATION_AMOUNT_FIELDS) {
        if (o[field] !== null)
          refuse(field, 'currency is unknown, so every amount is null (S§2.2)');
      }
    }
    const shippingHasAmount = o.shippingStatus === 'known' || o.shippingStatus === 'estimated';
    if (shippingHasAmount !== (o.shipping !== null)) {
      refuse('shipping', 'an amount goes with known or estimated shipping only');
    }
    if ((o.unitPrice === null) !== (o.unit === null)) {
      refuse('unit', 'a unit price and its unit come together');
    }
    if (o.effective !== null && (o.sticker === null || o.missingComponents.includes('sticker'))) {
      refuse('effective', 'an effective price needs the sticker price');
    }
    if (
      o.landed !== null &&
      (o.effective === null || o.shippingStatus !== 'known' || o.missingComponents.length > 0)
    ) {
      refuse('landed', 'a landed price needs the effective price, known shipping, nothing missing');
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
