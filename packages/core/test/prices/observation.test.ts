// S§5.5 effective and landed prices, S§4.1 price_observation. Every record built here is parsed
// with the shared PriceObservation schema, which mirrors the SQL CHECKs of migration 0001.
import {
  type Availability,
  type Condition,
  type ListingCurrency,
  PRICE_COMPONENTS,
  type PriceComponent,
  PriceObservation,
  type PriceUnit,
  type RawCandidate,
  type ReadMethod,
  type Rung,
  SHIPPING_STATUSES,
  type ShippingStatus,
} from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  buildObservationRecord,
  derivePrices,
  type ObservationReadInput,
  type PriceReading,
  shelfTaxConvention,
  taxLabel,
} from '../../src/index.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const OBSERVED_AT = '2026-11-25T09:30:00.000Z';
const CANDIDATE: RawCandidate = { method: 'json_ld', confidence: 0.9, value: '129.99' };

function reading(overrides: Partial<PriceReading> = {}): PriceReading {
  return {
    currency: 'CAD',
    sticker: 12999,
    coupon: null,
    memberPrice: null,
    shipping: 1500,
    shippingStatus: 'known',
    taxIncluded: true,
    ...overrides,
  };
}

function readInput(overrides: Partial<ObservationReadInput> = {}): ObservationReadInput {
  return {
    ...reading(),
    observedAt: OBSERVED_AT,
    method: 'json_ld',
    rung: 'http',
    referenceClaimed: null,
    unitPrice: null,
    unit: null,
    availability: 'in',
    candidates: [CANDIDATE],
    ...overrides,
  };
}

function parses(record: object): boolean {
  return PriceObservation.safeParse({ id: 1, listingId: 1, ...record }).success;
}

describe('derivePrices: effective', () => {
  it('is the sticker when the reader states no automatic discount', () => {
    expect(derivePrices(reading())).toEqual({
      ok: true,
      value: { effective: 12999, landed: 14499, missingComponents: [] },
    });
  });

  it('takes an automatic discount off the sticker, down to zero but never below', () => {
    expect(derivePrices(reading({ automaticDiscount: 2000 }))).toMatchObject({
      ok: true,
      value: { effective: 10999 },
    });
    expect(derivePrices(reading({ automaticDiscount: 12999 }))).toMatchObject({
      ok: true,
      value: { effective: 0, landed: 1500 },
    });
    expect(derivePrices(reading({ automaticDiscount: 13000 }))).toMatchObject({
      ok: false,
      refusal: { code: 'discount_exceeds_sticker' },
    });
  });

  it('never lowers the effective price by a clip or code coupon (owner ruling 2026-11-23)', () => {
    // Known failure: the CA$167.73 sticker with a clip coupon to CA$49.99 (2026-09-02).
    const result = derivePrices(reading({ sticker: 16773, coupon: 11774 }));
    expect(result).toMatchObject({ ok: true, value: { effective: 16773, landed: 18273 } });
  });

  it('never lowers the effective price by a member price', () => {
    const result = derivePrices(reading({ memberPrice: 9999 }));
    expect(result).toMatchObject({ ok: true, value: { effective: 12999 } });
  });

  it('has no effective price without a sticker, and refuses a discount with nothing to come off', () => {
    const outOfStock = derivePrices(
      reading({ sticker: null, shipping: null, shippingStatus: 'unknown' }),
    );
    expect(outOfStock).toEqual({
      ok: true,
      value: { effective: null, landed: null, missingComponents: ['sticker', 'shipping'] },
    });
    expect(derivePrices(reading({ sticker: null, automaticDiscount: 100 }))).toMatchObject({
      ok: false,
      refusal: { code: 'discount_without_sticker' },
    });
  });

  it('works on zero- and three-decimal currencies alike (amounts are minor units)', () => {
    expect(
      derivePrices(
        reading({ currency: 'JPY', sticker: 19800, shipping: 0, automaticDiscount: 1980 }),
      ),
    ).toMatchObject({ ok: true, value: { effective: 17820, landed: 17820 } });
    expect(
      derivePrices(reading({ currency: 'KWD', sticker: 12345, shipping: 1, automaticDiscount: 5 })),
    ).toMatchObject({ ok: true, value: { effective: 12340, landed: 12341 } });
  });
});

