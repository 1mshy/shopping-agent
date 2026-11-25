// The candidate rule of S§5.2 as a pure function over what each method saw (src/read/decide.ts).
import type { ReadMethod } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import type { ListingRead, NoReadReason } from '../../src/read/contract.ts';
import { decide, type MethodRecord } from '../../src/read/decide.ts';

function read(
  method: ReadMethod,
  sticker: number | null,
  currency: ListingRead['currency'] = 'CAD',
): MethodRecord {
  const value = sticker === null ? 'n/a' : (sticker / 100).toFixed(2);
  return {
    method,
    rung: method === 'platform_json' ? 'api' : 'http',
    unconfirmed: false,
    outcome: {
      kind: 'read',
      read: {
        method,
        rung: method === 'platform_json' ? 'api' : 'http',
        title: method,
        identifiers: { brand: null, gtin: null, mpn: null, sku: null, externalId: null },
        variant: {},
        condition: 'unknown',
        currency,
        sticker: currency === 'unknown' ? null : sticker,
        referenceClaimed: null,
        coupon: null,
        memberPrice: null,
        shipping: null,
        shippingStatus: 'unknown',
        taxIncluded: null,
        unitPrice: null,
        unit: null,
        availability: sticker === null ? 'out' : 'in',
        candidates: [{ method, confidence: 0.5, value }],
      },
    },
  };
}

function refused(method: ReadMethod, reason: NoReadReason, unconfirmed = false): MethodRecord {
  return {
    method,
    rung: 'http',
    unconfirmed,
    outcome: {
      kind: 'no_read',
      method,
      reason,
      detail: 'test',
      candidates: [{ method, confidence: 0.3, value: '1.00' }],
      fetch: null,
    },
  };
}

const none = (method: ReadMethod): MethodRecord => ({
  method,
  rung: 'http',
  unconfirmed: false,
  outcome: { kind: 'not_applicable' },
});

function winner(records: MethodRecord[]) {
  const d = decide(records);
  if (d.kind !== 'read') throw new Error(`expected a read, got ${JSON.stringify(d)}`);
  return d.read;
}

function failure(records: MethodRecord[]) {
  const d = decide(records);
  if (d.kind !== 'failed') throw new Error(`expected a failure, got ${JSON.stringify(d)}`);
  return d;
}

describe('decide: ranking', () => {
  it('JSON-LD outranks platform values, which outrank microdata and OpenGraph', () => {
    expect(winner([read('platform_json', 1000), read('json_ld', 1200)]).method).toBe('json_ld');
    expect(winner([read('microdata', 900), read('platform_json', 1000)]).method).toBe(
      'platform_json',
    );
    expect(winner([read('adapter', 1000), read('opengraph', 900)]).method).toBe('adapter');
    expect(
      winner([read('json_ld', 1200), read('microdata', 900), read('opengraph', 900)]).sticker,
    ).toBe(1200);
  });

  it('agreeing methods of equal rank give that price', () => {
    expect(winner([read('microdata', 900), read('opengraph', 900)]).sticker).toBe(900);
  });

  it('a lone method gives its read', () => {
    expect(winner([none('json_ld'), none('microdata'), read('opengraph', 500)]).method).toBe(
      'opengraph',
    );
  });
});

describe('decide: multiple_prices', () => {
  it('two methods of equal rank disagree and no rank settles it', () => {
    expect(failure([read('microdata', 900), read('opengraph', 1000)]).reason).toBe(
      'multiple_prices',
    );
    expect(failure([read('platform_json', 900), read('adapter', 1000)]).reason).toBe(
      'multiple_prices',
    );
  });

  it('the same amount in two currencies is a disagreement', () => {
    expect(failure([read('microdata', 900, 'CAD'), read('opengraph', 900, 'USD')]).reason).toBe(
      'multiple_prices',
    );
  });

  it('an unknown-currency read beside a priced one of equal rank cannot be compared', () => {
    expect(failure([read('microdata', 900, 'unknown'), read('opengraph', 900)]).reason).toBe(
      'multiple_prices',
    );
  });

  it('a higher-ranked read settles a lower-ranked disagreement or refusal', () => {
    expect(
      winner([read('json_ld', 900), read('microdata', 1000), read('opengraph', 1100)]).sticker,
    ).toBe(900);
    expect(winner([read('json_ld', 900), refused('microdata', 'multiple_prices')]).sticker).toBe(
      900,
    );
  });
});

describe('decide: refusals', () => {
  it('a refusal of the top rank is the result; a lower read never overrules it', () => {
    for (const reason of ['variant_not_found', 'multiple_prices', 'converted_currency'] as const) {
      expect(failure([refused('json_ld', reason), read('opengraph', 900)]).reason).toBe(reason);
    }
    expect(
      failure([refused('microdata', 'variant_not_found'), read('opengraph', 900)]).reason,
    ).toBe('variant_not_found');
  });

  it('an unconfirmed variant_not_found (no variant data to check) yields to a read', () => {
    expect(
      winner([read('microdata', 900), refused('opengraph', 'variant_not_found', true)]).sticker,
    ).toBe(900);
    expect(failure([none('json_ld'), refused('opengraph', 'variant_not_found', true)]).reason).toBe(
      'variant_not_found',
    );
  });

  it('a figure that would not read or no price abstains', () => {
    expect(winner([refused('json_ld', 'unreadable_price'), read('opengraph', 900)]).method).toBe(
      'opengraph',
    );
    expect(winner([refused('json_ld', 'no_price'), read('microdata', 900)]).method).toBe(
      'microdata',
    );
  });

  it('nothing read: the most telling refusal, else no structured data', () => {
    expect(
      failure([refused('json_ld', 'no_price'), refused('opengraph', 'unreadable_price')]).reason,
    ).toBe('unreadable_price');
    expect(failure([none('json_ld'), none('microdata'), none('opengraph')]).reason).toBe(
      'no_structured_data',
    );
  });

  it('keeps every candidate, the winner first', () => {
    const d = decide([read('opengraph', 1000), read('json_ld', 900)]);
    expect(d.candidates.map((c) => c.method)).toEqual(['json_ld', 'opengraph']);
  });
});
