// S§5.5 effective and landed prices, derived in code from what a reader read, with the list of
// missing components (S§4.1 price_observation). Pure: no clock, no I/O, no model.
//
// Definitions (S§5.5, the owner's ruling of 2026-11-23, S§9 #10):
// - effective = sticker - automatic discount. Only a discount the store applies to every buyer
//   without a clip or a code counts. A coupon the buyer must clip or enter, and a member price
//   (it needs a membership the engine cannot vouch for), are stored beside it and never lower it.
//   No sticker, no effective price. A discount larger than the sticker is a misread and refused.
// - landed = effective + shipping + tax when stated and not included + duty estimate when made.
//   It exists only when effective does and no component is missing; it is never below effective.
// - missing components, in the order of PRICE_COMPONENTS. The shared schema fixes most of them;
//   the three cases it leaves to this policy are decided here:
//   * shipping `estimated`: listed. An estimate is not a known component, and a landed total
//     needs known shipping, so listing it keeps the rule "no landed total exactly when something
//     is listed or there is no effective price".
//   * tax not included and no amount: listed, in every country. US and Canadian prices are
//     "before tax" (S§5.5) and the tax is a component nobody stated; a price stated as excluding
//     tax elsewhere (a B2B shop in the EU) is no different. A delivered total that leaves out a
//     charge the buyer pays is a wrong number. A country whose shelf prices include tax gets a
//     landed total when the page says the tax is included; its default only labels (taxLabel).
//   * no duty estimate: not listed. Owner decision #10's default makes no duty estimate, so
//     listing it would forbid every landed total; the buyer's market steers every read to a
//     domestic storefront (S§2.3). A duty estimate that is supplied is added.
// - Unknown is a value (S§2.10): unknown or conditional shipping never becomes zero, and an
//   unknown tax flag never becomes "included" (the record keeps null; only the label uses the
//   country default, and says so).
import {
  type Availability,
  type ListingCurrency,
  type PriceComponent,
  PriceObservation,
  type PriceUnit,
  type RawCandidate,
  type ReadMethod,
  type Rung,
  SHIPPING_STATUSES,
  type ShippingStatus,
  UNKNOWN_CURRENCY,
} from '@agentic-dasher/shared';
import { countryCode } from '../currency/countries.ts';
import { isAmount, ok, type PricesResult, refuse, timestampMs } from './common.ts';

/**
 * The price fields a reader read (S§4.1). The names are those of packages/sources `ListingRead`;
 * `automaticDiscount`, `tax` and `dutyEstimate` are not read yet and may be left out.
 */
export interface PriceReading {
  readonly currency: ListingCurrency;
  readonly sticker: number | null;
  /** An amount off the sticker that the store applies without a clip or a code. */
  readonly automaticDiscount?: number | null;
  /** The amount off of a coupon the buyer must clip or enter. Never lowers the effective price. */
  readonly coupon: number | null;
  /** A price for members. Never lowers the effective price. */
  readonly memberPrice: number | null;
  readonly shipping: number | null;
  readonly shippingStatus: ShippingStatus;
  /** A tax amount the page states. */
  readonly tax?: number | null;
  readonly taxIncluded: boolean | null;
  readonly dutyEstimate?: number | null;
}