describe('derivePrices: landed', () => {
  it('adds known shipping, a stated tax that is not included, and a duty estimate', () => {
    const r = reading({ taxIncluded: false, tax: 1690, dutyEstimate: 700 });
    expect(derivePrices(r)).toEqual({
      ok: true,
      value: { effective: 12999, landed: 12999 + 1500 + 1690 + 700, missingComponents: [] },
    });
  });

  it('does not add a tax amount the price already includes', () => {
    const r = reading({ currency: 'EUR', taxIncluded: true, tax: 2075 });
    expect(derivePrices(r)).toMatchObject({ ok: true, value: { landed: 12999 + 1500 } });
  });

  it('treats known free shipping as zero, and unknown shipping never as zero', () => {
    expect(derivePrices(reading({ shipping: 0 }))).toMatchObject({
      ok: true,
      value: { landed: 12999, missingComponents: [] },
    });
    expect(derivePrices(reading({ shipping: null, shippingStatus: 'unknown' }))).toMatchObject({
      ok: true,
      value: { landed: null, missingComponents: ['shipping'] },
    });
  });

  it('gives no landed total with estimated shipping, and lists shipping as missing (policy)', () => {
    expect(derivePrices(reading({ shippingStatus: 'estimated', shipping: 999 }))).toEqual({
      ok: true,
      value: { effective: 12999, landed: null, missingComponents: ['shipping'] },
    });
  });

  it('gives no landed total when tax is not included and its amount is unknown (policy)', () => {
    // US and Canadian prices are "before tax" (S§5.5): the tax is a component nobody stated.
    expect(derivePrices(reading({ taxIncluded: false }))).toEqual({
      ok: true,
      value: { effective: 12999, landed: null, missingComponents: ['tax'] },
    });
    // Whatever the country, a price stated as excluding tax has no total without the tax.
    expect(derivePrices(reading({ currency: 'EUR', taxIncluded: false }))).toMatchObject({
      ok: true,
      value: { landed: null, missingComponents: ['tax'] },
    });
  });

  it('never turns an unknown tax flag into "included"', () => {
    expect(derivePrices(reading({ taxIncluded: null }))).toMatchObject({
      ok: true,
      value: { landed: null, missingComponents: ['tax'] },
    });
    expect(derivePrices(reading({ taxIncluded: null, tax: 1690 }))).toMatchObject({
      ok: true,
      value: { landed: null, missingComponents: ['tax'] },
    });
  });

  it('does not list a duty estimate that was never made (owner decision #10 default)', () => {
    expect(derivePrices(reading({ dutyEstimate: null }))).toMatchObject({
      ok: true,
      value: { landed: 14499, missingComponents: [] },
    });
  });

  it('refuses a total beyond 2^53 - 1 instead of rounding it', () => {
    expect(derivePrices(reading({ sticker: MAX, shipping: 0 }))).toMatchObject({
      ok: true,
      value: { effective: MAX, landed: MAX },
    });
    expect(derivePrices(reading({ sticker: MAX, shipping: 1 }))).toMatchObject({
      ok: false,
      refusal: { code: 'out_of_range' },
    });
    expect(
      derivePrices(
        reading({ sticker: MAX - 3, shipping: 1, taxIncluded: false, tax: 1, dutyEstimate: 1 }),
      ),
    ).toMatchObject({ ok: true, value: { landed: MAX } });
  });
});

