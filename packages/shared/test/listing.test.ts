import { describe, it } from 'vitest';
import { Listing, OBSERVATION_AMOUNT_FIELDS, PriceObservation } from '../src/index.ts';
import { expectRefused, expectValid } from './check.ts';

const listing = {
  id: 1,
  productId: null,
  storeId: 7,
  channel: 'retail',
  urlCanonical: 'https://shop.example.ca/products/wh-1000xm5',
  externalId: '8123456',
  sku: 'WH1000XM5/B',
  sellerId: null,
  sellerKind: 'first_party',
  condition: 'new',
  currency: 'CAD',
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
  variant: { colour: 'black' },
  trackable: true,
  firstSeenAt: '2026-11-17T09:00:00.000Z',
  lastSeenAt: '2026-11-17T09:30:00.250Z',
  goneAt: null,
  consecutiveErrors: 0,
};

describe('Listing', () => {
  it('accepts a retail offer and a listing whose currency is unknown', () => {
    expectValid(Listing, listing);
    expectValid(Listing, { ...listing, currency: 'unknown' });
  });

  it('has no default currency and refuses currencies without a minor unit', () => {
    const { currency: _, ...noCurrency } = listing;
    expectRefused(Listing, noCurrency, 'currency');
    for (const currency of ['XXX', 'XAU', 'cad', '']) {
      expectRefused(Listing, { ...listing, currency }, 'currency');
    }
  });

  it('refuses local times, non-http URLs and unknown fields', () => {
    expectRefused(Listing, { ...listing, firstSeenAt: '2026-11-17T09:00:00+01:00' }, 'firstSeenAt');
    expectRefused(Listing, { ...listing, lastSeenAt: '2026-11-17 09:00:00' }, 'lastSeenAt');
    expectRefused(Listing, { ...listing, urlCanonical: 'ftp://shop.example.ca/x' }, 'urlCanonical');
    expectRefused(Listing, { ...listing, price: 399.99 }, '');
    expectRefused(
      Listing,
      { ...listing, urlCanonical: 'https://user:pw@shop.example.ca/products/x' },
      'urlCanonical',
    );
    expectRefused(
      Listing,
      { ...listing, urlCanonical: 'https://user@shop.example.ca/' },
      'urlCanonical',
    );
  });

  it('takes variant keys as the store writes them, trimmed and bounded', () => {
    expectValid(Listing, {
      ...listing,
      variant: { Size: 'XL', option1: 'Black', 'Pack size': '6' },
    });
    expectRefused(Listing, { ...listing, variant: { ' Size': 'XL' } }, 'variant. Size');
    expectRefused(Listing, { ...listing, variant: { '': 'XL' } }, 'variant.');
    expectRefused(
      Listing,
      { ...listing, variant: { ['k'.repeat(101)]: 'XL' } },
      `variant.${'k'.repeat(101)}`,
    );
  });
});

describe('Timestamp', () => {
  it('is UTC with exactly three fractional digits, so text order is time order', () => {
    expectValid(Listing, { ...listing, firstSeenAt: '2026-11-17T09:00:00.000Z' });
    const imprecise = [
      '2026-11-17T09:00:00Z',
      '2026-11-17T09:00:00.5Z',
      '2026-11-17T09:00:00.250000Z',
    ];
    for (const firstSeenAt of imprecise) {
      expectRefused(Listing, { ...listing, firstSeenAt }, 'firstSeenAt');
    }
  });
});

// A Canadian store, read over HTTP from JSON-LD. Prices are before tax, so the landed total is
// not established and tax is listed as missing.
const observation = {
  id: 10,
  listingId: 1,
  observedAt: '2026-11-17T09:30:00.000Z',
  currency: 'CAD',
  sticker: 39999,
  referenceClaimed: 49999,
  coupon: null,
  memberPrice: null,
  shipping: 0,
  shippingStatus: 'known',
  tax: null,
  taxIncluded: false,
  dutyEstimate: null,
  unitPrice: null,
  unit: null,
  effective: 39999,
  landed: null,
  missingComponents: ['tax'],
  availability: 'in',
  readPath: 'json_ld',
  rung: 'http',
  rawCandidates: [
    { method: 'json_ld', confidence: 0.9, value: '399.99' },
    { method: 'opengraph', confidence: 0.6, value: '$399.99 CAD' },
  ],
};