/** What `price_observation` stores beside the fields read. */
export interface DerivedPrices {
  readonly effective: number | null;
  readonly landed: number | null;
  readonly missingComponents: PriceComponent[];
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Derives `effective`, `landed` and `missingComponents` from what a reader read. Refuses, never
 * repairs, a reading that cannot make a valid record: an amount that is not a non-negative safe
 * integer, any amount beside currency `unknown`, a shipping amount that does not go with its
 * status, an automatic discount with no sticker or above it, and a total beyond 2^53 - 1.
 */
export function derivePrices(reading: PriceReading): PricesResult<DerivedPrices> {
  const {
    currency,
    sticker,
    coupon,
    memberPrice,
    shipping,
    shippingStatus,
    taxIncluded,
    automaticDiscount = null,
    tax = null,
    dutyEstimate = null,
  } = reading;
  const amounts = { sticker, automaticDiscount, coupon, memberPrice, shipping, tax, dutyEstimate };
  for (const [field, value] of Object.entries(amounts)) {
    if (value !== null && !isAmount(value)) {
      return refuse('invalid_amount', `${field} is not a non-negative safe integer: ${value}`);
    }
    if (value !== null && currency === UNKNOWN_CURRENCY) {
      return refuse(
        'amount_without_currency',
        `${field} has an amount but the currency is unknown`,
      );
    }
  }
  if (!SHIPPING_STATUSES.includes(shippingStatus)) {
    return refuse('invalid_input', `not a shipping status: ${String(shippingStatus)}`);
  }
  if (taxIncluded !== null && typeof taxIncluded !== 'boolean') {
    return refuse('invalid_input', 'taxIncluded is true, false or null');
  }
  const shippingHasAmount = shippingStatus === 'known' || shippingStatus === 'estimated';
  if (shippingHasAmount !== (shipping !== null)) {
    return refuse(
      'shipping_status_mismatch',
      `shipping ${shippingStatus} ${shippingHasAmount ? 'needs' : 'carries no'} amount`,
    );
  }

  let effective: number | null = null;
  if (sticker !== null) {
    const off = automaticDiscount ?? 0;
    if (off > sticker) {
      return refuse('discount_exceeds_sticker', `discount ${off} is above the sticker ${sticker}`);
    }
    effective = sticker - off;
  } else if (automaticDiscount !== null) {
    return refuse('discount_without_sticker', 'an automatic discount needs a sticker');
  }

  const missing = new Set<PriceComponent>();
  if (sticker === null) missing.add('sticker');
  if (shippingStatus !== 'known') missing.add('shipping');
  if (taxIncluded === null || (taxIncluded === false && tax === null)) missing.add('tax');

  let landed: number | null = null;
  if (effective !== null && missing.size === 0) {
    let total = BigInt(effective) + BigInt(shipping ?? 0) + BigInt(dutyEstimate ?? 0);
    if (taxIncluded === false) total += BigInt(tax ?? 0);
    if (total > MAX) {
      return refuse('out_of_range', 'the landed total is beyond 2^53 - 1 minor units');
    }
    landed = Number(total);
  }
  const order: readonly PriceComponent[] = ['sticker', 'shipping', 'tax', 'duty_estimate'];
  return ok({ effective, landed, missingComponents: order.filter((c) => missing.has(c)) });
}

/**
 * A reader's `ListingRead` (packages/sources) plus the time of the read: everything an
 * observation record needs besides its database ids. A `ListingRead` spread into it with
 * `observedAt` added fits as it is.
 */
export interface ObservationReadInput extends PriceReading {
  /** UTC, `YYYY-MM-DDTHH:MM:SS.sssZ` (S§4). */
  readonly observedAt: string;
  /** The reader method; stored as `readPath`. */
  readonly method: ReadMethod;
  readonly rung: Rung;
  /** A struck-through or "was" price: stored as a claim, never a baseline (S§5.5). */
  readonly referenceClaimed: number | null;
  readonly unitPrice: number | null;
  readonly unit: PriceUnit | null;
  readonly availability: Availability;
  /** Every figure read, as text; stored as `rawCandidates`. */
  readonly candidates: readonly RawCandidate[];
}

/** A `price_observation` row without its database ids. */
export type ObservationRecord = Omit<PriceObservation, 'id' | 'listingId'>;

/**
 * Builds the `price_observation` record of a read, minus `id` and `listingId`. Checked against
 * the shared PriceObservation schema (the mirror of the SQL CHECKs) before it is returned, so a
 * read that cannot be stored is refused here: a failed read (no price, not out of stock, nothing
 * kept), a sticker with no raw candidate, a unit price without its unit, more than 20 candidates.
 */
export function buildObservationRecord(
  input: ObservationReadInput,
): PricesResult<ObservationRecord> {
  if (timestampMs(input.observedAt) === null) {
    return refuse('invalid_timestamp', `not a S§4 timestamp: ${String(input.observedAt)}`);
  }
  for (const [field, value] of [
    ['referenceClaimed', input.referenceClaimed],
    ['unitPrice', input.unitPrice],
  ] as const) {
    if (value !== null && !isAmount(value)) {
      return refuse('invalid_amount', `${field} is not a non-negative safe integer: ${value}`);
    }
    if (value !== null && input.currency === UNKNOWN_CURRENCY) {
      return refuse(
        'amount_without_currency',
        `${field} has an amount but the currency is unknown`,
      );
    }
  }
  const derived = derivePrices(input);
  if (!derived.ok) return derived;
  const record: ObservationRecord = {
    observedAt: input.observedAt,
    currency: input.currency,
    sticker: input.sticker,
    referenceClaimed: input.referenceClaimed,
    coupon: input.coupon,
    memberPrice: input.memberPrice,
    shipping: input.shipping,
    shippingStatus: input.shippingStatus,
    tax: input.tax ?? null,
    taxIncluded: input.taxIncluded,
    dutyEstimate: input.dutyEstimate ?? null,
    unitPrice: input.unitPrice,
    unit: input.unit,
    effective: derived.value.effective,
    landed: derived.value.landed,
    missingComponents: derived.value.missingComponents,
    availability: input.availability,
    readPath: input.method,
    rung: input.rung,
    rawCandidates: input.candidates.map((c) => ({ ...c })),
  };
  // The ids are placeholders: the schema needs them, the record does not carry them.
  const checked = PriceObservation.safeParse({ id: 1, listingId: 1, ...record });
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    return refuse('not_a_record', `${where}: ${issue?.message ?? 'refused by PriceObservation'}`);
  }
  return ok(record);
}