describe('derivePrices: refusals', () => {
  it('refuses any amount beside currency unknown, and derives nothing from none', () => {
    const none = reading({
      currency: 'unknown',
      sticker: null,
      shipping: null,
      shippingStatus: 'unknown',
      taxIncluded: null,
    });
    expect(derivePrices(none)).toEqual({
      ok: true,
      value: { effective: null, landed: null, missingComponents: ['sticker', 'shipping', 'tax'] },
    });
    for (const field of ['sticker', 'coupon', 'memberPrice', 'tax', 'dutyEstimate'] as const) {
      expect(derivePrices({ ...none, [field]: 100 })).toMatchObject({
        ok: false,
        refusal: { code: 'amount_without_currency' },
      });
    }
  });

  it('refuses a shipping amount that does not go with its status', () => {
    for (const [status, shipping] of [
      ['known', null],
      ['estimated', null],
      ['conditional', 500],
      ['unknown', 0],
    ] as const) {
      expect(derivePrices(reading({ shippingStatus: status, shipping }))).toMatchObject({
        ok: false,
        refusal: { code: 'shipping_status_mismatch' },
      });
    }
  });

  it('refuses amounts that are not non-negative safe integers', () => {
    for (const bad of [-1, 1.5, MAX + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(derivePrices(reading({ sticker: bad }))).toMatchObject({
        ok: false,
        refusal: { code: 'invalid_amount' },
      });
      expect(derivePrices(reading({ shipping: bad }))).toMatchObject({
        ok: false,
        refusal: { code: 'invalid_amount' },
      });
    }
    expect(derivePrices(reading({ automaticDiscount: -5 }))).toMatchObject({
      ok: false,
      refusal: { code: 'invalid_amount' },
    });
  });
});

describe('derivePrices: every shipping status × tax flag × tax amount × duty × coupon', () => {
  // The expectation is written from the spec sentences, independently of the implementation:
  // shipping counts only when known; tax counts when included, or when not included and stated;
  // a duty estimate is added when made and never required; a coupon never counts.
  const cases: {
    shippingStatus: ShippingStatus;
    taxIncluded: boolean | null;
    tax: number | null;
    dutyEstimate: number | null;
    coupon: number | null;
  }[] = [];
  for (const shippingStatus of SHIPPING_STATUSES) {
    for (const taxIncluded of [true, false, null]) {
      for (const tax of [1300, null]) {
        for (const dutyEstimate of [450, null]) {
          for (const coupon of [2000, null]) {
            cases.push({ shippingStatus, taxIncluded, tax, dutyEstimate, coupon });
          }
        }
      }
    }
  }

  it('covers 96 combinations', () => expect(cases).toHaveLength(96));

  it.each(cases)('%o', ({ shippingStatus, taxIncluded, tax, dutyEstimate, coupon }) => {
    const shipping = shippingStatus === 'known' ? 800 : shippingStatus === 'estimated' ? 900 : null;
    const input = readInput({
      sticker: 10000,
      automaticDiscount: 500,
      shippingStatus,
      shipping,
      taxIncluded,
      tax,
      dutyEstimate,
      coupon,
    });
    const missing: PriceComponent[] = [];
    if (shippingStatus !== 'known') missing.push('shipping');
    if (taxIncluded === null || (taxIncluded === false && tax === null)) missing.push('tax');
    const landed =
      missing.length > 0
        ? null
        : 9500 + 800 + (taxIncluded === false ? (tax ?? 0) : 0) + (dutyEstimate ?? 0);

    const derived = derivePrices(input);
    expect(derived).toEqual({
      ok: true,
      value: { effective: 9500, landed, missingComponents: missing },
    });
    const built = buildObservationRecord(input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({ effective: 9500, landed, missingComponents: missing });
    expect(built.value.coupon).toBe(coupon);
    expect(parses(built.value)).toBe(true);
  });
});

describe('buildObservationRecord', () => {
  it('builds a complete record from a reader’s fields, valid under the shared schema', () => {
    const built = buildObservationRecord(
      readInput({ referenceClaimed: 15999, unitPrice: 1300, unit: '100 g', coupon: 1000 }),
    );
    expect(built).toEqual({
      ok: true,
      value: {
        observedAt: OBSERVED_AT,
        currency: 'CAD',
        sticker: 12999,
        referenceClaimed: 15999,
        coupon: 1000,
        memberPrice: null,
        shipping: 1500,
        shippingStatus: 'known',
        tax: null,
        taxIncluded: true,
        dutyEstimate: null,
        unitPrice: 1300,
        unit: '100 g',
        effective: 12999,
        landed: 14499,
        missingComponents: [],
        availability: 'in',
        readPath: 'json_ld',
        rung: 'http',
        rawCandidates: [CANDIDATE],
      },
    });
    if (built.ok) expect(parses(built.value)).toBe(true);
  });

  it('keeps the struck-through price as a claim and lets it change nothing', () => {
    const plain = buildObservationRecord(readInput());
    const claimed = buildObservationRecord(readInput({ referenceClaimed: 99999 }));
    expect(plain.ok && claimed.ok).toBe(true);
    if (!plain.ok || !claimed.ok) return;
    expect({ ...claimed.value, referenceClaimed: null }).toEqual(plain.value);
  });

  it('builds an out-of-stock record with no price', () => {
    const built = buildObservationRecord(
      readInput({
        sticker: null,
        shipping: null,
        shippingStatus: 'unknown',
        availability: 'out',
        candidates: [],
      }),
    );
    expect(built).toMatchObject({
      ok: true,
      value: {
        sticker: null,
        effective: null,
        landed: null,
        missingComponents: ['sticker', 'shipping'],
      },
    });
    if (built.ok) expect(parses(built.value)).toBe(true);
  });

  it('builds a record in currency unknown with every amount null and the text kept', () => {
    const built = buildObservationRecord(
      readInput({
        currency: 'unknown',
        sticker: null,
        shipping: null,
        shippingStatus: 'conditional',
        taxIncluded: null,
        candidates: [{ method: 'opengraph', confidence: 0.4, value: '$129.99' }],
      }),
    );
    expect(built).toMatchObject({ ok: true, value: { currency: 'unknown', effective: null } });
    if (built.ok) expect(parses(built.value)).toBe(true);
  });

  it('refuses a failed read: no price, in stock, nothing kept (S§2.10)', () => {
    const built = buildObservationRecord(
      readInput({ sticker: null, shipping: null, shippingStatus: 'unknown', candidates: [] }),
    );
    expect(built).toMatchObject({ ok: false, refusal: { code: 'not_a_record' } });
  });

  it('refuses a sticker without candidates, a half unit pair and a bad timestamp', () => {
    expect(buildObservationRecord(readInput({ candidates: [] }))).toMatchObject({
      ok: false,
      refusal: { code: 'not_a_record' },
    });
    expect(buildObservationRecord(readInput({ unitPrice: 100 }))).toMatchObject({
      ok: false,
      refusal: { code: 'not_a_record' },
    });
    for (const observedAt of ['2026-11-25T09:30:00Z', '2026-02-30T00:00:00.000Z', 'yesterday']) {
      expect(buildObservationRecord(readInput({ observedAt }))).toMatchObject({
        ok: false,
        refusal: { code: 'invalid_timestamp' },
      });
    }
  });

  it('builds records in zero- and three-decimal currencies and at 2^53 - 1', () => {
    for (const input of [
      readInput({ currency: 'JPY', sticker: 19800, shipping: 0 }),
      readInput({ currency: 'KWD', sticker: 12345, shipping: 250, taxIncluded: false, tax: 0 }),
      readInput({ currency: 'USD', sticker: MAX, shipping: 0, unitPrice: MAX, unit: 'kg' }),
    ]) {
      const built = buildObservationRecord(input);
      expect(built.ok).toBe(true);
      if (built.ok) expect(parses(built.value)).toBe(true);
    }
  });

  it('accepts a reader’s ListingRead as it is, plus the time it was read', () => {
    // A verbatim copy of the fields of packages/sources ListingRead (core cannot import sources).
    interface ListingReadShape {
      readonly method: ReadMethod;
      readonly rung: Extract<Rung, 'api' | 'http'>;
      readonly title: string | null;
      readonly identifiers: Readonly<Record<string, string | null>>;
      readonly variant: Readonly<Record<string, string>>;
      readonly condition: Condition;
      readonly currency: ListingCurrency;
      readonly sticker: number | null;
      readonly referenceClaimed: number | null;
      readonly coupon: number | null;
      readonly memberPrice: number | null;
      readonly shipping: number | null;
      readonly shippingStatus: ShippingStatus;
      readonly taxIncluded: boolean | null;
      readonly unitPrice: number | null;
      readonly unit: PriceUnit | null;
      readonly availability: Availability;
      readonly candidates: readonly RawCandidate[];
    }
    const read: ListingReadShape = {
      method: 'platform_json',
      rung: 'api',
      title: 'Prusa XL',
      identifiers: { brand: null, gtin: null, mpn: null, sku: null, externalId: '42' },
      variant: {},
      condition: 'new',
      currency: 'USD',
      sticker: 199900,
      referenceClaimed: null,
      coupon: null,
      memberPrice: null,
      shipping: null,
      shippingStatus: 'conditional',
      taxIncluded: null,
      unitPrice: null,
      unit: null,
      availability: 'in',
      candidates: [{ method: 'platform_json', confidence: 1, value: '1999.00' }],
    };
    const input: ObservationReadInput = { ...read, observedAt: OBSERVED_AT };
    const built = buildObservationRecord(input);
    expect(built).toMatchObject({
      ok: true,
      value: { readPath: 'platform_json', rung: 'api', missingComponents: ['shipping', 'tax'] },
    });
    if (built.ok) expect(parses(built.value)).toBe(true);
  });

  it('lists missing components in the order of PRICE_COMPONENTS', () => {
    const built = buildObservationRecord(
      readInput({
        sticker: null,
        shipping: null,
        shippingStatus: 'unknown',
        taxIncluded: null,
        availability: 'out',
        candidates: [],
      }),
    );
    expect(built.ok && built.value.missingComponents).toEqual(
      PRICE_COMPONENTS.filter((c) => c !== 'duty_estimate'),
    );
  });
});

describe('tax labels: defaults per country, never written into the record', () => {
  it('labels US and Canadian prices "before tax" when the page says nothing', () => {
    expect(shelfTaxConvention('US')).toBe('before_tax');
    expect(shelfTaxConvention('ca')).toBe('before_tax');
    expect(taxLabel(null, 'US')).toEqual({ label: 'before_tax', basis: 'country' });
    expect(taxLabel(null, 'CA')).toEqual({ label: 'before_tax', basis: 'country' });
  });

  it('labels prices in countries whose shelf prices include tax as such, by country default', () => {
    for (const country of ['DE', 'FR', 'GB', 'AU', 'NZ', 'JP', 'CH', 'NO', 'EU']) {
      expect(shelfTaxConvention(country)).toBe('included');
      expect(taxLabel(null, country)).toEqual({ label: 'included', basis: 'country' });
    }
  });

  it('has no default for a country it does not know, nor for no country', () => {
    expect(shelfTaxConvention('BR')).toBeNull();
    expect(shelfTaxConvention(null)).toBeNull();
    expect(taxLabel(null, 'BR')).toEqual({ label: 'unknown', basis: null });
    expect(taxLabel(null, null)).toEqual({ label: 'unknown', basis: null });
  });

  it('lets what the page states win over the country default', () => {
    expect(taxLabel(true, 'CA')).toEqual({ label: 'included', basis: 'read' });
    expect(taxLabel(false, 'DE')).toEqual({ label: 'before_tax', basis: 'read' });
  });
});