// A German store with tax included and known shipping: every component of the landed total is known.
const landedObservation = {
  ...observation,
  currency: 'EUR',
  sticker: 29900,
  referenceClaimed: null,
  shipping: 499,
  taxIncluded: true,
  effective: 29900,
  landed: 30399,
  missingComponents: [],
  rawCandidates: [{ method: 'platform_json', confidence: 1, value: '299.00' }],
  readPath: 'platform_json',
  rung: 'api',
};

// The page showed a price but the currency could not be established: no amounts, text kept.
const unknownCurrency = {
  ...observation,
  currency: 'unknown',
  sticker: null,
  referenceClaimed: null,
  shipping: null,
  shippingStatus: 'unknown',
  effective: null,
  missingComponents: ['sticker', 'shipping', 'tax'],
  rawCandidates: [{ method: 'microdata', confidence: 0.7, value: '$399.99' }],
};

describe('PriceObservation', () => {
  it('accepts realistic reads', () => {
    expectValid(PriceObservation, observation);
    expectValid(PriceObservation, landedObservation);
    expectValid(PriceObservation, unknownCurrency);
    expectValid(PriceObservation, { ...observation, shippingStatus: 'estimated', shipping: 1500 });
    expectValid(PriceObservation, { ...observation, unitPrice: 1999, unit: 'kg' });
    // Out of stock with no price shown: availability is still worth recording (restock watermark).
    expectValid(PriceObservation, {
      ...observation,
      sticker: null,
      referenceClaimed: null,
      effective: null,
      missingComponents: ['sticker', 'tax'],
      availability: 'out',
      rawCandidates: [],
    });
  });

  it('holds amounts only as integer minor units', () => {
    for (const sticker of [399.99, '39999', '399.99', -1, 2 ** 53, Number.NaN]) {
      expectRefused(PriceObservation, { ...observation, sticker, effective: null }, 'sticker');
    }
    expectRefused(PriceObservation, { ...observation, shipping: 4.99 }, 'shipping');
  });

  it('has no default currency', () => {
    const { currency: _, ...noCurrency } = observation;
    expectRefused(PriceObservation, noCurrency, 'currency');
    expectRefused(PriceObservation, { ...observation, currency: null }, 'currency');
    expectRefused(PriceObservation, { ...observation, currency: 'XXX' }, 'currency');
  });

  it('refuses every amount when the currency is unknown (S§2.2)', () => {
    for (const field of OBSERVATION_AMOUNT_FIELDS) {
      expectRefused(PriceObservation, { ...unknownCurrency, [field]: 100 }, field);
    }
  });

  it('carries a shipping amount only for known or estimated shipping (S§2.10)', () => {
    expectRefused(PriceObservation, { ...observation, shipping: null }, 'shipping');
    for (const shippingStatus of ['conditional', 'unknown']) {
      expectRefused(PriceObservation, { ...observation, shippingStatus }, 'shipping');
    }
    expectRefused(PriceObservation, { ...observation, shippingStatus: null }, 'shippingStatus');
  });

  it('pairs a unit price with its unit', () => {
    expectRefused(PriceObservation, { ...observation, unitPrice: 1999 }, 'unit');
    expectRefused(PriceObservation, { ...observation, unit: 'kg' }, 'unit');
  });

  it('never holds a derived figure without the components it needs (S§5.5)', () => {
    const outOfStock = { ...observation, sticker: null, availability: 'out', rawCandidates: [] };
    expectRefused(PriceObservation, outOfStock, 'effective');
    expectRefused(PriceObservation, { ...landedObservation, effective: null }, 'landed');
    for (const shippingStatus of ['estimated', 'conditional', 'unknown']) {
      const shipping = shippingStatus === 'estimated' ? 499 : null;
      expectRefused(PriceObservation, { ...landedObservation, shippingStatus, shipping }, 'landed');
    }
    expectRefused(PriceObservation, { ...landedObservation, missingComponents: ['tax'] }, 'landed');
    expectRefused(
      PriceObservation,
      { ...observation, missingComponents: ['tax', 'tax'] },
      'missingComponents',
    );
    expectRefused(
      PriceObservation,
      { ...observation, missingComponents: ['coupon'] },
      'missingComponents.0',
    );
  });

  it('ties the missing list to the fields it describes', () => {
    const at = 'missingComponents';
    // sticker: listed exactly when null.
    expectRefused(PriceObservation, { ...observation, missingComponents: ['sticker', 'tax'] }, at);
    const outOfStock = {
      ...observation,
      sticker: null,
      effective: null,
      availability: 'out',
      rawCandidates: [],
    };
    expectRefused(PriceObservation, outOfStock, at);
    // shipping: listed when conditional or unknown, not when known, either when estimated.
    for (const shippingStatus of ['conditional', 'unknown']) {
      expectRefused(PriceObservation, { ...observation, shippingStatus, shipping: null }, at);
    }
    expectRefused(PriceObservation, { ...observation, missingComponents: ['shipping', 'tax'] }, at);
    const estimated = { ...observation, shippingStatus: 'estimated', shipping: 1500 };
    expectValid(PriceObservation, { ...estimated, missingComponents: ['shipping', 'tax'] });
    // tax: listed when inclusion is unknown; not when included or an amount is known; else either.
    expectRefused(
      PriceObservation,
      { ...observation, taxIncluded: null, missingComponents: [] },
      at,
    );
    expectRefused(
      PriceObservation,
      { ...landedObservation, landed: null, missingComponents: ['tax'] },
      at,
    );
    expectRefused(PriceObservation, { ...observation, tax: 5200 }, at);
    expectValid(PriceObservation, { ...observation, missingComponents: [] });
    expectValid(PriceObservation, { ...observation, tax: 5200, missingComponents: [] });
    // duty_estimate: not listed when it is set.
    const dutied = { ...observation, dutyEstimate: 1200 };
    expectRefused(PriceObservation, { ...dutied, missingComponents: ['tax', 'duty_estimate'] }, at);
    expectValid(PriceObservation, { ...observation, missingComponents: ['tax', 'duty_estimate'] });
    // A landed total therefore implies tax inclusion is known.
    expectRefused(PriceObservation, { ...landedObservation, taxIncluded: null }, at);
  });

  it('keeps derived figures in order: effective ≤ sticker ≤ …, landed ≥ effective', () => {
    expectRefused(PriceObservation, { ...observation, effective: 49999 }, 'effective');
    expectValid(PriceObservation, { ...observation, coupon: 2000, effective: 37999 });
    expectRefused(PriceObservation, { ...landedObservation, landed: 1 }, 'landed');
    expectValid(PriceObservation, { ...landedObservation, shipping: 0, landed: 29900 });
  });

  it('cannot represent a failed read as a price (S§2.10)', () => {
    // No price, in stock, known currency: that is a failed read, not an observation.
    expectRefused(
      PriceObservation,
      { ...observation, sticker: null, effective: null, rawCandidates: [] },
      'sticker',
    );
    // A price with nothing read behind it.
    expectRefused(PriceObservation, { ...observation, rawCandidates: [] }, 'rawCandidates');
    expectRefused(PriceObservation, { ...unknownCurrency, rawCandidates: [] }, 'sticker');
    expectRefused(PriceObservation, { ...observation, availability: null }, 'availability');
  });

  it('validates the raw candidates and the read path', () => {
    const candidate = { method: 'json_ld', confidence: 0.9, value: '399.99' };
    expectRefused(
      PriceObservation,
      { ...observation, rawCandidates: [{ ...candidate, method: 'css' }] },
      'rawCandidates.0.method',
    );
    expectRefused(
      PriceObservation,
      { ...observation, rawCandidates: [{ ...candidate, confidence: 1.5 }] },
      'rawCandidates.0.confidence',
    );
    expectRefused(
      PriceObservation,
      { ...observation, rawCandidates: [{ ...candidate, value: 399.99 }] },
      'rawCandidates.0.value',
    );
    expectRefused(PriceObservation, { ...observation, readPath: 'browser' }, 'readPath');
    expectRefused(PriceObservation, { ...observation, rung: 'cache' }, 'rung');
  });
});