/** How a country's shelf prices treat tax when the page says nothing (S§5.5). */
export type ShelfTaxConvention = 'included' | 'before_tax';

/** US and Canadian shelf prices are before sales tax (S§5.5). */
const BEFORE_TAX = new Set(['US', 'CA']);

/**
 * Countries whose consumer shelf prices must include tax: the EU and EEA (Directive 98/6/EC, the
 * selling price includes VAT), the euro-area storefront key `EU`, the United Kingdom (Price
 * Marking Order 2004), Switzerland (Price Indication Ordinance), Australia (single price rule,
 * Australian Consumer Law s48), New Zealand (GST-inclusive consumer prices) and Japan (total-price
 * display, since April 2021). Every other country has no default here.
 */
const TAX_INCLUDED = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'IS',
  'LI',
  'NO',
  'EU',
  'GB',
  'CH',
  'AU',
  'NZ',
  'JP',
]);

/** The shelf-price tax convention of a country (ISO 3166-1 alpha-2), or null when none is known. */
export function shelfTaxConvention(country: string | null): ShelfTaxConvention | null {
  const code = countryCode(country);
  if (code === null) return null;
  if (BEFORE_TAX.has(code)) return 'before_tax';
  return TAX_INCLUDED.has(code) ? 'included' : null;
}

/**
 * The tax label a price carries (owner decision #10: tax label only). What the page states wins
 * (`basis: 'read'`); otherwise the country default (`basis: 'country'`); otherwise `unknown`. The
 * label never changes the record: a country default does not make a landed total.
 */
export type TaxLabel =
  | { readonly label: 'included' | 'before_tax'; readonly basis: 'read' | 'country' }
  | { readonly label: 'unknown'; readonly basis: null };

export function taxLabel(taxIncluded: boolean | null, country: string | null): TaxLabel {
  if (taxIncluded === true) return { label: 'included', basis: 'read' };
  if (taxIncluded === false) return { label: 'before_tax', basis: 'read' };
  const convention = shelfTaxConvention(country);
  return convention === null
    ? { label: 'unknown', basis: null }
    : { label: convention, basis: 'country' };
}
