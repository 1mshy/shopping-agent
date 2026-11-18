// SYNTHETIC test inputs only (see build.ts).
import { describe, expect, it } from 'vitest';
import { ReviewFile, STORE_VERDICT_POSSIBLE_RELATIONS, StoreVerdict } from '../lib/format.ts';
import { listing, price, product, reject, reviewFile } from './build.ts';

const valid = () =>
  reviewFile([
    product(
      'p1',
      'c1',
      [listing('catalog', 'a'), listing('web', 'b.example'), listing('learned', 'c')],
      [reject('a', ['before'])],
      ['blocked'],
    ),
  ]);

function refused(mutate: (f: ReturnType<typeof valid>) => unknown): boolean {
  const f = structuredClone(valid());
  const out = mutate(f) ?? f;
  return !ReviewFile.safeParse(out).success;
}

describe('review file format', () => {
  it('accepts a well-formed file and round-trips it unchanged', () => {
    const f = valid();
    expect(ReviewFile.parse(f)).toEqual(f);
  });

  it('refuses a float price: a price is decimal text plus integer minor units', () => {
    expect(
      refused((f) => {
        (f.products[0]?.listings[0] as { price: unknown }).price = 10.5;
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        const p = f.products[0]?.listings[0]?.price as { amountMinor: unknown };
        p.amountMinor = 1000.5;
      }),
    ).toBe(true);
    // A number where the decimal text belongs is refused too.
    expect(
      refused((f) => {
        const p = f.products[0]?.listings[0]?.price as { decimal: unknown };
        p.decimal = 10;
      }),
    ).toBe(true);
  });

  it('refuses minor units that are not what moneyFromDecimal gives (no rounding, no drift)', () => {
    // "10.00" CAD is 1000 minor units; 1001 or a rounded 10 would be a second truth.
    for (const amountMinor of [1001, 10, null]) {
      expect(
        refused((f) => {
          const p = f.products[0]?.listings[0]?.price as { amountMinor: unknown };
          p.amountMinor = amountMinor;
        }),
      ).toBe(true);
    }
    // "12.999" CAD does not convert: amountMinor is null and the refusal is named.
    expect(price('12.999', 'CAD')).toEqual({
      decimal: '12.999',
      currency: 'CAD',
      amountMinor: null,
      refusal: 'excess_precision',
    });
    expect(
      refused((f) => {
        const l = f.products[0]?.listings[0];
        if (l) l.price = price('12.999', 'CAD');
      }),
    ).toBe(false);
    expect(
      refused((f) => {
        const l = f.products[0]?.listings[0];
        if (l) l.price = { ...price('12.999', 'CAD'), amountMinor: 1300, refusal: null };
      }),
    ).toBe(true);
    // An unknown currency has no minor units (S§2.2).
    expect(price('10.00', 'unknown').amountMinor).toBeNull();
  });

  it('refuses page text or exponent notation as the decimal', () => {
    for (const decimal of ['$10.00', '10,00', '1e-5', '010.00', '']) {
      expect(
        refused((f) => {
          const p = f.products[0]?.listings[0]?.price as { decimal: unknown };
          p.decimal = decimal;
        }),
      ).toBe(true);
    }
  });

  it('refuses a missing or non-opaque reviewer handle', () => {
    expect(
      refused((f) => {
        delete (f.review as { reviewerId?: string }).reviewerId;
      }),
    ).toBe(true);
    for (const reviewerId of ['', 'First Last', 'someone@example.com']) {
      expect(
        refused((f) => {
          f.review.reviewerId = reviewerId;
        }),
      ).toBe(true);
    }
  });

  it('refuses an unknown verdict, an unknown setup and a rejection without a reason', () => {
    expect(
      refused((f) => {
        (f.products[0]?.verdicts[0] as { verdict: string }).verdict = 'wrong_product';
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        (f.products[0]?.verdicts[0] as { setups: unknown }).setups = ['catalog'];
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        (f.products[0]?.verdicts[0] as { setups: unknown }).setups = [];
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        (f.products[0]?.verdicts[0] as { reason: string }).reason = ' ';
      }),
    ).toBe(true);
    expect(
      StoreVerdict.safeParse({ ...reject('a'), verdict: 'accepted', reason: '' }).success,
    ).toBe(true);
  });

  it('refuses two verdicts on one store for one setup', () => {
    expect(
      refused((f) => {
        f.products[0]?.verdicts.push({ ...reject('a', ['before', 'after']), verdict: 'accepted' });
      }),
    ).toBe(true);
    // Different setups of one store are fine (the predecessor's per-setup rejections).
    expect(
      refused((f) => {
        f.products[0]?.verdicts.push({ ...reject('a', ['after']), verdict: 'accepted' });
      }),
    ).toBe(false);
  });

  it('wants UTC timestamps with exactly three fractional digits', () => {
    for (const t of [
      '2026-01-02T03:04:05Z',
      '2026-01-02T03:04:05.006123Z',
      '2026-01-02T03:04:05.006+00:00',
    ]) {
      expect(
        refused((f) => {
          f.run.startedAt = t;
        }),
      ).toBe(true);
    }
    expect(
      refused((f) => {
        f.review.reviewedAt = null;
      }),
    ).toBe(false);
  });

  it('refuses unknown keys, duplicate products and a store key that is not lower-case', () => {
    expect(refused((f) => ({ ...f, extra: 1 }))).toBe(true);
    expect(
      refused((f) => {
        const p = f.products[0];
        if (p) f.products.push(p);
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        const l = f.products[0]?.listings[0];
        if (l) l.store = 'Amazon';
      }),
    ).toBe(true);
    expect(
      refused((f) => {
        f.review.unlistedStores = 'unreviewed' as 'accepted';
      }),
    ).toBe(true);
  });

  it('maps neither coarse verdict to a single relation', () => {
    expect(STORE_VERDICT_POSSIBLE_RELATIONS.accepted.length).toBeGreaterThan(1);
    expect(STORE_VERDICT_POSSIBLE_RELATIONS.rejected.length).toBeGreaterThan(1);
    expect(STORE_VERDICT_POSSIBLE_RELATIONS.rejected).not.toContain('unknown');
  });
});
